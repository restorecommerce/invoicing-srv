import * as fs from 'node:fs';
import { basename } from 'node:path';
import * as uuid from 'uuid';
import { sprintf } from 'sprintf-js';
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
import { type ServiceConfig } from '../experimental/WorkerBase.js';
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
import { Readable, Transform } from 'node:stream';
import { InvoiceNumberService } from './invoice_number_srv.js';
import {
  resolveInvoice,
  DefaultUrns,
  type KnownUrns,
  type AggregationTemplate,
  type AggregatedInvoiceList,
  type Setting
} from '../utils.js';
import { ResourceAwaitQueue } from '../experimental/ResourceAwaitQueue.js';
import { ClientRegister } from '../experimental/ClientRegister.js';
import { marshallProtobufAny } from '../utils.js';
import { File } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/file.js';

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
      id: '',
      code: 200,
      message: 'OK',
    },
    NOT_FOUND: {
      id: '',
      code: 404,
      message: '{entity} {id} not found!',
    },
    NO_LEGAL_ADDRESS: {
      id: '',
      code: 404,
      message: '{entity} {id} has no legal address!',
    },
    NO_LABEL: {
      id: '',
      code: 404,
      message: '{entity} {id} has no label!',
    },
    NOT_SUBMITTED: {
      id: '',
      code: 400,
      message: '{entity} {id} is not submitted!',
    },
    SHOP_ID_NOT_IDENTICAL: {
      id: '',
      code: 400,
      message: '{entity} {id} Fulfillment.shopId must be listed in Courier.shopIds!',
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
    TIMEOUT: {
      code: 500,
      message: 'Request timeout, API not responding!',
    },
  };

  protected readonly tech_user: Subject;
  protected readonly awaits_pdf_bodies = new ResourceAwaitQueue<string>;
  protected readonly awaits_email_bodies = new ResourceAwaitQueue<string>;
  protected readonly pdf_rendering_service: Client<PdfRenderingServiceDefinition>;
  protected readonly notification_service: Client<NotificationReqServiceDefinition>;
  protected readonly ostorage_service: Client<ObjectServiceDefinition>;
  protected readonly user_service: Client<UserServiceDefinition>;
  protected readonly default_setting: Setting;
  protected readonly urns: KnownUrns;
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
    this.default_setting = cfg.get('defaults:Shop:settings');
    this.emitters = {
      ...this.emitters,
      ...cfg.get('events:emitters')
    };

    this.tech_user = cfg.get('authorization:techUser');
  }

  protected catchStatusError(e: any, id?: string): Status {
    const status = {
      id,
      code: e?.code ?? 500,
      message: e?.message ?? e?.details ?? (e ? JSON.stringify(e) : 'Unknown Error!'),
    };
    this.logger?.error(status);
    return status;
  }

  protected catchOperationError(e: any) {
    const error = {
      items: new Array<any>(),
      total_count: 0,
      operation_status: {
        code: e?.code ?? 500,
        message: e?.message ?? e?.details ?? (e ? JSON.stringify(e) : 'Unknown Error!'),
      }
    };
    this.logger?.error(error);
    return error;
  }

  protected resolveShopSetting(
    shop: Shop,
  ) {
    const default_bucket = shop.settings?.find(
      a => a.id === this.urns.invoice_html_bucket
    )?.value ?? this.default_setting.default_bucket;

    const setting: Setting = {
      default_bucket,
      invoice_number_start: Number.parseInt(shop.settings?.find(
        a => a.id === this.urns.invoice_number_start
      )?.value ?? this.default_setting.invoice_number_start?.toString() ?? '1'),
      invoice_number_increment: Number.parseInt(shop.settings?.find(
        a => a.id === this.urns.invoice_number_increment
      )?.value ?? this.default_setting.invoice_number_increment?.toString() ?? '1'),
      invoice_html_bucket: shop.settings?.find(
        a => a.id === this.urns.invoice_html_bucket
      )?.value ?? this.default_setting.invoice_html_bucket ?? default_bucket,
      invoice_pdf_bucket: shop.settings?.find(
        a => a.id === this.urns.invoice_pdf_bucket
      )?.value ?? this.default_setting.invoice_pdf_bucket ?? default_bucket,
      disable_invoice_html_storage: shop.settings?.find(
        a => a.id === this.urns.enable_invoice_html_storage
      )?.value ?? this.default_setting.disable_invoice_html_storage,
      disable_invoice_pdf_storage: shop.settings?.find(
        a => a.id === this.urns.enable_invoice_html_storage
      )?.value ?? this.default_setting.disable_invoice_pdf_storage,
      invoice_html_bucket_options: JSON.parse(shop.settings?.find(
        a => a.id === this.urns.invoice_html_bucket_options
      )?.value ?? null) ?? this.default_setting.invoice_html_bucket_options,
      invoice_pdf_bucket_options: JSON.parse(shop.settings?.find(
        a => a.id === this.urns.invoice_html_bucket_options
      )?.value ?? null) ?? this.default_setting.invoice_pdf_bucket_options,
      puppeteer_options: JSON.parse(shop.settings?.find(
        a => a.id === this.urns.invoice_pdf_puppeteer_options
      )?.value ?? null) ?? this.default_setting.puppeteer_options,
      email_provider: shop.settings?.find(
        a => a.id === this.urns.email_provider
      )?.value ?? this.default_setting.email_provider,
      email_in_cc: shop.settings?.filter(
        a => a.id === this.urns.email_in_cc
      )?.flatMap(
        a => a.value?.split(',')
      ) ?? this.default_setting.email_in_cc,
      email_subject_template: shop.settings?.find(
        a => a.id === this.urns.email_subject_template
      )?.value ?? this.default_setting.email_subject_template,
      bucket_key_delimiter: this.default_setting.bucket_key_delimiter,
      ostorage_domain_prefix: this.default_setting.ostorage_domain_prefix,
    };
    return setting;
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

  protected get(
    ids: string[],
    subject?: Subject,
    context?: any,
  ): Promise<InvoiceListResponse> {
    ids = [...new Set(ids)];
    if (ids.length > 1000) {
      throw {
        code: 500,
        message: 'Query exceeds limit of 1000!'
      } as OperationStatus;
    }

    const request = ReadRequest.fromPartial({
      filters: [{
        filters: [{
          field: 'id',
          operation: Filter_Operation.in,
          value: JSON.stringify(ids),
          type: Filter_ValueType.ARRAY
        }]
      }],
      subject
    });
    return super.read(request, context);
  }

  public async generateInvoiceNumbers(
    aggregation: AggregatedInvoiceList,
    context?: CallContext,
  ) {
    const shops = aggregation.shops;
    const settings = new Map(
      shops.all.map(
        shop => [shop.id, this.resolveShopSetting(shop)]
      )
    );

    await Promise.all(aggregation.items?.map(async (item) => {
      const shop = shops.get(item.shop_id);
      const setting = settings.get(item.shop_id);
      const key = `invoice:counter:${shop.id}`;
      const increment = setting.invoice_number_increment ?? 1;
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
            current = setting.invoice_number_start ?? 0;
            await this.redis.set(key, current);
          }
          return current;
        }
      );

      const pattern = setting.invoice_number_pattern ?? 'invoice-%010i';
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

    const setting = this.resolveShopSetting(shop);
    const key = `invoiceCounter:${shop.id}`;
    const increment = setting.invoice_number_increment ?? 1;

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
          current = setting.invoice_number_start ?? 0;
          await this.redis.set(key, current);
        }
        return current;
      }
    );

    const pattern = setting.invoice_number_pattern ?? 'i-%010i';
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
          }
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
    // const shop = aggregation.shops.get(invoice.shop_id);
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
      const template = fs.readFileSync('templates/hello_world.hbs').toString();
      const response = await Promise.all(aggregation.items.map(
        item => this.renderingTopic.emit(
          'renderRequest',
          {
            id: `invoice/pdf/${item!.id}`,
            payloads: [
              {
                content_type: 'text/html',
                data: this.packRenderData(
                  aggregation,
                  item,
                ),
                templates: marshallProtobufAny({
                  r_body: { body: template },
                })
              }
            ],
          } as RenderRequest
        ).then(
          async (): Promise<RenderResult> => ({
            id: item.id,
            body: await this.awaits_pdf_bodies.await(item!.id, 5000),
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
              const invoice = response_map.get(response.id).payload;
              const shop = aggregation.shops.get(invoice.shop_id);
              const setting = this.resolveShopSetting(shop);
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
      )).then(
        items => items.filter(
          item => item.status?.code === 200
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

      const template = fs.readFileSync('templates/hello_world.hbs').toString();
      const email_bodies = await Promise.all(aggregation.items.map(
        item => this.renderingTopic.emit(
          'renderRequest',
          {
            id: `invoice/email/${item!.id}`,
            payloads: [
              {
                content_type: 'text/email',
                data: this.packRenderData(
                  aggregation,
                  item,
                ),
                templates: marshallProtobufAny({
                  r_body: { body: template },
                })
              }
            ],
          } as RenderRequest
        ).then(
          () => this.awaits_email_bodies.await(item!.id, 1000)
        )
      ));

      const items = await Promise.all(email_bodies.map(
        async (body, i) => {
          const invoice = aggregation.items[i];
          const shop = aggregation.shops.get(
            invoice.shop_id
          );
          const setting = this.resolveShopSetting(shop);

          return this.sendNotification(
            invoice,
            body,
            setting,
            invoice.documents.filter(
              d => d.content_type === 'application/pdf'
            ).map(
              d => d.id
            ),
            this.tech_user ?? request.subject,
            context,
          );
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
    setting: Setting,
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
            bucket: setting.invoice_html_bucket,
            key: [
              invoice.shop_id,
              invoice.id,
              document_id,
              `${invoice.invoice_number}.html`
            ].join(setting.bucket_key_delimiter),
            object: chunk,
            meta: invoice.meta,
            options: {
              content_type: 'text/html',
              ...setting.invoice_html_bucket_options,
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
                setting.ostorage_domain_prefix,
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
    setting: Setting,
    subject: Subject,
    context?: any,
  ) {
    const stream = Readable.from(buffer);
    const document_id = uuid.v4();
    try {
      const key = [
        invoice.shop_id,
        invoice.id,
        document_id,
        `${invoice.invoice_number}.pdf`
      ].join(setting.bucket_key_delimiter);
      const transformer = new Transform({
        objectMode: true,
        transform: (chunk, _, done) => {
          const data = {
            bucket: setting.invoice_html_bucket,
            key,
            object: chunk,
            meta: invoice.meta,
            options: {
              content_type: 'text/html',
              ...setting.invoice_html_bucket_options,
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
                setting.ostorage_domain_prefix,
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
    setting: Setting,
    subject?: Subject,
    context?: any,
  ): Promise<InvoiceResponse> {
    try {
      if (setting.disable_invoice_html_storage !== 'true') {
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
      const bucket = setting.invoice_pdf_bucket;
      const key = [
        invoice.shop_id,
        invoice.id,
        document_id,
        `${invoice.invoice_number}.pdf`
      ].join(setting.bucket_key_delimiter);
      await this.pdf_rendering_service.render({
        combined: {
          output: {
            meta_data: {
              creator: invoice.user_id,
              producer: invoice.shop_id,
              title: invoice.invoice_number,
            },
            upload_options: {
              bucket: setting.invoice_pdf_bucket,
              key,
              content_disposition: 'application/pdf',
            }
          },
          data: [
            {
              source: {
                html: body
              },
              options: {
                puppeteer_options: setting.puppeteer_options,
              }
            }
          ]
        },
        subject,
      }).then(
        resp => {
          if (resp.operation_status?.code !== 200) {
            throw resp.operation_status;
          }
          else if (resp.combined.payload?.upload_result) {
            const filename = basename(key);
            invoice.documents ??= [];
            invoice.documents.push({
              id: timestamp,
              url: [
                setting.ostorage_domain_prefix,
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
            this.storagePDFRenderResponse(
              invoice,
              resp.combined.payload.pdf?.data,
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
    setting: Setting,
    document_ids?: string[],
    subject?: Subject,
    context?: any,
  ) {
    const attachments = await Promise.all(
      invoice.documents.filter(
        doc => document_ids?.includes(doc.id)
      ).map(
        doc => fetch(
          doc.url,
          {
            headers: {
              Authorization: `Bearer ${subject.token}`
            }
          }
        ).then(
          f => {
            if (!f.ok || f.status !== 200) {
              throw {
                id: invoice.id,
                code: f.status,
                message: f.statusText,
              } as Status;
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
      )
    );

    const status = await this.notification_service.send(
      {
        transport: 'email',
        provider: setting.email_provider,
        email: {
          to: [invoice.recipient.contact.email],
          cc: setting.email_in_cc,
        },
        subject: setting.email_subject_template?.replace(
          '[InvoiceNumber]',
          invoice.invoice_number
        ) ?? invoice.invoice_number,
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
    const [entity, type, id] = response.id.split('/');
    if (entity !== 'invoice') return;
    const content = response.responses.map(
      r => JSON.parse(r.value.toString())
    );
    const errors = content.filter(
      c => !!c.error
    ).map(
      c => c.error
    );

    if (errors?.length) {
      const status: Status = {
        code: 500,
        message: errors.join(),
      };

      if (type === 'pdf') {
        this.awaits_pdf_bodies.reject(id, status);
      }
      else if (type === 'email') {
        this.awaits_email_bodies.reject(id, status);
      }
    }
    else {
      const bodies = content.flatMap(
        c => Object.entries(c)
      ).filter(
        ([k, v]) => k.startsWith('r_')
      ).map(
        ([k, v]) => v
      ).join('');

      if (type === 'pdf') {
        this.awaits_pdf_bodies.resolve(id, bodies);
      }
      else if (type === 'email') {
        this.awaits_email_bodies.resolve(id, bodies);
      }
    }
  }
}