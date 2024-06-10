
import { type ServiceConfig } from '@restorecommerce/service-config';
import { type Logger } from '@restorecommerce/logger';
import {
  Resource,
  ResourceResponse,
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
import { CallContext } from 'nice-grpc-common';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';

export type Aggregation<B extends ResourceListResponse | ResourceList, C> = B & C;
export type IdNotSetCallback = (id?: string, entity?: string) => any;

export type CRUDServiceDefinition = CompatServiceDefinition & {
  methods: {
    create: any;
    read: any;
    update: any;
    upsert: any;
    delete: any;
  }
}

export class ResponseMap<T extends ResourceResponse> extends Map<string, T> {

  constructor(
    items?: T[],
    public readonly entity = items[0]?.constructor?.name,
  ) {
    super(items?.map(
      item => [item?.payload?.id ?? item.status?.id, item]
    ));
  }

  public override get(id: string, strict?: IdNotSetCallback): T {
    if (strict && !this.has(id)) {
      const error = strict(id);
      if (error) {
        throw error;
      }
    }
    return super.get(id);
  }

  public getMany(ids: string[], strict?: IdNotSetCallback): T[] {
    return ids.map(id => this.get(id, strict));
  }

  public getAll(): T[] {
    return [...this.values()];
  }

  public async getPromise(id: string, strict?: IdNotSetCallback) {
    return this.get(id, strict);
  }

  public async getManyPromises(ids: string[], strict?: IdNotSetCallback) {
    return this.getMany(ids, strict);
  }

  readonly map = [...this.values()].map;
  readonly flatMap = [...this.values()].flatMap;
  readonly filter = [...this.values()].filter;
  readonly find = [...this.values()].find;
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

  public async getByIds<R extends ResourceResponse>(
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
    return new ResponseMap<R>(response?.items, service?.name?.toString());
  }

  public async aggregate<T extends ResourceListResponse | ResourceList, C = any>(
    target: T,
    sources: {
      service: CRUDServiceDefinition,
      map_by_ids: (target: T) => string[],
      container: string
    }[],
    template?: C,
    subject?: Subject,
    context?: CallContext,
    strict?: IdNotSetCallback,
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
        [source.container]: new ResponseMap(
          source_map[i].getMany(
            ids[i].flatMap(ids => ids),
            strict
          )
        )
      })),
    ) as Aggregation<T, C>
    return aggregation;
  }
}