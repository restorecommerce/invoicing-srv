import * as fs from 'node:fs';
import { basename } from 'node:path';
import * as uuid from 'uuid';
import { sprintf } from 'sprintf-js';
import { parse as CSV } from 'csv-parse/sync';
import { type RedisClientType } from 'redis';
import {
  ResourcesAPIBase,
  ServiceBase
} from '@restorecommerce/resource-base-interface';
import {
  type Client,
  GrpcClientConfig,
  createChannel,
  createClient,
} from '@restorecommerce/grpc-client';
import { type DatabaseProvider } from '@restorecommerce/chassis-srv';
import { Topic } from '@restorecommerce/kafka-client';
import {
  Invoice,
  InvoiceServiceImplementation,
  InvoiceListResponse,
  InvoiceList,
  InvoiceIdList,
  RequestInvoiceNumber,
  InvoiceNumberResponse,
  Position,
  InvoiceResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import {
  OperationStatus,
  Status,
  StatusListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';
import {
  type CallContext
} from 'nice-grpc-common';
import { type ServiceConfig } from '@restorecommerce/service-config';
import { type Logger } from '@restorecommerce/logger';
import {
  DeleteRequest,
  DeleteResponse,
  ReadRequest,
  Sort_SortOrder
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import {
  ACSClientContext,
  AuthZAction,
  DefaultACSClientContextFactory,
  DefaultResourceFactory,
  Operation,
  access_controlled_function,
  access_controlled_service,
  injects_meta_data,
  resolves_subject,
} from '@restorecommerce/acs-client';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import {
  Payload,
  RenderRequest,
  RenderResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import {
  PdfRenderingServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/pdf_rendering.js';
import {
  NotificationReqServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/notification_req.js';
import {
  ObjectServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/ostorage.js';
import {
  Shop,
  ShopServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/shop.js';
import {
  CustomerServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/customer.js';
import {
  OrganizationServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/organization.js';
import {
  ContactPointServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/contact_point.js';
import {
  UserServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/user.js';
import {
  Bundle,
  PhysicalProduct,
  PhysicalVariant,
  Product,
  ProductServiceDefinition,
  ServiceProduct,
  ServiceVariant,
  VirtualProduct,
  VirtualVariant,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product.js';
import {
  ManufacturerServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/manufacturer.js';
import {
  TaxServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax.js';
import {
  FulfillmentProductServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product.js';
import {
  Filter_Operation,
  Filter_ValueType,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/filter.js';
import {
  ResourceAggregator,
  ResourceMap,
} from '../experimental/ResourceAggregator.js';
import {
  Template,
  TemplateServiceDefinition,
  TemplateUseCase,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/template.js';
import {
  SettingServiceDefinition,
  Setting,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/setting.js';
import {
  File
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/file.js';
import { Readable, Transform } from 'node:stream';
import { InvoiceNumberService } from './invoice_number_srv.js';
import {
  DefaultUrns,
  type KnownUrns,
  type AggregationTemplate,
  type AggregatedInvoiceList,
  type ResolvedSetting,
  DefaultSetting,
  resolveInvoice,
  parseSetting,
} from '../utils.js';
import { ResourceAwaitQueue } from '../experimental/ResourceAwaitQueue.js';
import { ClientRegister } from '../experimental/ClientRegister.js';
import { marshallProtobufAny } from '../utils.js';


export type ProductNature = PhysicalProduct | VirtualProduct | ServiceProduct;
export type ProductVariant = PhysicalVariant | VirtualVariant | ServiceVariant;
export type PositionProduct = ProductVariant | Bundle;
export type AggregatedPosition = Position & {
  product: PositionProduct;
};
export type RenderResult = {
  id?: string;
  body?: string;
  status?: Status;
};

export type AwaitStringFunc = (value: string) => void;
export type AwaitStringMutex = {
  resolve: AwaitStringFunc;
  reject: (error: any) => any;
};
@access_controlled_service
export class InvoiceService
  extends ServiceBase<InvoiceListResponse, InvoiceList>
  implements InvoiceServiceImplementation
{
  protected static async ACSContextFactory(
    self: InvoiceService,
    request: InvoiceList & InvoiceIdList & DeleteRequest,
    context: any,
  ): Promise<ACSClientContext> {
    const ids = request.ids ?? request.items?.map((item: any) => item.id);
    const resources = await self.get(ids, request.subject, context);
    return {
      ...context,
      subject: request.subject,
      resources: [
        ...resources.items ?? [],
        ...request.items ?? [],
      ],
    };
  }

  protected readonly status_codes = {
    OK: {
      code: 200,
      message: 'OK',
    },
    NOT_FOUND: {
      code: 404,
      message: '{entity} {id} not found!',
    },
    MISSING_REQUIRED_FIELD: {
      code: 500,
      message: '{entity} {id} has no {error}!',
    },
    CONTENT_NOT_SUPPORTED: {
      code: 400,
      message: '{entity} {id}: Content type {error} is not supported!',
    },
    PROTOCOL_NOT_SUPPORTED: {
      code: 400,
      message: '{entity} {id}: Protocol of {error} is not supported!',
    },
    FETCH_FAILED: {
      code: 500,
      message: '{entity} {id}: {error}!',
    },
  };

  protected readonly operation_status_codes = {
    SUCCESS: {
      code: 200,
      message: 'SUCCESS',
    },
    PARTIAL: {
      code: 400,
      message: 'Patrial executed with errors!',
    },
    LIMIT_EXHAUSTED: {
      code: 500,
      message: 'Query limit 1000 exhausted!',
    },
    NO_TEMPLATES: {
      code: 500,
      message: 'No render templates defined!',
    },
    TIMEOUT: {
      code: 500,
      message: 'Request timeout, API not responding!',
    },
  };

  protected readonly tech_user: Subject;
  protected readonly awaits_render_result = new ResourceAwaitQueue<string[]>;
  protected readonly pdf_rendering_service: Client<PdfRenderingServiceDefinition>;
  protected readonly notification_service: Client<NotificationReqServiceDefinition>;
  protected readonly ostorage_service: Client<ObjectServiceDefinition>;
  protected readonly user_service: Client<UserServiceDefinition>;
  protected readonly default_setting: ResolvedSetting;
  protected readonly default_templates: Template[] = [];
  protected readonly urns: KnownUrns;
  protected readonly kafka_timeout = 5000;
  protected readonly emitters = {
    INVALID: 'invoiceInvalid',
    PENDING: 'invoicePending',
    RENDERED: 'invoiceRendered',
    SENT: 'invoiceSent',
    WITHDRAWN: 'invoiceWithdrawn',
    CANCELLED: 'invoiceCancelled'
  };

  constructor(
    protected readonly invoicingTopic: Topic,
    protected readonly renderingTopic: Topic,
    protected readonly notificationTopic: Topic,
    protected readonly db: DatabaseProvider,
    protected readonly redis: RedisClientType,
    protected readonly cfg: ServiceConfig,
    logger: Logger,
    protected readonly invoice_number_srv = new InvoiceNumberService(
      invoicingTopic,
      db,
      cfg,
      logger,
    ),
    client_register = new ClientRegister(cfg, logger),
    protected readonly aggregator = new ResourceAggregator(cfg, logger, client_register),
  ) {
    super(
      cfg.get('database:main:entities:0') ?? 'invoice',
      invoicingTopic,
      logger,
      new ResourcesAPIBase(
        db,
        cfg.get('database:main:collections:0') ?? 'invoices',
        cfg.get('fieldHandlers'),
        undefined,
        undefined,
        logger,
      ),
      !!cfg.get('events:enableEvents'),
    );

    this.notification_service = createClient(
      {
        ...cfg.get('client:notification_req'),
        logger
      } as GrpcClientConfig,
      NotificationReqServiceDefinition,
      createChannel(cfg.get('client:notification_req:address')),
    );

    this.pdf_rendering_service = createClient(
      {
        ...cfg.get('client:pdf_rendering'),
        logger
      } as GrpcClientConfig,
      PdfRenderingServiceDefinition,
      createChannel(cfg.get('client:pdf_rendering:address')),
    );

    this.ostorage_service = createClient(
      {
        ...cfg.get('client:ostorage'),
        logger
      } as GrpcClientConfig,
      ObjectServiceDefinition,
      createChannel(cfg.get('client:ostorage:address')),
    );

    this.user_service = client_register.get(UserServiceDefinition);

    this.urns = {
      ...DefaultUrns,
      ...cfg.get('urns'),
      ...cfg.get('urns:authentication'),
    };
    this.default_setting = {
      ...DefaultSetting,
      ...cfg.get('default:Setting'),
    };
    this.emitters = {
      ...this.emitters,
      ...cfg.get('events:emitters'),
    };

    this.tech_user = cfg.get('authorization:techUser');
    this.kafka_timeout = cfg.get('kafka:timeout') ?? 5000;
  }

  protected createStatusCode(
    id?: string,
    entity?: string,
    status?: Status,
    entity_id?: string,
    error?: string,
  ): Status {
    return {
      id,
      code: Number.isInteger(status?.code) ? status.code : 500,
      message: status?.message?.replace(
        '{error}', error ?? 'undefined'
      ).replace(
        '{entity}', entity ?? 'undefined'
      ).replace(
        '{id}', entity_id ?? 'undefined'
      ) ?? 'Unknown status',
    };
  }

  protected throwStatusCode(
    id?: string,
    entity?: string,
    status?: Status,
    entity_id?: string,
    error?: string,
  ): Status {
    throw this.createStatusCode(
      id,
      entity,
      status,
      entity_id,
      error,
    );
  }

  protected catchStatusError(e: any, id?: string): Status {
    const status = {
      id,
      code: Number.isInteger(e?.code) ? e.code : 500,
      message: e?.message ?? e?.details ?? (e ? JSON.stringify(e) : 'Unknown Error!'),
    };
    this.logger?.error({ status, stack: e?.stack });
    return status;
  }

  protected createOperationStatusCode(
    status?: OperationStatus,
    entity?: string,
    id?: string,
  ): OperationStatus {
    return {
      code: Number.isInteger(status?.code) ? status.code : 500,
      message: status?.message?.replace(
        '{entity}', entity ?? 'undefined'
      ).replace(
        '{id}', id ?? 'undefined'
      ) ?? 'Unknown status',
    };
  }

  protected catchOperationError(e: any) {
    const status = {
      items: new Array<any>(),
      total_count: 0,
      operation_status: {
        code: Number.isInteger(e?.code) ? e.code : 500,
        message: e?.message ?? e?.details ?? (e ? JSON.stringify(e) : 'Unknown Error!'),
      }
    };
    this.logger?.error({ status, stack: e?.stack });
    return status;
  }

  protected resolveSettings(
    ...settings: Setting[]
  ): ResolvedSetting {
    const smap = new Map<string, string>(
      settings?.flatMap(
        s => s?.settings?.map(
          s => [s.id, s.value]
        ) ?? []
      ) ?? []
    );
    const sobj = Object.assign(
      {},
      ...Object.entries(this.urns).filter(
        ([key, value]) => smap.has(value)
      ).map(
        ([key, value]) => ({ [key]: parseSetting(key, smap.get(value)) })
      )
    );

    sobj.shop_default_bucket ??= this.default_setting.shop_default_bucket;
    sobj.shop_html_bucket ??= sobj.shop_default_bucket;
    sobj.shop_pdf_bucket ??= sobj.shop_default_bucket;
    
    return {
      ...this.default_setting,
      ...sobj,
    };
  }

  protected async resolveProductBundles(
    products: ResourceMap<Product>,
    output?: ResourceMap<Product>,
  ): Promise<ResourceMap<Product>> {
    output ??= products;
    const ids = products?.all.filter(
      p => p.bundle
    ).flatMap(
      p => p.bundle.products.map(
        p => p.product_id
      )
    );

    if (ids?.length) {
      const bundled_products = await this.aggregator.getByIds<Product>(
        ids,
        ProductServiceDefinition
      );

      bundled_products.forEach(
        p => output.set(p.id, p)
      );

      await this.resolveProductBundles(
        bundled_products,
        output,
      );
    }
    return output;
  }

  protected async get(
    ids: string[],
    subject?: Subject,
    context?: any,
  ): Promise<InvoiceListResponse> {
    ids = [...new Set(ids)].filter(id => id);
    if (ids.length > 1000) {
      throw {
        code: 500,
        message: 'Query exceeds limit of 1000!'
      } as OperationStatus;
    }

    if (ids.length === 0) {
      return {
        total_count: 0,
        operation_status: this.operation_status_codes.SUCCESS,
      };
    }

    const request = ReadRequest.fromPartial({
      filters: [{
        filters: [{
          field: '_key',
          operation: Filter_Operation.in,
          value: JSON.stringify(ids),
          type: Filter_ValueType.ARRAY
        }]
      }],
      subject
    });
    return await super.read(request, context);
  }

  protected async generateInvoiceNumbers(
    aggregation: AggregatedInvoiceList,
    context?: CallContext,
  ) {
    const shops = aggregation.shops;
    const settings = new Map(
      shops.all.map(
        shop => [
          shop.id,
          this.resolveSettings(
            aggregation.settings.get(
              shop.setting_id
            )
          )
        ]
      )
    );

    await Promise.all(aggregation.items?.map(async (item) => {
      const shop = shops.get(item.shop_id);
      const setting = settings.get(shop.setting_id);
      const key = `invoice:counter:${shop.id}`;
      const increment = setting?.shop_invoice_number_increment ?? 1;
      const current = await this.redis.exists(
        key
      ).then(
        async (exists) => {
          if (exists) {
            return await this.redis.incrBy(key, increment);
          }
          else {
            return await this.invoice_number_srv.read(
              {
                filters: [{
                  filters: [{
                    field: 'shop_id',
                    value: shop.id,
                  }]
                }],
                limit: 1,
                sorts: [
                  {
                    field: 'counter',
                    order: Sort_SortOrder.DESCENDING,
                  }
                ]
              },
              context
            ).then(
              resp => {
                const current = resp.items?.pop()?.payload.counter;
                return current !== undefined ? current + 1 : undefined;
              }
            );
          }
        }
      ).then(
        async current => {
          if (current === undefined) {
            current = setting?.shop_invoice_number_start ?? 0;
            await this.redis.set(key, current);
          }
          return current;
        }
      );

      const pattern = setting?.shop_invoice_number_pattern ?? 'invoice-%010i';
      const invoice_number = pattern ? sprintf(pattern, current) : current.toString();
      item.invoice_number = invoice_number;
    }));

    await Promise.all(shops.all.map(
      shop => this.redis.get(`invoice:counter:${shop.id}`).then(
        (counter: any) => ({
          id: shop.id,
          counter: counter as number
        })
      )
    )).then(
      counters => {
        this.invoice_number_srv.upsert(
          {
            items: counters.map(item => ({
              id: item.id,
              shop_id: item.id,
              counter: item.counter,
            })),
            total_count: counters.length,
            subject: aggregation.subject
          },
          context,
        );
      }
    );

    return aggregation;
  }

  @access_controlled_function({
    action: AuthZAction.EXECUTE,
    operation: Operation.whatIsAllowed,
    context: DefaultACSClientContextFactory,
    resource: DefaultResourceFactory('execution.generateInvoiceNumber'),
    useCache: true,
  })
  public async generateInvoiceNumber(
    request: RequestInvoiceNumber,
    context?: CallContext,
  ): Promise<InvoiceNumberResponse> {
    const shop = await this.aggregator.getByIds<Shop>(
      request.shop_id!,
      ShopServiceDefinition,
      request.subject,
      context,
    ).then(
      resp => resp.get(request.shop_id)
    );

    const setting = await this.aggregator.getByIds<Setting>(
      shop.setting_id!,
      ShopServiceDefinition,
      request.subject,
      context,
    ).then(
      resp => resp.get(shop.setting_id!)
    ).then(
      setting => this.resolveSettings(
        setting
      )
    );

    const key = `invoiceCounter:${shop.id}`;
    const increment = setting?.shop_invoice_number_increment ?? 1;
    const current = await this.redis.exists(
      key
    ).then(
      async (exists) => {
        if (exists) {
          return await this.redis.incrBy(key, increment);
        }
        else {
          return await this.invoice_number_srv.read(
            {
              filters: [{
                filters: [{
                  field: 'shop_id',
                  value: shop.id,
                }]
              }],
              limit: 1,
              sorts: [
                {
                  field: 'counter',
                  order: Sort_SortOrder.DESCENDING,
                }
              ]
            },
            context
          ).then(
            resp => {
              return resp.items?.pop()?.payload.counter + 1;
            }
          );
        }
      }
    ).then(
      async current => {
        if (current === undefined) {
          current = setting?.shop_invoice_number_start ?? 0;
          await this.redis.set(key, current);
        }
        return current;
      }
    );

    const pattern = setting?.shop_invoice_number_pattern ?? 'i-%010i';
    const invoice_number = sprintf(pattern, current);
    await this.invoice_number_srv.upsert(
      {
        items: [{
          id: shop.id,
          shop_id: shop.id,
          counter: current,
          invoice_number,
        }],
        total_count: 1,
        subject: request.subject
      },
      context,
    );

    return {
      invoice_number,
      operation_status: this.operation_status_codes.SUCCESS,
    };
  }

  protected async aggregate(
    invoice_list: InvoiceList,
    subject?: Subject,
    context?: CallContext,
  ): Promise<AggregatedInvoiceList> {
    const aggregation = await this.aggregator.aggregate(
      invoice_list,
      [
        {
          service: ShopServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items?.map(
            i => i.shop_id
          ).filter(i => i) ?? [],
          container: 'shops',
          entity: 'Shop',
        },
        {
          service: CustomerServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items?.map(
            i => i.customer_id
          ).filter(i => i) ?? [],
          container: 'customers',
          entity: 'Customer',
        },
        {
          service: ProductServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items?.flatMap(
            i => i.sections
          )?.flatMap(
            section => section.positions
          )?.flatMap(
            position => position.product_item?.product_id
          ).filter(i => i) ?? [],
          container: 'products',
          entity: 'Product',
        },
        {
          service: FulfillmentProductServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items?.flatMap(
            i => i.sections
          )?.flatMap(
            section => section.positions
          )?.flatMap(
            position => position.fulfillment_item?.product_id
          ).filter(i => i) ?? [],
          container: 'fulfillment_products',
          entity: 'FulfillmentProduct',
        },
      ],
      {} as AggregationTemplate,
      subject,
      context,
    ).then(
      async aggregation => {
        aggregation.products = await this.resolveProductBundles(
          aggregation.products
        );
        return aggregation;
      }
    ).then(
      async aggregation => await this.aggregator.aggregate(
        aggregation,
        [
          {
            service: UserServiceDefinition,
            map_by_ids: (aggregation) => aggregation.customers?.all.map(
              customer => customer.private?.user_id
            ).filter(i => i),
            container: 'users',
            entity: 'User',
          },
          {
            service: OrganizationServiceDefinition,
            map_by_ids: (aggregation) => [].concat(
              aggregation.customers?.all.map(
                customer => customer.public_sector?.organization_id
              ),
              aggregation.customers?.all.map(
                customer => customer.commercial?.organization_id
              ),
              aggregation.shops?.all.map(
                shop => shop?.organization_id
              ),
            ).filter(i => i),
            container: 'organizations',
            entity: 'Organization',
          },
          {
            service: ManufacturerServiceDefinition,
            map_by_ids: (aggregation) => aggregation.products?.all.map(
              product => product!.product?.manufacturer_id
            ).filter(i => i),
            container: 'manufacturers',
            entity: 'Manufacturer',
          },
          {
            service: TaxServiceDefinition,
            map_by_ids: (aggregation) => aggregation.products?.all.flatMap(
              product => [].concat(
                product.product?.tax_ids,
                product.product?.physical?.variants?.flatMap(
                  variant => variant.tax_ids
                ),
                product.product?.virtual?.variants?.flatMap(
                  variant => variant.tax_ids
                ),
                product.product?.service?.variants?.flatMap(
                  variant => variant.tax_ids
                ),
              )
            ).filter(i => i),
            container: 'taxes',
            entity: 'Tax',
          },
          {
            service: TemplateServiceDefinition,
            map_by_ids: (aggregation) => aggregation.shops?.all.flatMap(
              shop => shop?.template_ids
            ).filter(i => i),
            container: 'templates',
            entity: 'Template',
          },
          {
            service: SettingServiceDefinition,
            map_by_ids: (aggregation) => aggregation.shops?.all.map(
              shop => shop?.setting_id
            ).filter(i => i),
            container: 'settings',
            entity: 'Setting',
          },
        ],
        {} as AggregationTemplate,
        subject,
        context,
      )
    ).then(
      async aggregation => await this.aggregator.aggregate(
        aggregation,
        [
          {
            service: ContactPointServiceDefinition,
            map_by_ids: (aggregation) => [].concat(
              aggregation.customers.all.flatMap(
                customer => customer.private?.contact_point_ids
              ),
              aggregation.organizations.all.flatMap(
                organization => organization.contact_point_ids
              )
            ).filter(i => i),
            container: 'contact_points',
            entity: 'ContactPoint',
          },
        ],
        {} as AggregationTemplate,
        subject,
        context,
      )
    );
    return aggregation;
  }

  protected packRenderData (
    aggregation: AggregatedInvoiceList,
    invoice: Invoice,
  ) {
    const resolved = {
      invoice: resolveInvoice(
        aggregation,
        invoice
      ),
      statics: {},
      l10n: {},
    };
    const buffer = marshallProtobufAny(resolved);
    return buffer;
  }

  protected async loadDefaultTemplates(subject?: Subject, context?: CallContext) {
    if(this.default_templates.length) {
      return this.default_templates;
    }

    this.default_templates.push(...(this.cfg.get('default:Templates') ?? []));
    const ids = this.default_templates.map(t => t.id);
    if (ids.length) {
      await this.aggregator.getByIds(
        ids,
        TemplateServiceDefinition,
        subject ?? this.tech_user,
        context,
      ).then(
        resp_map => {
          this.default_templates.forEach(
            template => Object.assign(
              template,
              resp_map.get(template.id, null) // null for ignore missing
            )
          )
        }
      );
    }

    return this.default_templates;
  }

  protected async fetchFile(url: string, subject?: Subject): Promise<string> {
    if (url?.startsWith('file://')) {
      return fs.readFileSync(url.slice(7)).toString();
    }
    else if (url?.startsWith('http')) {
      return fetch(
        url,
        subject?.token ? {
          headers: {
            Authorization: `Bearer ${subject.token}`
          }
        } : undefined
      ).then(resp => resp.text())
    }
    else {
      throw this.createStatusCode(
        undefined,
        'Template',
        this.status_codes.PROTOCOL_NOT_SUPPORTED,
        undefined,
        url,
      );
    }
  }

  protected async fetchLocalization(
    template: Template,
    locales: string[],
    subject?: Subject,
  ) {
    const locale = locales?.find(
      a => template.localization?.some(
        b => b.local_codes?.includes(a)
      )
    ) ?? 'en';
    const L = template.localization?.find(
      a => a.local_codes?.includes(locale)
    );
    const url = L?.l10n?.url;
    const l10n = url ? await this.fetchFile(url, subject).then(
      text => {
        if (L.l10n.content_type === 'application/json') {
          return JSON.parse(text);
        }
        else if (L.l10n.content_type === 'text/csv') {
          return CSV(text, {
            columns: true,
            skip_empty_lines: true,
            objname: 'key',
            escape: '\\',
            trim: true,
            delimiter: ',',
            ignore_last_delimiters: true,
          });
        }
        else {
          throw this.createStatusCode(
            template.id,
            'Template',
            this.status_codes.CONTENT_NOT_SUPPORTED,
            template.id,
            L.l10n.content_type,
          );
        }
      }
    ).then(
      l10n => Object.assign(l10n, { _locale: locale })
    ) : undefined;
  
    return l10n;
  }

  protected async emitRenderRequest(
    item: Invoice,
    aggregation: AggregatedInvoiceList,
    render_id: string,
    use_case: TemplateUseCase,
    default_templates?: Template[],
    subject?: Subject,
  ) {
    const shop = aggregation.shops.get(item.shop_id);
    const customer = aggregation.customers.get(item.customer_id);
    const setting = this.resolveSettings(
      aggregation.settings.get(
        customer.setting_id
      ),
      aggregation.settings.get(
        shop.setting_id
      ),
    );
    const locales = [
      ...(setting?.customer_locales ?? []),
      ...(setting?.shop_locales ?? []),
    ];
    const templates = shop.template_ids?.map(
      id => aggregation.templates?.get(id)
    ).filter(
      template => template.use_case === use_case
    ).sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    ) ?? [];

    if (templates.length === 0 && default_templates.length > 0) {
      templates.push(...default_templates);
    }
    else {
      throw this.createOperationStatusCode(
        this.operation_status_codes.NO_TEMPLATES
      );
    }

    const bodies = await Promise.all(
      templates.map(
        template => template.body?.url ? this.fetchFile(
          template.body.url, subject
        ) : undefined
      )
    );
    const layouts = await Promise.all(
      templates.map(
        template => template.layout?.url ? this.fetchFile(
          template.layout.url, subject
        ) : undefined
      )
    );
    const l10n = await Promise.all(
      templates.map(
        template => this.fetchLocalization(
          template, locales, subject
        )
      )
    );

    const payloads: Payload[] = templates.map(
      (template, i) => ({
        content_type: 'text/html',
        data: this.packRenderData(
          aggregation,
          item,
        ),
        templates: marshallProtobufAny({
          [i]: {
            body: bodies[i],
            layout: layouts[i],
          },
        }),
        style_url: template.styles?.find(s => s.url).url,
        options: l10n[i] ? marshallProtobufAny({
          locale: l10n[i]._locale,
          texts: l10n[i]
        }) : undefined
      })
    );

    return this.renderingTopic.emit(
      'renderRequest',
      {
        id: render_id,
        payloads,
      } as RenderRequest
    );
  }

  @access_controlled_function({
    action: AuthZAction.READ,
    operation: Operation.whatIsAllowed,
    context: DefaultACSClientContextFactory,
    resource: [{ resource: 'invoice' }],
    database: 'arangoDB',
    useCache: true,
  })
  public override async read(
    request: ReadRequest,
    context?: CallContext,
  ): Promise<InvoiceListResponse> {
    return super.read(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  @access_controlled_function({
    action: AuthZAction.CREATE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('invoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public override async create(
    request: InvoiceList,
    context: CallContext,
  ): Promise<InvoiceListResponse> {
    return super.create(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  @access_controlled_function({
    action: AuthZAction.CREATE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('invoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public override async update(
    request: InvoiceList,
    context?: CallContext,
  ): Promise<InvoiceListResponse> {
    return super.update(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  @access_controlled_function({
    action: AuthZAction.CREATE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('invoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public override async upsert(
    request: InvoiceList,
    context?: CallContext,
  ): Promise<InvoiceListResponse> {
    return super.upsert(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  @access_controlled_function({
    action: AuthZAction.EXECUTE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('execution.renderInvoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public async render(
    request: InvoiceList,
    context?: CallContext,
  ): Promise<InvoiceListResponse> {
    try {
      const response_map = new Map<string, InvoiceResponse>(
        request.items.map(
          item => [
            item.id,
            {
              payload: item
            }
          ]
        )
      );

      const aggregation = await this.aggregate(
        request,
        this.tech_user ?? request.subject,
        context,
      ).then(
        aggregation => this.generateInvoiceNumbers(aggregation, context)
      );

      const default_templates = await this.loadDefaultTemplates().then(
        df => df.filter(
          template => template.use_case === TemplateUseCase.INVOICE_PDF
        )
      );
      const response = await Promise.all(aggregation.items.map(
        async (item) => {
          const render_id = `invoice/pdf/${item!.id}`;
          return await this.emitRenderRequest(
            item,
            aggregation,
            render_id,
            TemplateUseCase.INVOICE_PDF,
            default_templates,
            request.subject,
          ).then(
            async (): Promise<RenderResult> => ({
              id: item.id,
              body: await this.awaits_render_result.await(
                render_id, this.kafka_timeout
              ).then(
                b => b.join('')
              ),
              status: {
                code: 200,
                message: 'OK',
              }
            })
          ).catch(
            (err): RenderResult => ({
              status: this.catchStatusError(err, item.id)
            })
          ).then(
            response => {
              if (response.status?.code === 200) {
                const invoice = item;
                const shop = aggregation.shops.get(invoice.shop_id);
                const setting = this.resolveSettings(
                  aggregation.settings.get(
                    shop.setting_id
                  )
                );
                return this.renderPdf(
                  invoice,
                  response.body,
                  setting,
                  this.tech_user ?? request.subject,
                  context,
                );
              }
              else {
                response_map.get(item.id).status = response.status;
                return undefined;
              }
            }
          )
        }
      )).then(
        items => items.filter(
          item => item?.status?.code === 200
        ).map(
          item => item.payload
        )
      ).then(
        items => super.upsert(
          {
            items,
            total_count: items.length,
            subject: request.subject
          },
          context
        )
      ).then(
        response => {
          if (response.operation_status?.code !== 200) {
            return response;
          }

          response.items?.forEach(
            item => {
              const id = item.payload?.id ?? item.status?.id;
              if (id) {
                response_map.set(id, item);
              }
            }
          );

          const items = [...response_map.values()];
          const operation_status = items.every(
            item => item.status?.code === 200
          ) ? this.operation_status_codes.SUCCESS
            : this.operation_status_codes.PARTIAL;

          return {
            items,
            total_count: items.length,
            operation_status
          };
        }
      );

      response.items.forEach(item => {
        if (item.status?.code === 200) {
          this.events.emit(this.emitters.RENDERED ?? 'invoiceRendered', item.payload);
        }
      });

      return response;
    }
    catch (e: any) {
      return this.catchOperationError(e);
    }
  }

  @resolves_subject()
  @injects_meta_data()
  @access_controlled_function({
    action: AuthZAction.EXECUTE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('execution.sendInvoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public async send(
    request: InvoiceIdList,
    context?: CallContext,
  ): Promise<StatusListResponse> {
    try {
      const ids = request.items!.map(item => item.id);
      const aggregation = await this.get(
        ids,
        request.subject,
        context,
      ).then(
        response => {
          if (response.operation_status?.code === 200) {
            return {
              items: response.items.map(
                item => item.payload
              ),
              total_count: response.items.length,
            };
          }
          else {
            throw response.operation_status;
          }
        }
      ).then(
        invoices => this.aggregate(
          invoices,
          this.tech_user ?? request.subject,
          context,
        )
      );

      const default_templates = await this.loadDefaultTemplates().then(
        df => df.filter(
          template => template.use_case === TemplateUseCase.INVOICE_EMAIL
        )
      );
      const items = await Promise.all(aggregation.items.map(
        async (item) => {
          const render_id = `invoice/email/${item!.id}`;
          return await this.emitRenderRequest(
            item,
            aggregation,
            render_id,
            TemplateUseCase.INVOICE_EMAIL,
            default_templates,
            request.subject,
          ).then(
            () => this.awaits_render_result.await(render_id, 1000)
          ).then(
            async (bodies) => {
              const shop = aggregation.shops.get(item.shop_id);
              const customer = aggregation.customers.get(item.customer_id);
              const setting = this.resolveSettings(
                aggregation.settings.get(
                  customer.setting_id
                ),
                aggregation.settings.get(
                  shop.setting_id
                ),
              );
              const title = bodies.shift();
              const body = bodies.join('');

              return this.sendNotification(
                item,
                body,
                setting,
                title,
                item.documents?.filter(
                  d => d.content_type === 'application/pdf'
                ).map(
                  d => d.id
                ),
                this.tech_user ?? request.subject,
                context,
              );
            }
          )
        }
      ));

      const response = await super.update({
        items,
        subject: request.subject
      }, context);
      const status = response.items.map(item => item.status);

      return {
        status,
        operation_status: response.operation_status
      };
    }
    catch (e: any) {
      return this.catchOperationError(e);
    }
  }

  @resolves_subject()
  @access_controlled_function({
    action: AuthZAction.EXECUTE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('execution.withdrawInvoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public async withdraw(
    request: InvoiceIdList,
    context?: CallContext,
  ): Promise<InvoiceListResponse> {
    request.items = request.items?.map(
      item => ({
        id: item.id,
        withdrawn: true,
      })
    );

    return this.update(
      request,
      context,
    );
  }

  @resolves_subject()
  @access_controlled_function({
    action: AuthZAction.DELETE,
    operation: Operation.isAllowed,
    context: InvoiceService.ACSContextFactory,
    resource: DefaultResourceFactory('invoice'),
    database: 'arangoDB',
    useCache: true,
  })
  public override async delete(
    request: DeleteRequest,
    context?: CallContext,
  ): Promise<DeleteResponse> {
    return super.delete(request, context);
  }

  protected async storageHtmlRenderResponse(
    invoice: Invoice,
    body: string,
    setting: ResolvedSetting,
    subject: Subject,
    context?: any,
  ) {
    const buffer = Buffer.from(body);
    const stream = Readable.from(buffer);
    try {
      const document_id = uuid.v4();
      const transformer = new Transform({
        objectMode: true,
        transform: (chunk, _, done) => {
          const data = {
            bucket: setting.shop_html_bucket,
            key: [
              invoice.shop_id,
              invoice.id,
              document_id,
              `${invoice.invoice_number}.html`
            ].join(setting.shop_bucket_key_delimiter),
            object: chunk,
            meta: invoice.meta,
            options: {
              content_type: 'text/html',
              ...setting.shop_html_bucket_options,
            },
            subject: this.tech_user ?? subject,
          };
          done(null, data);
        }
      });

      invoice = await this.ostorage_service.put(
        stream.pipe(transformer)
      ).then(
        resp => {
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          else if (resp.response?.status?.code !== 200) {
            throw resp.response?.status;
          }
          const obj = resp.response.payload;
          const filename = basename(obj.key);
          invoice.documents ??= [];
          invoice.documents.push(
            {
              id: document_id,
              url: [
                setting.shop_bucket_endpoint,
                obj.url.replace('//', ''),
              ].join('/'),
              caption: filename,
              filename,
              bytes: buffer.byteLength,
              content_type: 'text/html',
            }
          );
          return invoice;
        }
      ).then(
        invoice => super.update(
          {
            items: [invoice],
            total_count: 1,
            subject,
          },
          context,
        )
      ).then(
        resp => resp.items.pop().payload
      );
    }
    finally {
      stream.destroy();
    }

    return invoice;
  }

  protected async storagePDFRenderResponse(
    invoice: Invoice,
    buffer: Buffer,
    setting: ResolvedSetting,
    subject: Subject,
    context?: any,
  ) {
    const stream = Readable.from(buffer);
    try {
      const document_id = uuid.v4();
      const key = [
        invoice.shop_id,
        invoice.id,
        document_id,
        `${invoice.invoice_number}.pdf`
      ].join(setting.shop_bucket_key_delimiter);
      const transformer = new Transform({
        objectMode: true,
        transform: (chunk, _, done) => {
          const data = {
            bucket: setting.shop_pdf_bucket,
            key,
            object: chunk,
            meta: invoice.meta,
            options: {
              content_type: 'application/pdf',
              ...(setting.shop_pdf_bucket_options ?? {}),
            },
            subject,
          };
          done(null, data);
        }
      });

      invoice = await this.ostorage_service.put(
        stream.pipe(transformer)
      ).then(
        resp => {
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          else if (resp.response?.status?.code !== 200) {
            throw resp.response?.status;
          }
          const obj = resp.response.payload;
          const filename = basename(obj.key);
          invoice.documents ??= [];
          invoice.documents.push(
            {
              id: document_id,
              url: [
                setting.shop_bucket_endpoint,
                obj.url.replace('//', ''),
              ].join('/'),
              caption: filename,
              filename,
              bytes: buffer.byteLength,
              content_type: 'application/pdf',
            }
          );
          return invoice;
        }
      ).then(
        invoice => super.update(
          {
            items: [invoice],
            total_count: 1,
            subject,
          },
          context,
        )
      ).then(
        resp => resp.items.pop().payload
      );
    }
    finally {
      stream.destroy();
    }

    return invoice;
  }

  protected async renderPdf(
    invoice: Invoice,
    body: string,
    setting: ResolvedSetting,
    subject?: Subject,
    context?: any,
  ): Promise<InvoiceResponse> {
    try {
      if (!setting.shop_html_bucket_disabled) {
        await this.storageHtmlRenderResponse(
          invoice,
          body,
          setting,
          subject,
          context,
        );
      }

      const document_id = uuid.v4();
      const timestamp = new Date().toISOString();
      const bucket = setting.shop_pdf_bucket;
      const key = [
        invoice.shop_id,
        invoice.id,
        document_id,
        `${invoice.invoice_number}.pdf`
      ].join(setting.shop_bucket_key_delimiter);
      await this.pdf_rendering_service.render({
        combined: {
          output: {
            meta_data: {
              creator: invoice.user_id,
              producer: invoice.shop_id,
              title: invoice.invoice_number,
            },
            /*
            upload_options: {
              bucket: setting.shop_pdf_bucket,
              key,
              content_disposition: 'application/pdf',
            }
            */
          },
          data: [
            {
              source: {
                html: body,
              },
              options: {
                puppeteer_options: setting.shop_puppeteer_options,
              },
            }
          ]
        },
        subject,
      }).then(
        async (resp) => {
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          else if (resp.combined.payload?.upload_result) {
            const filename = basename(key);
            invoice.documents ??= [];
            invoice.documents.push({
              id: timestamp,
              url: [
                setting.shop_bucket_endpoint,
                bucket,
                key,
              ].join('/'),
              caption: filename,
              filename,
              bytes: resp.combined.payload.upload_result.length,
              content_type: 'application/pdf',
            } as File);
          }
          else if (resp.combined.payload?.pdf?.data) {
            await this.storagePDFRenderResponse(
              invoice,
              resp.combined.payload.pdf.data,
              setting,
              subject,
              context,
            );
          }
        }
      );

      return {
        payload: invoice,
        status: this.status_codes.OK,
      };
    }
    catch (err) {
      return {
        payload: invoice,
        status: this.catchStatusError(err, invoice?.id)
      };
    }
  }

  protected async sendNotification(
    invoice: Invoice,
    body: string,
    setting: ResolvedSetting,
    title?: string,
    document_ids?: string[],
    subject?: Subject,
    context?: any,
  ) {
    const attachments = await Promise.all(
      document_ids?.map(async (id) => {
        const doc = invoice.documents?.find(doc => doc.id === id);
        
        if (!doc) {
          throw this.createStatusCode(
            invoice.id,
            'Document',
            this.status_codes.NOT_FOUND,
            id,
          );
        }
        else if (!doc.url) {
          throw this.createStatusCode(
            invoice.id,
            'Document',
            this.status_codes.MISSING_REQUIRED_FIELD,
            id,
            'url'
          );
        }

        this.logger.error(doc.url,
          {
            headers: {
              Authorization: `Bearer ${subject.token}`
            }
          });

        return await fetch(
          doc.url,
          {
            headers: {
              Authorization: `Bearer ${subject.token}`
            }
          }
        ).then(
          async (f) => {
            if (!f.ok || f.status !== 200) {
              const text = await f.text().catch();
              throw this.createStatusCode(
                invoice.id,
                'Document',
                this.status_codes.FETCH_FAILED,
                doc.url,
                `${f.status}, ${f.statusText}, ${text}`,
              );
            }
            return f.arrayBuffer()
          }
        ).then(
          ab => ({
            buffer: Buffer.from(ab),
            filename: doc.filename,
            content_type: doc.content_type,
          })
        )
      }) ?? []
    );

    const status = await this.notification_service.send(
      {
        transport: 'email',
        provider: setting.shop_email_provider,
        email: {
          to: [invoice.recipient.contact.email],
          cc: [
            ...(setting.customer_email_cc ?? []),
            ...(setting.shop_email_cc ?? []),
          ],
          bcc: [
            ...(setting.customer_email_bcc ?? []),
            ...(setting.shop_email_bcc ?? []),
          ],
        },
        subject: title ?? invoice.invoice_number,
        body,
        attachments,
      },
      context
    );

    if (status?.operation_status?.code === 200) {
      invoice.sent = true;
    }

    return invoice;
  }

  public async handleRenderResponse(
    response: RenderResponse,
    context?: CallContext,
  ) {
    try {
      const [entity] = response.id.split('/');
      if (entity !== 'invoice') return;
      const content = response.responses.map(
        r => JSON.parse(r.value.toString())
      );
      const errors = content.filter(
        c => c.error
      ).map(
        c => c.error
      );

      if (errors?.length) {
        const status: Status = {
          code: 500,
          message: errors.join('\n'),
        };

        this.awaits_render_result.reject(response.id, status);
      }
      else {
        const bodies = content.flatMap(
          c => Object.values(c)
        ) as string[];
        this.awaits_render_result.resolve(response.id, bodies);
      }
    }
    catch (e: any) {
      this.logger.error('Error on handleRenderResponse:', e);
    }
  }
}