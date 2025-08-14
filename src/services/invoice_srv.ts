import * as fs from 'node:fs';
import { basename } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { sprintf } from 'sprintf-js';
import { parse as CSV } from 'csv-parse/sync';
import { type RedisClientType } from 'redis';
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
  Sort_SortOrder
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import {
  ACSClientContext,
  AuthZAction,
  DefaultACSClientContextFactory,
  DefaultResourceFactory,
  Operation,
  access_controlled_function,
  injects_meta_data,
  resolves_subject,
} from '@restorecommerce/acs-client';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import {
  RenderRequest_Template,
  RenderRequestList,
  RenderResponseList,
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
import {
  CountryServiceDefinition
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/country.js';
import {
  AddressServiceDefinition
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/address.js';
import {
  CurrencyServiceDefinition
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/currency.js';
import { InvoiceNumberService } from './invoice_number_srv.js';
import {
  AccessControlledServiceBase,
  ClientRegister,
  ResourceAwaitQueue,
  ResourceAggregator,
  ResourceMap,
} from '../experimental/index.js';
import {
  type KnownUrns,
  type AggregatedInvoiceList,
  type ResolvedSetting,
  DefaultUrns,
  InvoiceAggregationTemplate,
  DefaultSetting,
  parseSetting,
  marshallProtobufAny,
  packRenderData,
  makeID,
} from '../utils.js';


export type ProductNature = PhysicalProduct | VirtualProduct | ServiceProduct;
export type ProductVariant = PhysicalVariant | VirtualVariant | ServiceVariant;
export type PositionProduct = ProductVariant | Bundle;
export type AggregatedPosition = Position & {
  product: PositionProduct;
};
export type RenderResult = {
  payload?: {
    id?: string;
    content?: {
      header?: string;
      body?: string;
      footer?: string;
    };
  }
  status?: Status;
};

export type AwaitStringFunc = (value: string) => void;
export type AwaitStringMutex = {
  resolve: AwaitStringFunc;
  reject: (error: any) => any;
};

export class InvoiceService
  extends AccessControlledServiceBase<InvoiceListResponse, InvoiceList>
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
    PDF_RENDER_FAILED: {
      code: 500,
      message: '{entity} {id}: PDF-Rendering failed!',
    },
    NO_TEMPLATE_BODY: {
      code: 500,
      message: 'No body defined in template {id}!',
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
    NO_ITEM: {
      code: 400,
      message: 'No {entity} in query!',
    },
  };

  protected readonly tech_user: Subject;
  protected readonly awaits_render_result = new ResourceAwaitQueue<{id?: string, body?: string}[]>;
  protected readonly pdf_rendering_service: Client<PdfRenderingServiceDefinition>;
  protected readonly notification_service: Client<NotificationReqServiceDefinition>;
  protected readonly ostorage_service: Client<ObjectServiceDefinition>;
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
  protected readonly contact_point_type_ids = {
    legal: 'legal',
    billing: 'billing',
    shipping: 'shipping',
  }

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
      db,
      cfg,
      logger,
      cfg.get('events:enableEvents')?.toString() === 'true',
      cfg.get('database:main:collections:0') ?? 'invoices',
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
    this.contact_point_type_ids = {
      ...this.contact_point_type_ids,
      ...cfg.get('contactPointTypeIds'),
    }

    this.tech_user = cfg.get('authorization:techUser');
    this.kafka_timeout = cfg.get('events:kafka:timeout') ?? 5000;
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
      message: status?.message?.replaceAll(
        '{error}', error ?? 'undefined'
      ).replaceAll(
        '{entity}', entity ?? 'undefined'
      ).replaceAll(
        '{id}', entity_id ?? 'undefined'
      ) ?? 'Unknown status',
    };
  }

  protected throwStatusCode<T>(
    id?: string,
    entity?: string,
    status?: Status,
    entity_id?: string,
    error?: string,
  ): T {
    throw this.createStatusCode(
      id,
      entity,
      status,
      entity_id,
      error,
    );
  }

  protected createOperationStatusCode(
    status?: OperationStatus,
    entity?: string,
    id?: string,
  ): OperationStatus {
    return {
      code: Number.isInteger(status?.code) ? status.code : 500,
      message: status?.message?.replaceAll(
        '{entity}', entity ?? 'undefined'
      ).replaceAll(
        '{id}', id ?? 'undefined'
      ) ?? 'Unknown status',
    };
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

  protected async aggregateProductBundles(
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

      await this.aggregateProductBundles(
        bundled_products,
        output,
      );
    }
    return output;
  }

  protected async generateInvoiceNumbers(
    aggregation: AggregatedInvoiceList,
    context?: CallContext,
  ) {
    const shops = aggregation.shops;
    const settings = new Map(
      shops.all.map(
        shop => [
          shop.setting_id,
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
              async resp => {
                let current = resp.items?.pop()?.payload.counter;
                if (Number.isInteger(current)) {
                  current += 1;
                }
                else {
                  current = setting?.shop_invoice_number_start ?? 0;
                }
                await this.redis.set(key, current);
                return current;
              }
            );
          }
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
          counter: Number(counter)
        })
      )
    )).then(
      counters => {
        this.invoice_number_srv.upsert(
          {
            items: counters.filter(
              item => Number.isInteger(item.counter)
            ).map(
              item => ({
                id: item.id,
                shop_id: item.id,
                counter: item.counter,
                meta: {
                  modified: new Date(),
                }
              })
            ),
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

    const pattern = setting?.shop_invoice_number_pattern ?? 'invoice-%010i';
    const invoice_number = sprintf(pattern, current);
    await this.invoice_number_srv.upsert(
      {
        items: [{
          id: shop.id,
          shop_id: shop.id,
          counter: current,
          invoice_number,
          meta: {
            modified: new Date(),
          }
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
      InvoiceAggregationTemplate,
      subject,
      context,
    ).then(
      async aggregation => {
        aggregation.products = await this.aggregateProductBundles(
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
            map_by_ids: (aggregation) => [].concat(
              subject?.id,
              aggregation.items?.map(item => item.user_id),
              aggregation.customers?.all.map(customer => customer.private?.user_id)
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
            ),
            container: 'organizations',
            entity: 'Organization',
          },
          {
            service: ManufacturerServiceDefinition,
            map_by_ids: (aggregation) => aggregation.products?.all.map(
              product => product!.product?.manufacturer_id
            ),
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
          {
            service: CurrencyServiceDefinition,
            map_by_ids: (aggregation) => [
              aggregation.items?.flatMap(
                item => item.sections?.flatMap(
                  section => [
                    section.amounts?.flatMap(
                      amount => amount.currency_id
                    ),
                    section.positions?.flatMap(
                      position => [
                        position.unit_price?.currency_id,
                        position.amount?.currency_id
                      ]
                    )
                  ].flatMap(ids => ids)
                )
              ),
              aggregation.products.all.flatMap(
                product => [
                  product.product?.physical?.templates?.map(
                    t => t.price?.currency_id
                  ),
                  product.product?.physical?.variants?.map(
                    t => t.price?.currency_id
                  ),
                  product.product?.virtual?.templates?.map(
                    t => t.price?.currency_id
                  ),
                  product.product?.virtual?.variants?.map(
                    t => t.price?.currency_id
                  ),
                  product.product?.service?.templates?.map(
                    t => t.price?.currency_id
                  ),
                  product.product?.service?.variants?.map(
                    t => t.price?.currency_id
                  ),
                ].flatMap(ids => ids)
              ),
            ].flatMap(ids => ids),
            container: 'currencies',
            entity: 'Currency'
          }
        ],
        InvoiceAggregationTemplate,
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
        InvoiceAggregationTemplate,
        subject,
        context,
      )
    ).then(
      async aggregation => await this.aggregator.aggregate(
        aggregation,
        [
          {
            service: AddressServiceDefinition,
            map_by_ids: (aggregation) => [].concat(
              aggregation.contact_points.all.map(
                cp => cp.physical_address_id
              ),
              aggregation.items.map(
                item => item?.recipient?.address?.id
              ),
              aggregation.items.map(
                item => item?.sender?.address?.id
              ),
              aggregation.items.map(
                item => item?.billing_address?.address?.id
              ),
            ),
            container: 'addresses',
            entity: 'Address',
          },
        ],
        InvoiceAggregationTemplate,
        subject,
        context,
      )
    ).then(
      async aggregation => await this.aggregator.aggregate(
        aggregation,
        [
          {
            service: CountryServiceDefinition,
            map_by_ids: (aggregation) => [].concat(
              aggregation.addresses.all.map(
                a => a.country_id
              ),
              aggregation.taxes.all.map(
                tax => tax.country_id
              ),
              aggregation.currencies.all.flatMap(
                currency => currency.country_ids
              ),
              aggregation.items.map(
                item => item?.recipient?.address?.country_id
              ),
              aggregation.items.map(
                item => item?.sender?.address?.country_id
              ),
              aggregation.items.map(
                item => item?.billing_address?.address?.country_id
              ),
            ),
            container: 'countries',
            entity: 'Country',
          },
        ],
        {} as InvoiceAggregationTemplate,
        subject,
        context,
      )
    ).then(
      a => {
        a.items?.forEach(
          item => {
            if (!item.sender) {
              const contact_point = a.contact_points?.getMany(
                a.organizations?.get(
                  a.shops?.get(
                    item.shop_id
                  )?.organization_id
                )?.contact_point_ids
              )?.find(
                cp => cp.contact_point_type_ids?.includes(
                  this.contact_point_type_ids.billing
                )
              );
              const address = a.addresses?.get(
                contact_point?.physical_address_id
              );
              item.sender = {
                address,
                contact: {
                  email: contact_point.email,
                  name: contact_point.name,
                  phone: contact_point.telephone,
                }
              };
            }

            if (!item.recipient) {
              const customer = a.customers?.get(
                item.customer_id
              );
              const contact_point = a.contact_points?.getMany(
                [].concat(
                  a.organizations?.get(
                    customer?.commercial?.organization_id
                    ?? customer?.public_sector?.organization_id
                  )?.contact_point_ids,
                  customer?.private?.contact_point_ids
                ).filter(c => c)
              )?.find(
                cp => cp.contact_point_type_ids?.includes(
                  this.contact_point_type_ids.shipping
                )
              );
              const address = a.addresses?.get(
                contact_point?.physical_address_id
              );
              item.recipient = {
                address,
                contact: {
                  email: contact_point.email,
                  name: contact_point.name,
                  phone: contact_point.telephone,
                }
              };
            }

            if (!item.billing_address) {
              const customer = a.customers?.get(
                item.customer_id
              );
              const contact_point = a.contact_points?.getMany(
                [].concat(
                  a.organizations?.get(
                    customer?.commercial?.organization_id
                    ?? customer?.public_sector?.organization_id
                  )?.contact_point_ids,
                  customer?.private?.contact_point_ids
                ).filter(c => c)
              )?.find(
                cp => cp.contact_point_type_ids?.includes(
                  this.contact_point_type_ids.billing
                )
              );
              const address = a.addresses?.get(
                contact_point?.physical_address_id
              );
              item.billing_address = {
                address,
                contact: {
                  email: contact_point.email,
                  name: contact_point.name,
                  phone: contact_point.telephone,
                }
              };
            }

            delete item.sender?.address?.meta;
            delete item.recipient?.address?.meta;
            delete item.billing_address?.address?.meta;
            item.recipient ??= item.billing_address;
            item.billing_address ??= item.recipient;
            item.user_id ??= subject?.id;
          }
        );
        return a;
      }
    );
    return aggregation;
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
        this.tech_user ?? subject,
        context,
      ).then(
        resp_map => {
          this.default_templates.forEach(
            template => Object.assign(
              template,
              resp_map.get(template.id, null)
            )
          )
        }
      );
    }

    return this.default_templates;
  }

  protected async fetchFile(url: string, subject?: Subject): Promise<Buffer> {
    if (url?.startsWith('file://')) {
      return fs.readFileSync(url.slice(7));
    }
    else if (url?.startsWith('http')) {
      return fetch(
        url,
        subject?.token ? {
          headers: {
            Authorization: `Bearer ${subject.token}`
          }
        } : undefined
      ).then(
        resp => resp.arrayBuffer()
      ).then(
        ab => Buffer.from(ab)
      )
    }
    else if (url?.startsWith('//')) {
      const splits = url.match(/[^/]+/g);
      const bucket = splits[0];
      const key = splits.slice(1).join('/');
      const buffer = new Array<Buffer>();
      for await(const chunk of this.ostorage_service.get({
        bucket,
        key,
        download: true,
        subject,
      })) {
        if (chunk.response?.status?.code !== 200) {
          throw chunk.response?.status ?? this.createStatusCode(
            undefined,
            'File',
            this.status_codes.NOT_FOUND,
            url,
          );
        }
        buffer.push(chunk.response.payload.object);
      }
      return Buffer.concat(buffer);
    }
    else {
      throw this.createStatusCode(
        undefined,
        'File',
        this.status_codes.PROTOCOL_NOT_SUPPORTED,
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
      a => template.localizations?.some(
        b => b.locales?.includes(a)
      )
    ) ?? 'en';
    const L = template.localizations?.find(
      a => a.locales?.includes(locale)
    );
    const url = L?.l10n?.url;
    const l10n = url ? await this.fetchFile(url, subject).then(
      text => {
        if (L.l10n.content_type === 'application/json') {
          return JSON.parse(text.toString());
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
    use_cases: (TemplateUseCase | string)[],
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
    const templates = aggregation.templates?.getMany(
      shop.template_ids
    )?.filter(
      template => use_cases?.includes(template.use_case)
    ).sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    ) ?? [];
    default_templates = default_templates?.filter(
      template => use_cases?.includes(template.use_case)
    ).sort(
      (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)
    ) ?? []

    if (templates.length === 0) {
      if (default_templates?.length > 0) {
        templates.push(...default_templates);
      }
      else {
        throw this.createOperationStatusCode(
          this.operation_status_codes.NO_TEMPLATES
        );
      }
    }
    
    const bodies: RenderRequest_Template[][]  = await Promise.all(
      templates.map(
        async template => await Promise.all(template.bodies?.map(
          async (body, i) => ({
            id: template.use_case,
            body: body?.url ? await this.fetchFile(
              body.url, subject
            ) : undefined,
            layout: template.layouts?.[i]?.url ? await this.fetchFile(
              template.layouts?.[i]?.url, subject
            ) : undefined
          })
        ) ?? this.throwStatusCode<RenderRequest_Template[]>(
          item.id,
          "Template",
          this.status_codes.NO_TEMPLATE_BODY,
          template.id,
        ))
      )
    );
    const l10n = await Promise.all(
      templates.map(
        template => this.fetchLocalization(
          template, locales, subject
        )
      )
    );

    const render_request: RenderRequestList = {
      id: render_id,
      items: templates.map(
        (template, i) => ({
          content_type: 'text/html',
          data: packRenderData(aggregation, item),
          templates: bodies[i],
          style_url: template.styles?.find(s => s.url).url,
          options: l10n[i] ? marshallProtobufAny({
            locale: l10n[i]._locale,
            texts: l10n[i]
          }) : undefined
        })
      ),
    }

    return this.renderingTopic.emit(
      'renderRequest',
      render_request,
    );
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
      if (!request.items?.length) {
        return {
          items: [],
          operation_status: this.operation_status_codes.NO_ITEM,
        }
      }

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

      const default_templates = await this.loadDefaultTemplates();
      const response = await Promise.all(aggregation.items.map(
        async (item) => {
          const render_id = `invoice/pdf/${item!.id}`;
          return await this.emitRenderRequest(
            item,
            aggregation,
            render_id,
            [
              TemplateUseCase.INVOICE_PDF,
              'INVOICE_PDF_BODY',
              'INVOICE_PDF_HEADER',
              'INVOICE_PDF_FOOTER'
            ],
            default_templates,
            request.subject,
          ).then(
            async (): Promise<RenderResult> => ({
              payload: {
                id: item.id,
                content: await this.awaits_render_result.await(
                  render_id, this.kafka_timeout
                ).then(
                  c => ({
                    header: c.filter(
                      c => [
                        'INVOICE_PDF_HEADER'
                      ].includes(c.id)
                    ).map(
                      c => c.body
                    ).join(''),
                    body: c.filter(
                      c => [
                        TemplateUseCase.INVOICE_PDF,
                        'INVOICE_PDF_BODY'
                      ].includes(c.id)
                    ).map(
                      c => c.body
                    ).join(''),
                    footer: c.filter(
                      c => [
                        'INVOICE_PDF_FOOTER'
                      ].includes(c.id)
                    ).map(
                      c => c.body
                    ).join('')
                  })
                ),
              },
              status: {
                code: 200,
                message: 'OK',
              }
            }),
          ).then(
            response => {
              if (response.status?.code === 200) {
                const shop = aggregation.shops.get(item.shop_id);
                const setting = this.resolveSettings(
                  aggregation.settings.get(
                    shop.setting_id
                  )
                );
                return this.renderPdf(
                  item,
                  response.payload.content,
                  setting,
                  this.tech_user ?? request.subject,
                  context,
                );
              }
              else {
                const invoice = response_map.get(item.id);
                invoice.status = response.status ?? this.createStatusCode(
                  item.id,
                  'Invoice',
                  this.status_codes.PDF_RENDER_FAILED,
                  item.id
                );
                return invoice;
              }
            },
          ).catch(
            (err: any) => this.catchStatusError<RenderResult>(err, { payload: item })
          );
        }
      )).then(
        async items => {
          const valids = items.filter(
            item => {
              response_map.set(item.payload?.id ?? item.status?.id, item);
              return item?.status?.code === 200
            }
          ).map(
            item => item?.payload
          );
          if (valids.length) {
            this.logger.info('Update:', { valids });
            const updates = await this.superUpsert(
              {
                items: valids,
                total_count: items.length,
                subject: request.subject
              }
            );
            if (updates.operation_status?.code !== 200) {
              throw updates.operation_status;
            }
            updates.items?.forEach(
              item => response_map.set(item.payload?.id ?? item.status?.id, item)
            );
          }
          
          items = [...response_map.values()];
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
      if (!request.items?.length) {
        return {
          status: [],
          operation_status: this.operation_status_codes.NO_ITEM,
        }
      }
      const ids = request.items.map(item => item.id);
      const aggregation = await this.get(
        ids,
        request.subject,
        context,
        true,
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

      const default_templates = await this.loadDefaultTemplates();
      const items: InvoiceResponse[] = await Promise.all(aggregation.items.map(
        async (item, i) => {
          const render_id = `invoice/email/${item!.id}`;
          return await this.emitRenderRequest(
            item,
            aggregation,
            render_id,
            [TemplateUseCase.INVOICE_EMAIL_SUBJECT, TemplateUseCase.INVOICE_EMAIL_BODY],
            default_templates,
            request.subject,
          ).then(
            () => this.awaits_render_result.await(render_id, this.kafka_timeout)
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
              const body = bodies.map(b => b.body).join('');

              return await this.sendNotification(
                item,
                body,
                setting,
                title.body,
                request.items[i].document_ids,
                this.tech_user ?? request.subject,
                context,
              ).then(
                payload => ({ 
                  payload,
                  status: this.createStatusCode(
                    item.id,
                    'Invoice',
                    this.status_codes.OK,
                    item.id,
                  )
                })
              );
            },
          ).catch(
            (err: any) => this.catchStatusError(err, { payload: item })
          )
        }
      ));

      const response = await this.superUpdate({
        items: items.filter(
          item => item.status?.code === 200
        ).map(
          item => item.payload
        ),
        subject: request.subject
      }, context);
      const status = [
        response.items?.map(item => item.status),
        items.filter(
          item => item.status?.code !== 200
        ).map(
          item => item.status
        )
      ].flat().filter(i => i);

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
        meta: {
          modified: new Date()
        }
      })
    );

    return this.update(
      request,
      context,
    );
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
      const document_id = makeID();
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
              url: obj.url,
              caption: filename,
              filename,
              bytes: buffer.byteLength,
              content_type: 'text/html',
            }
          );
          return invoice;
        }
      );
      /*.then(
        invoice => this.superUpsert(
          {
            items: [invoice],
            total_count: 1,
            subject,
          },
          context,
        )
      ).then(
        resp => {
          this.logger?.debug('HTML', {resp});
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          return resp.items.pop().payload
        }
      );*/
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
      const document_id = makeID();
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
              ...setting.shop_pdf_bucket_options,
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
              url: obj.url,
              caption: filename,
              filename,
              bytes: buffer.byteLength,
              content_type: 'application/pdf',
            }
          );
          return invoice;
        }
      );
      /*.then(
        invoice => this.superUpsert(
          {
            items: [invoice],
            total_count: 1,
            subject,
          },
          context,
        )
      ).then(
        resp => {
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          return resp.items.pop().payload
        }
      );*/
    }
    finally {
      stream.destroy();
    }

    return invoice;
  }

  protected async renderPdf(
    invoice: Invoice,
    content: {
      header?: string,
      body?: string,
      footer?: string,
    },
    setting: ResolvedSetting,
    subject?: Subject,
    context?: any,
  ): Promise<InvoiceResponse> {
    const {header, body, footer } = content;
    try {
      if (!setting.shop_html_bucket_disabled) {
        await this.storageHtmlRenderResponse(
          invoice,
          [header, body, footer].filter(Boolean).join(),
          setting,
          subject,
          context,
        );
      }

      const document_id = makeID();
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
          data: [
            {
              source: {
                html: body,
              },
              options: {
                puppeteer_options: {
                  ...setting.shop_puppeteer_options,
                  pdf_options: {
                    margin_top: .5,
                    margin_bottom: .5,
                    margin_left: .5,
                    margin_right: .5,
                    display_header_footer: Boolean(header || footer),
                    header_template: header,
                    footer_template: footer,
                    ...setting.shop_puppeteer_options?.pdf_options,
                  },
                },
                wait_after_load_time: setting.shop_puppeteer_wait ?? 5000,
              },
            },
          ],
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
        },
        subject,
      }).then(
        async (resp) => {
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          else if (resp.combined?.payload?.upload_result) {
            const filename = basename(key);
            invoice.documents ??= [];
            invoice.documents.push({
              id: timestamp,
              url: [
                //setting.shop_bucket_endpoint,
                '/',
                bucket,
                key,
              ].join('/'),
              caption: filename,
              filename,
              bytes: resp.combined.payload.upload_result.length,
              content_type: 'application/pdf',
            } as File);
          }
          else if (resp.combined?.payload?.pdf?.data) {
            const { payload } = resp.combined;
            await this.storagePDFRenderResponse(
              invoice,
              payload.pdf.data,
              setting,
              subject,
              context,
            );
          }
          else if (resp.individual) {
            for (const { payload } of resp.individual.RenderingResponse) {
              await this.storagePDFRenderResponse(
                invoice,
                payload.pdf.data,
                setting,
                subject,
                context,
              );
            }
          }
        }
      );

      return {
        payload: invoice,
        status: this.status_codes.OK,
      };
    }
    catch (err) {
      return this.catchStatusError(err, { payload: invoice });
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
        return await this.fetchFile(
          doc.url,
          subject,
        ).then(
          buffer => ({
            buffer,
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
          to: [invoice.billing_address.contact.email ?? invoice.recipient.contact.email],
          cc: [
            ...(setting.customer_email_cc ?? []),
            ...(setting.shop_email_cc ?? []),
          ],
          bcc: [
            ...(setting.customer_email_bcc ?? []),
            ...(setting.shop_email_bcc ?? []),
          ],
        },
        subject: title ?? invoice.invoice_number ?? 'Invoice',
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
    response: RenderResponseList
  ) {
    try {
      const [entity] = response.id.split('/');
      if (entity !== 'invoice') return;

      if (response.operation_status?.code >= 300) {
        this.awaits_render_result.reject(response.id, response.operation_status);
      }

      const error = response.items.find(
        item => item.status?.code !== 200
      )?.status;
      if (error) {
        this.awaits_render_result.reject(response.id, error);
      }
      else {
        const bodies = response.items.flatMap(
          item => item.payload.bodies.map(
            item => ({
              id: item.id,
              body: item.body.toString(item.charset as BufferEncoding)
            })
          )
        );
        this.awaits_render_result.resolve(response.id, bodies);
      }
    }
    catch (e: any) {
      this.logger?.error('Error on handleRenderResponse:', e);
    }
  }
}