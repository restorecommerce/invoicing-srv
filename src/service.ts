import { basename } from 'path';
import {
  ResourcesAPIBase,
  ServiceBase
} from '@restorecommerce/resource-base-interface';
import {
  Client,
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
  ManualItem,
  Position,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import {
  OperationStatus,
  StatusListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';
import { CallContext } from 'nice-grpc-common';
import { ServiceConfig } from './experimental/WorkerBase.js';
import { Logger } from '@restorecommerce/logger';
import {
  DeleteRequest,
  DeleteResponse,
  ReadRequest
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import {
  ACSClientContext,
  AuthZAction,
  DefaultACSClientContextFactory,
  DefaultResourceFactory,
  Operation,
  access_controlled_function,
  injects_meta_data,
} from '@restorecommerce/acs-client';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import {
  Payload_Strategy,
  RenderRequest,
  RenderResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import {
  PdfRenderingServiceDefinition,
  RenderingResponse as PdfRenderResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/pdf_rendering.js';
import {
  NotificationReqServiceDefinition,
  NotificationReq,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/notification_req.js';
import {
  ObjectServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/ostorage.js';
import {
  Shop,
  ShopResponse,
  ShopServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/shop.js';
import {
  CustomerResponse,
  CustomerServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/customer.js';
import {
  OrganizationResponse,
  OrganizationServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/organization.js';
import {
  UserResponse,
  UserServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/user.js';
import {
  Bundle,
  IndividualProduct,
  PhysicalProduct,
  PhysicalVariant,
  Product,
  ProductResponse,
  ProductServiceDefinition,
  ServiceProduct,
  ServiceVariant,
  VirtualProduct,
  VirtualVariant
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product.js';
import {
  ManufacturerResponse,
  ManufacturerServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/manufacturer.js';
import {
  Tax,
  TaxResponse,
  TaxServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax.js';
import {
  FulfillmentProduct,
  FulfillmentProductResponse,
  FulfillmentProductServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product.js';
import {
  Filter_Operation,
  Filter_ValueType,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/filter.js';
import {
  Aggregation,
  ResourceAggregator,
  ResponseMap,
} from './experimental/ResourceAggregator.js';
import { Readable, Transform } from 'stream';

export type ProductNature = PhysicalProduct | VirtualProduct | ServiceProduct;
export type ProductVariant = PhysicalVariant | VirtualVariant | ServiceVariant;
export type PositionProduct = ProductVariant | Bundle;
export type AggregatedPosition = Position & {
  product: PositionProduct;
}

export type Template = {
  shops?: ResponseMap<ShopResponse>,
  customers?: ResponseMap<CustomerResponse>,
  organization?: ResponseMap<OrganizationResponse>,
  users?: ResponseMap<UserResponse>,
  products?: ResponseMap<ProductResponse>,
  taxes?: ResponseMap<TaxResponse>,
  manufacturers?: ResponseMap<ManufacturerResponse>,
  fulfillments_products?: ResponseMap<FulfillmentProductResponse>
};

export type Setting = {
  access_control_subject?: Subject;
  default_bucket?: string,
  invoice_html_bucket?: string
  invoice_pdf_bucket?: string,
  disable_invoice_html_storage?: string,
  disable_invoice_pdf_storage?: string,
  invoice_html_bucket_options?: any
  invoice_pdf_bucket_options?: any
  puppeteer_options?: any,
  email_provider?: string,
  email_subject_template?: string,
  email_in_cc?: string[],
};

export type KnownUrns = {
  access_control_subject?: string;
  render_options?: string;
  render_strategy?: string;
  render_style?: string;
  render_template?: string;
  pdf_template_id?: string;
  pdf_template_url?: string;
  email_template_id?: string;
  email_template_url?: string;
  email_provider?: string;
  email_in_cc?: string;
  email_subject_template?: string;
  default_bucket?: string;
  invoice_html_bucket?: string;
  invoice_html_bucket_options?: string;
  invoice_pdf_bucket?: string;
  invoice_pdf_bucket_options?: string;
  invoice_pdf_puppeteer_options?: string;
  enable_invoice_html_storage?: string;
  enable_invoice_pdf_storage?: string;
};

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
    const resources = await self.getInvoicesByIds(ids, request.subject, context);
    return {
      ...context,
      subject: request.subject,
      resources: [
        ...resources.items ?? [],
        ...request.items ?? [],
      ],
    };
  }

  protected readonly pdf_rendering_service: Client<PdfRenderingServiceDefinition>;
  protected readonly notification_service: Client<NotificationReqServiceDefinition>;
  protected readonly ostorage_service: Client<ObjectServiceDefinition>;
  protected readonly default_setting: Setting;
  protected readonly urns: KnownUrns;

  get ApiKey(): Subject {
    const apiKey = this.cfg.get('authentication:apiKey');
    return apiKey
      ? {
          id: 'apiKey',
          token: apiKey,
        }
      : undefined;
  }

  constructor(
    protected readonly topic: Topic,
    protected readonly db: DatabaseProvider,
    protected readonly cfg: ServiceConfig,
    readonly logger: Logger,
    protected readonly aggregator = new ResourceAggregator(cfg, logger)
  ) {
    super(
      cfg.get('database:main:entities:0') ?? 'invoice',
      topic,
      logger,
      new ResourcesAPIBase(
        db,
        cfg.get('database:main:collections:0') ?? 'invoices',
        cfg.get('fieldHandlers:invoice'),
      ),
      !!cfg.get('events:enableEvents'),
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

    this.urns = cfg.get('urns');
  }

  protected getInvoicesByIds(
    ids: string[],
    subject?: Subject,
    context?: any
  ): Promise<InvoiceListResponse> {
    ids = [...new Set(ids)];
    if (ids.length > 1000) {
      throw {
        code: 500,
        message: 'Query for fulfillments exceeds limit of 1000!'
      } as OperationStatus
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
    return null;
  }

  protected async aggregate(
    invoice_list: InvoiceList,
    subject?: Subject,
    context?: CallContext,
    evaluate?: boolean,
  ): Promise<Aggregation<InvoiceList, Template>> {
    const aggregation = await this.aggregator.aggregate(
      invoice_list,
      [
        {
          service: ShopServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items.map(i => i.shop_id),
          container: 'shops'
        },
        {
          service: CustomerServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items.map(i => i.customer_id),
          container: 'customers'
        },
        {
          service: ProductServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items.flatMap(
            i => i.sections
          ).flatMap(
            section => section.positions
          ).flatMap(
            position => position.product_item?.product_id
          ),
          container: 'products',
        },
        {
          service: FulfillmentProductServiceDefinition,
          map_by_ids: (invoice_list) => invoice_list.items.flatMap(
            i => i.sections
          ).flatMap(
            section => section.positions
          ).flatMap(
            position => position.fulfillment_item.product_id
          ),
          container: 'fulfillment_products'
        },
      ],
      {} as Template,
      subject,
      context,
    ).then(
      invoice_list => this.aggregator.aggregate(
        invoice_list,
        [
          {
            service: UserServiceDefinition,
            map_by_ids: (invoice_list) => invoice_list.customers!.map(
              customer => customer.payload.private?.user_id
            ).filter(i => i),
            container: 'users',
          },
          {
            service: OrganizationServiceDefinition,
            map_by_ids: (invoice_list) => [
              ...invoice_list.customers!.map(
                customer => customer.payload.public_sector?.organization_id
              ),
              ...invoice_list.customers!.map(
                customer => customer.payload.commercial?.organization_id
              ),
            ].filter(i => i),
            container: 'organizations',
          },
          {
            service: ManufacturerServiceDefinition,
            map_by_ids: (invoice_list) => invoice_list.products?.map(
              product => product.payload!.product?.manufacturer_id
            ).filter(i => i),
            container: 'manufacturers'
          },
          {
            service: TaxServiceDefinition,
            map_by_ids: (invoice_list) => invoice_list.products?.flatMap(
              product => [
                ...product.payload!.product?.tax_ids,
                ...product.payload!.product?.physical?.variants?.flatMap(
                  variant => variant.tax_ids
                ),
                ...product.payload!.product?.virtual?.variants?.flatMap(
                  variant => variant.tax_ids
                ),
                ...product.payload!.product?.service?.variants?.flatMap(
                  variant => variant.tax_ids
                ),
              ]
            ).filter(i => i),
            container: 'taxes'
          }
        ],
        {} as Template,
        subject,
        context,
      )
    );
    return aggregation;
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
    const aggregation = await this.aggregate(
      request,
      request.subject,
      context,
      true,
    );

    request.items = aggregation.items;
    const response = await super.upsert(request, context);

    const extractInvoiceDetails = (
      invoice: Invoice
    ) => {
      const clone = {
        ...invoice
      };
      delete clone.meta;
      delete clone.documents;
      delete clone.sections;
      return clone;
    }

    const mergeProductVariantRecursive = (
      nature: ProductNature,
      variant_id: string,
    ): ProductVariant => {
      const variant = nature?.variants?.find(v => v.id === variant_id);
      if (variant?.parent_variant_id) {
        const template = mergeProductVariantRecursive(
          nature, variant.parent_variant_id
        );
        return {
          ...template,
          ...variant,
        };
      }
      else {
        return variant;
      }
    };

    const mergeProductVariant = (
      product: IndividualProduct,
      variant_id: string,
    ): ProductVariant => {
      const nature = product.physical ?? product.virtual ?? product.service;
      const variant = mergeProductVariantRecursive(nature, variant_id);

      return {
        ...product,
        ...variant,
      };
    };

    const aggregatePosition = (
      position: Position
    ): AggregatedPosition => {
      const product = position.product_item && aggregation.products.get(
        position.product_item.product_id
      );
      const variant = product.payload.product && mergeProductVariant(
        product.payload.product,
        position.product_item.variant_id
      );
      
      return {
        ...position,
        product: variant && product.payload.bundle
      };
    };

    const extractShopConfigs = (
      shop_id: string
    ) => {
      const shop = aggregation.shops.get(shop_id)!.payload;
      const options = Object.assign({}, 
        ...shop.settings.filter(
          s => s.id === this.urns.render_options
        ).map(
          s => JSON.parse(s.value)
        )
      );
      const templates = Buffer.from(
        JSON.stringify(
          Object.assign({},
            ...shop.settings.filter(
              s => s.id === this.urns.pdf_template_url
            ).map(
              (s, i) => ({ [i]: s.value })
            )
          )
        )
      );
      const strategy = shop.settings.find(
        s => s.id === this.urns.render_strategy
      )?.value ?? Payload_Strategy.INLINE;
      const style_url = shop.settings.find(
        s => s.id ===this.urns.render_style
      )?.value;

      return {
        options,
        templates,
        strategy,
        style_url,
      }
    };

    const extractData = (
      invoice: Invoice
    ) => Buffer.from(
      JSON.stringify({
        headers: extractInvoiceDetails(invoice),
        sections: invoice.sections?.map(
          section => ({
            ...section,
            positions: section.positions?.map(
              aggregatePosition
            )
          })
        )
      })
    );

    response.items.forEach(
      item => this.topic.emit(
        'renderRequest',
        {
          id: `invoice/pdf/${item!.payload.id}`,
          payloads: [
            {
              content_type: 'text/html',
              data: extractData(item.payload),
              ...extractShopConfigs(item.payload.shop_id),
            }
          ],
        } as RenderRequest
      )
    );
    return response;
  }

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
    return null;
  }
  
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
    const ids = request.items!.map(item => item.id);
    await this.read(
      {
        filters: [
          {
            filters: [
              {
                field: 'id',
                value: JSON.stringify(ids),
                type: Filter_ValueType.ARRAY,
                operation: Filter_Operation.in,
              }
            ],
          }
        ],
        limit: ids.length,
        subject: request.subject,
      }
    );

    return null;
  }

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

  private extractShopSetting(
    shop: Shop,
  ) {
    const default_bucket = shop.settings.find(
      a => a.id === this.urns.invoice_html_bucket
    )?.value ?? this.default_setting.default_bucket;

    const setting: Setting = {
      default_bucket,
      access_control_subject: JSON.parse(shop.settings.find(
        a => a.id === this.urns.access_control_subject
      )?.value ?? null) ?? this.default_setting.access_control_subject ?? this.ApiKey,
      invoice_html_bucket: shop.settings.find(
        a => a.id === this.urns.invoice_html_bucket
      )?.value ?? this.default_setting.invoice_html_bucket ?? default_bucket,
      invoice_pdf_bucket: shop.settings.find(
        a => a.id === this.urns.invoice_pdf_bucket
      )?.value ?? this.default_setting.invoice_pdf_bucket ?? default_bucket,
      disable_invoice_html_storage: shop.settings.find(
        a => a.id === this.urns.enable_invoice_html_storage
      )?.value ?? this.default_setting.disable_invoice_html_storage,
      disable_invoice_pdf_storage: shop.settings.find(
        a => a.id === this.urns.enable_invoice_html_storage
      )?.value ?? this.default_setting.disable_invoice_pdf_storage,
      invoice_html_bucket_options: JSON.parse(shop.settings.find(
        a => a.id === this.urns.invoice_html_bucket_options
      )?.value ?? null) ?? this.default_setting.invoice_html_bucket_options,
      invoice_pdf_bucket_options: JSON.parse(shop.settings.find(
        a => a.id === this.urns.invoice_html_bucket_options
      )?.value ?? null) ?? this.default_setting.invoice_pdf_bucket_options,
      puppeteer_options: JSON.parse(shop.settings.find(
        a => a.id === this.urns.invoice_pdf_puppeteer_options
      )?.value ?? null) ?? this.default_setting.puppeteer_options,
      email_provider: shop.settings.find(
        a => a.id === this.urns.email_provider
      )?.value ?? this.default_setting.email_provider,
      email_in_cc: shop.settings.filter(
        a => a.id === this.urns.email_in_cc
      )?.flatMap(
        a => a.value?.split(',')
      ) ?? this.default_setting.email_in_cc,
      email_subject_template: shop.settings.find(
        a => a.id === this.urns.email_subject_template
      )?.value ?? this.default_setting.email_subject_template,
    };

    return setting;
  }

  private async storageHtmlRenderResponse(
    invoice: Invoice,
    body: string,
    setting: Setting,
    context?: any,
  ) {
    const buffer = Buffer.from(body);
    const stream = new Readable();
    stream.push(buffer);
    const transformer = new Transform({
      objectMode: true,
      transform: (chunk, _, done) => {
        const data = {
          bucket: setting.disable_invoice_html_storage,
          key: invoice.id + '.html',
          object: chunk,
          meta: invoice.meta,
          options: {
            content_type: 'text/html',
            ...setting.invoice_html_bucket_options,
          },
          subject: setting.access_control_subject,
        };
        done(null, data);
      }
    });
    
    invoice = await this.ostorage_service.put(
      stream.pipe(transformer)
    ).then(
      resp => {
        const obj = resp.response.payload;
        const filename = basename(obj.key);
        invoice.documents.push(
          {
            id: 'invoice_html',
            url: obj.url,
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
          subject: setting.access_control_subject,
        },
        context,
      )
    ).then(
      resp => resp.items.pop().payload
    );
    
    stream.destroy();
    return invoice;
  }

  private async handlePdfRenderResponse(
    invoice: Invoice,
    body: string,
    setting: Setting,
    context?: any,
  ) {
    if (setting.disable_invoice_html_storage !== 'true') {
      await this.storageHtmlRenderResponse(
        invoice,
        body,
        setting,
        context,
      );
    }
    
    await this.pdf_rendering_service.render({
      combined: {
        output: {
          generate_pdfa: true,
          meta_data: {
            creator: '',
            producer: '',
            title: invoice.invoice_number,
          },
          upload_options: {
            bucket: setting.invoice_pdf_bucket,
            key: `${invoice.id}/${invoice.invoice_number}'.pdf'}`,
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
      }
    }).then(
      resp => {
        const filename = basename(resp.combined.payload.upload_result.url);
        invoice.documents.push(
          {
            id: 'invoice_pdf',
            url: resp.combined.payload.upload_result.url,
            caption: filename,
            filename,
            bytes: resp.combined.payload.upload_result.length,
            content_type: 'application/pdf',
          }
        );
      }
    );

    invoice = await super.update(
      {
        items: [invoice],
        total_count: 1,
        subject: setting.access_control_subject,
      },
      context,
    ).then(
      resp => resp.items.pop().payload
    );
    
    return invoice;
  }

  private async handleEmailRenderResponse(
    invoice: Invoice,
    body: string,
    setting: Setting,
    context?: any,
  ) {
    const doc = invoice.documents.filter(
      doc => doc.content_type === 'application/pdf' || doc.filename?.endsWith('.pdf')
    )?.pop();

    const buffer = await fetch(doc.url).then(
      f => f.arrayBuffer()
    ).then(
      ab => Buffer.from(ab)
    );

    this.notification_service.send(
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
        attachments: [
          {
            buffer,
            filename: doc.filename,
            content_type: doc.content_type,
          }
        ],
      },
      context
    );
  }

  public async handleRenderResponse(
    response: RenderResponse,
    context?: CallContext, 
  ) {
    const [type, id] = response.id.split('/');
    if (type !== 'invoice') return;
    const subject: Subject = this.default_setting.access_control_subject ?? this.ApiKey;

    const invoice = await this.read(
      {
        filters: [
          {
            filters: [
              {
                field: 'id',
                value: id,
                operation: Filter_Operation.eq,
              }
            ]
          }
        ],
        limit: 1,
        subject,
      },
      context
    ).then(
      response => response.items.shift().payload
    );

    const setting = await this.aggregator.getByIds<ShopResponse>(
      invoice.shop_id,
      ShopServiceDefinition,
      subject,
      context,
    ).then(
      m => this.extractShopSetting(m.get(invoice.shop_id)!.payload)
    );

    const bodies = response.responses.map(
      r => JSON.parse(r.value.toString())
    );
    
    const invoice_body = bodies.filter(
      b => b.invoice
    ).map(
      b => b.invoice
    ).join();

    const email_body = bodies.filter(
      b => b.email
    ).map(
      b => b.email
    ).join();

    if (invoice_body?.length) {
      await this.handlePdfRenderResponse(
        invoice,
        invoice_body,
        setting,
        context,
      );
    }
    
    if (email_body?.length) {
      await this.handleEmailRenderResponse(
        invoice,
        email_body,
        setting,
        context,
      );
    }
  }
}