
import { type ServiceConfig } from '@restorecommerce/service-config';
import { type Logger } from '@restorecommerce/logger';
import {
  Resource,
  ResourceList,
  ResourceListResponse,
  Filter_ValueType,
  Filter_Operation,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import {
  Client,
  GrpcClientConfig,
  createChannel,
  createClient,
} from '@restorecommerce/grpc-client';
import { CompatServiceDefinition } from 'nice-grpc';
import {
  type CallContext,
} from 'nice-grpc-common';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import { Status } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';

export type Aggregation<T extends ResourceListResponse | ResourceList = any, C = any> = T & C;
export type OnMissingCallback = (id?: string, entity?: string) => any;
export type ResolverParams<T = any, M = ResolverMap> = [string, Map<string, T>, M?, T?]
export type ArrayResolverParams<T = any, M = ResolverMap> = [string, Map<string, T>, M[]?, T[]?]
export type ResolverMap<T = any> = {
  [K in keyof T]?: ResolverParams<T[K]> | ArrayResolverParams<T[K]> | T[K]
};
export type ResolvedNode<T> = T extends ResolverParams
  ? (T[2] extends ResolverMap
    ? T[3] & Resolved<T[2]> 
    : T[3])
  : Resolved<T>;
export type Resolved<T extends ResolverMap> = {
  [K in keyof T]?: ResolvedNode<T[K]>
}

export const Resolver = <T = any, M = ResolverMap>(
  search_key: string,
  source: Map<string, T>,
  map?: M,
): ResolverParams<T, M> => [
  search_key,
  source,
  map,
  {} as T,
];

export const ArrayResolver = <T = any, M = ResolverMap>(
  search_key: string,
  source: Map<string, T>,
  map?: M,
): ArrayResolverParams<T, M> => [
  search_key,
  source,
  [map],
  {} as T[],
];

export const DEFAULT_STATUS_CALLBACK: OnMissingCallback = (id?: string, entity?: string): Status => ({
  id,
  code: 404,
  message: `${entity ?? 'Entity'} ${id} is missing!`
});

export type CRUDServiceDefinition = CompatServiceDefinition & {
  methods: {
    create: any;
    read: any;
    update: any;
    upsert: any;
    delete: any;
  };
};

export class ResourceMap<T extends Resource = any> extends Map<string, T> {
  protected _all?: T[];

  public get all() {
    this._all = this._all ?? [...this.values()];
    return this._all;
  }

  constructor(
    items?: T[],
    public readonly entity = items[0]?.constructor?.name,
  ) {
    super(items?.map(
      item => [item?.id, item]
    ));
  }

  public override set(key: string, value: T) {
    delete this._all;
    return super.set(key, value);
  }

  public override clear() {
    delete this._all;
    return super.clear();
  }

  public override delete(key: string) {
    delete this._all;
    return super.delete(key);
  }

  public override get(id: string, onMissing?: OnMissingCallback): T {
    if (onMissing && !this.has(id)) {
      const error = onMissing(id, this.entity);
      if (error) {
        throw error;
      }
    }
    return super.get(id);
  }

  public getMany(ids: string[], onMissing?: OnMissingCallback): T[] {
    return ids.map(id => this.get(id, onMissing));
  }

  public async tryGet(
    id: string,
    onMissing: OnMissingCallback = DEFAULT_STATUS_CALLBACK
  ) {
    return this.get(id, onMissing);
  }

  public async tryGetMany(
    ids: string[],
    onMissing: OnMissingCallback = DEFAULT_STATUS_CALLBACK
  ) {
    return this.getMany(ids, onMissing);
  }

  public readonly map = this.all.map;
  public readonly flatMap = this.all.flatMap;
  public readonly filter = this.all.filter;
  public readonly find = this.all.find;
  public readonly some = this.all.some;
  public readonly every = this.all.every;
}

export class ClientRegister {
  protected static readonly GLOBAL_REGISTER = new Map<string, Client<any>>();

  constructor(
    protected readonly cfg: ServiceConfig,
    protected readonly logger: Logger,
    protected readonly register = ClientRegister.GLOBAL_REGISTER,
  ) {}

  public get<T extends CRUDServiceDefinition>(
    definition: T
  ): Client<T> {
    if (this.register.has(definition.fullName.toString())) {
      return this.register.get(definition.fullName.toString());
    }

    const config = this.cfg.get(
      `client:${definition.name}`
    ) ?? Object.values(
      this.cfg.get(`client`) ?? []
    )?.find(
      (client: any) => (
        client.fullName === definition.fullName
        || client.name === definition.name
      )
    );

    const client = createClient(
      {
        ...config,
        logger: this.logger,
      } as GrpcClientConfig,
      definition,
      createChannel(config.address)
    );

    this.register.set(definition.fullName.toString(), client);
    return client;
  }
}

export class ResourceAggregator {
  constructor(
    protected readonly cfg: ServiceConfig,
    protected readonly logger: Logger,
    protected readonly register = new ClientRegister(cfg, logger),
  ) {}

  public async getByIds<R extends Resource>(
    ids: string | string[],
    service: CRUDServiceDefinition,
    subject?: Subject,
    context?: CallContext,
  ) {
    ids = [...new Set([ids].flatMap(id => id))];
    const request = {
      filters: [{
        filters: [
          {
            field: 'id',
            operation: Filter_Operation.in,
            value: JSON.stringify(ids),
            type: Filter_ValueType.ARRAY,
          }
        ]
      }],
      limit: ids.length,
      subject,
    };
    const client = this.register.get(service) as any;
    const response = await client.read(request, context);
    return new ResourceMap<R>(
      response?.items?.map(
        (item: any) => item.payload
      ),
      service?.name?.toString()
    );
  }

  public async aggregate<T extends ResourceListResponse | ResourceList, C = any>(
    target: T,
    sources: {
      service: CRUDServiceDefinition;
      map_by_ids: (target: T) => string[];
      container: string;
    }[],
    template?: C,
    subject?: Subject,
    context?: CallContext,
    strict?: OnMissingCallback,
  ): Promise<Aggregation<T, C>> {
    const ids = sources.map(
      source => source.map_by_ids(target)
    );
    const source_map = await Promise.all(
      sources.map(
        (source, i) => this.getByIds(
          ids[i].flatMap(ids => ids),
          source.service,
          subject,
          context,
        )
      )
    );
    const aggregation = Object.assign(
      target,
      template,
      ...sources.map((source, i) => ({
        [source.container]: new ResourceMap(
          source_map[i].getMany(
            ids[i].flatMap(ids => ids),
            strict
          )
        )
      })),
    ) as Aggregation<T, C>;
    return aggregation;
  }
}

export const resolve = <T extends object, M extends ResolverMap>(
  entity: T,
  resolverMap?: M,
): T & Resolved<M> => entity && Object.assign(
  entity,
  ...Object.entries(entity).map(
    ([key, value]) => Object.entries(resolverMap ?? {}).map(
      ([k, r]) => {
        if (r[0] === key) {
          if (Array.isArray(value)) {
            return {
              [key]: value.map(
                id => r[2] ? resolve(
                  r[1].get(id.toString()), r[2],
                ) : r[1].get(id.toString())
              )
            };
          }
          else {
            return {
              [key]: r[2] ? resolve(
                r[1].get(value.toString()), r[2],
              ) : r[1].get(value.toString())
            }
          }
        }
        else {
          return resolve((entity as any)[k], r);
        }
      }
    )
  ).filter(e => !!e)
);