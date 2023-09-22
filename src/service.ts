import * as _ from 'lodash';
import { RedisClientType } from 'redis';
import {
  Readable,
  Transform
} from 'stream';
import {
  ResourcesAPIBase,
  ServiceBase
} from '@restorecommerce/resource-base-interface';
import { Topic } from '@restorecommerce/kafka-client';
import { Client, GrpcClientConfig, createChannel, createClient } from '@restorecommerce/grpc-client';
import {
  InvoiceServiceImplementation,
  InvoiceListResponse,
  InvoiceList,
  InvoiceResponse,
  InvoiceNumberResponse,
  DeepPartial,
  InvoiceIdList,
  Position,
  Section
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice';
import { ReadRequest, DeleteRequest, Filter_Operation, Filter_ValueType, FilterOp_Operator } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth';
import { Bundle, BundleProduct, PhysicalProduct, PhysicalVariant, Product, ProductResponse, ProductServiceDefinition, ServiceProduct, VirtualProduct, VirtualVariant } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product';
import { Tax, TaxResponse, TaxServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax';
import { CustomerResponse, CustomerServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/customer';
import { ShopResponse, ShopServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/shop';
import { OrganizationResponse, OrganizationServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/organization';
import { ContactPointResponse, ContactPointServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/contact_point';
import { AddressResponse, AddressServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/address';
import { CountryResponse, CountryServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/country';
import { FulfillmentProduct, FulfillmentProductResponse, FulfillmentProductServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product';
import { FulfillmentCourierServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_courier';
import { UserResponse, UserServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/user';
import { OperationStatus, Status, StatusListResponse } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status';
import { CurrencyResponse } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/currency';
import { VAT } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/amount';

export type RatioedTax = Tax & {
  tax_ratio?: number;
};

export type UserMap = { [key: string]: UserResponse };
export type ProductMap = { [key: string]: ProductResponse };
export type CustomerMap = { [key: string]: CustomerResponse };
export type ShopMap = { [key: string]: ShopResponse };
export type FulfillmentProductMap = { [key: string]: FulfillmentProductResponse[] };
export type OrganizationMap = { [key: string]: OrganizationResponse };
export type ContactPointMap = { [key: string]: ContactPointResponse };
export type AddressMap = { [key: string]: AddressResponse };
export type CountryMap = { [key: string]: CountryResponse };
export type PositionMap = { [key: string]: Position };
export type StatusMap = { [key: string]: Status };
export type ProductNature = PhysicalProduct & VirtualProduct & ServiceProduct;
export type ProductVariant = PhysicalVariant & VirtualVariant & ServiceProduct;
export type VATMap = { [key: string]: VAT };
export type OperationStatusMap = { [key: string]: OperationStatus };
export type RatioedTaxMap = { [key: string]: RatioedTax };

export interface AggregatedPosition extends Position {
  bundle?: Bundle,
  products?: ProductVariant[],
  fulfillment_product?: FulfillmentProductResponse,
  tax?: TaxResponse,
  currency?: CurrencyResponse,
}

export interface AggregatedSection extends Section {
  aggregated_positions: AggregatedPosition[],
  currencies: CurrencyResponse[],
}

export interface AggregatedInvoiceResponse extends InvoiceResponse {
  user?: UserResponse,
  customer?: CustomerResponse,
  shop?: ShopResponse,
  organization?: OrganizationResponse,
  sections?: AggregatedSection[],
}


export type CRUDClient = Client<ProductServiceDefinition>
| Client<TaxServiceDefinition>
| Client<CustomerServiceDefinition>
| Client<ShopServiceDefinition>
| Client<OrganizationServiceDefinition>
| Client<ContactPointServiceDefinition>
| Client<AddressServiceDefinition>
| Client<CountryServiceDefinition>
| Client<FulfillmentProductServiceDefinition>
| Client<FulfillmentCourierServiceDefinition>
| Client<UserServiceDefinition>;

export class InvoiceService extends ServiceBase<InvoiceListResponse, InvoiceList> implements InvoiceServiceImplementation {
  private readonly status_codes: { [key: string]: Status } = {
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
    NOT_SUBMITTED: {
      id: '',
      code: 400,
      message: '{entity} {id} expected to be submitted!',
    },
    NO_PHYSICAL_ITEM: {
      id: '',
      code: 208,
      message: '{entity} {id} includes no physical item!',
    },
    IN_HOMOGEN_INVOICE: {
      id: '',
      code: 400,
      message: '{entity} {id} must have identical customer_id and shop_id to master {entity}!',
    },
  };

  private readonly operation_status_codes: { [key: string]: OperationStatus } = {
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
  };

  protected readonly customer_service: Client<CustomerServiceDefinition>;
  protected readonly shop_service: Client<ShopServiceDefinition>;
  protected readonly organization_service: Client<OrganizationServiceDefinition>;
  protected readonly user_service: Client<UserServiceDefinition>;
  protected readonly product_service: Client<ProductServiceDefinition>;

  invoiceCount: number;
  redisClient: RedisClientType<any, any>;

  constructor(
    protected readonly cfg: any,
    protected readonly db: any,
    logger: any,
    redisClient: RedisClientType<any, any>,
    protected readonly topics: Topic,
    protected readonly ostorageService: any,
  ) {
    super(
      cfg.get('database:main:entities:0') ?? 'invoice',
      topics,
      logger,
      new ResourcesAPIBase(
        db,
        cfg.get('database:main:collections:0') ?? 'invoices',
        null,
        null,
        null,
        logger,
      ),
      true
    );

    this.customer_service = createClient(
      {
        ...cfg.get('client:customer'),
        logger
      } as GrpcClientConfig,
      CustomerServiceDefinition,
      createChannel(cfg.get('client:customer:address'))
    );

    this.shop_service = createClient(
      {
        ...cfg.get('client:shop'),
        logger
      } as GrpcClientConfig,
      ShopServiceDefinition,
      createChannel(cfg.get('client:shop:address'))
    );

    this.user_service = createClient(
      {
        ...cfg.get('client:user'),
        logger
      } as GrpcClientConfig,
      UserServiceDefinition,
      createChannel(cfg.get('client:user:address'))
    );

    this.product_service = createClient(
      {
        ...cfg.get('client:product'),
        logger
      } as GrpcClientConfig,
      ProductServiceDefinition,
      createChannel(cfg.get('client:product:address'))
    );
    
    let startingValue: string;
    redisClient.get('invoices:invoice_number').then((reply: string) => {
      if (!reply) {
        const invoiceFieldsCfg = cfg.get('invoiceFieldsGenerators:invoice');
        startingValue = invoiceFieldsCfg.invoice_number.startingValue ?? '0';

        redisClient.set('invoices:invoice_number', startingValue).catch(err => {
          logger.error('Error storing invoice number to redis');
        });
      } else {
        startingValue = reply;
      }
    }
    ).catch(err => {
      logger.error('Error getting invoice number from redis', err);
    });
    this.redisClient = redisClient;
  }

  private createStatusCode(
    id: string,
    entity: string,
    status: Status,
    entity_id?: string,
    error?: string,
  ): Status {
    return {
      id,
      code: status?.code ?? 500,
      message: status?.message?.replace(
        '{error}', error
      ).replace(
        '{entity}', entity
      ).replace(
        '{id}', entity_id ?? id
      ) ?? 'Unknown status',
    };
  }

  private createOperationStatusCode(
    entity: string,
    status: OperationStatus,
  ): OperationStatus {
    return {
      code: status?.code ?? 500,
      message: status?.message?.replace(
        '{entity}', entity
      ) ?? 'Unknown status',
    };
  }

  private catchOperationError(e: any) {
    const error = {
      items: [],
      total_count: 0,
      operation_status: {
        code: e?.code ?? 500,
        message: e?.message ?? e?.details ?? e?.toString(),
      }
    };
    this.logger.error(error);
    return error;
  }

  private get<T>(
    ids: string[],
    service: CRUDClient,
    subject?: Subject,
    context?: any,
  ): Promise<T> {
    ids = [...new Set<string>(ids).values()].filter(id => !!id);
    const entity = typeof ({} as T);

    if (ids.length > 1000) {
      throw this.createOperationStatusCode(
        entity,
        this.operation_status_codes.LIMIT_EXHAUSTED,
      );
    }

    return service.read(
      {
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
      },
      context,
    ).then(
      response => {
        if (response.operation_status?.code === 200) {
          return response.items?.reduce(
            (a, b) => {
              a[b.payload?.id] = b;
              return a;
            }, {} as T
          );
        }
        else {
          throw response.operation_status;
        }
      }
    );
  }

  async getById<T>(
    request_id: string,
    map: { [id: string]: T },
    id: string
  ): Promise<T> {
    if (id in map) {
      return map[id];
    }
    else {
      throw this.createStatusCode(
        request_id,
        typeof({} as T),
        this.status_codes.NOT_FOUND,
        id,
      );
    }
  }

  async getByIds<T>(
    request_id: string,
    map: { [id: string]: T },
    ids: string[]
  ): Promise<T[]> {
    return Promise.all(ids.map(
      id => this.getById(
        request_id,
        map,
        id
      )
    ));
  }

  async generateInvoiceNumber(call: any, ctx?: any): Promise<InvoiceNumberResponse> {
    const invoice_number = await this.redisClient.get('invoices:invoice_number');
    await this.redisClient.incr('invoices:invoice_number');
    return { invoice_number };
  }

  /**
   * Temporarily hold the invoice in redis to later be persisted in the database.
   * @param invoice
   * @param requestID
   */
  async holdInvoice(invoice: any, requestID: string): Promise<any> {
    // TODO: HASH SET!!!
    await this.redisClient.set(`tmp_invoices:${requestID}`,
      JSON.stringify(invoice), { EX: 60 * 60 * 24 });
  }

  async saveInvoice(requestID: string, document: Buffer,
    fileName: string): Promise<any> {

    const invoice = JSON.parse(
      await this.redisClient.get(`tmp_invoices:${requestID}`));
    const org_userID = requestID.split('###')[2];

    // invoice marshalled as base64
    invoice.document = Buffer.from(document).toString('base64');
    invoice.meta = {
      modified_by: '',
      created: Date.now(),
      modified: Date.now(),
      owner: [
        {
          id: this.cfg.get('urns:ownerEntity'),
          value: this.cfg.get('urns:organization')
        },
        {
          id: this.cfg.get('urns:ownerInstance'),
          value: org_userID
        }
      ]
    };

    const stream = new Readable();
    // convert buffer document to readable stream
    stream.push(document);
    stream.push(null);
    const options = {
      content_type: 'application/pdf'
    };
    // using tech user as subject for fileupload to OSS
    let tokenTechUser: any = {};
    const techUsersCfg = this.cfg.get('techUsers');
    if (techUsersCfg && techUsersCfg.length > 0) {
      tokenTechUser = _.find(techUsersCfg, { id: 'upload_objects_user_id' });
    }
    const transformBuffObj = () => {
      return new Transform({
        objectMode: true,
        transform: (chunk, _, done) => {
          // object buffer
          const dataChunk = {
            bucket: 'invoices',
            key: fileName,
            object: chunk,
            meta: invoice.meta,
            options,
            subject: tokenTechUser
          };
          done(null, dataChunk);
        }
      });
    };
    let putResponse;
    try {
      // content-type is `application/pdf` for invoices
      putResponse = await this.ostorageService.put(stream.pipe(transformBuffObj()));
    } catch (err) {
      this.logger.info('Error storing the invoice to ostorage-srv:',
        { error: err.message });
    }
    this.logger.info('Response after storing the invoice from ostorage-srv', putResponse);

    await super.create(InvoiceList.fromPartial({
      items: [invoice]
    }), {});

    // deleted in-memory invoice if it exists
    await this.redisClient.del(`tmp_invoices:${invoice.invoice_number}`);
  }

  async downloadFile(bucket, key, subject): Promise<any> {
    const call = await this.ostorageService.get({ key, bucket, subject });
    let buffer = [];
    call.on('data', (data) => {
      if (data?.response?.payload) {
        buffer.push(data.response.payload.object);
      }
    });
    return new Promise((resolve, reject) => {
      call.on('end', () => {
        resolve(Buffer.concat(buffer));
      });
    });
  }

  private async mapBundles(products: ProductMap) {
    const product_ids = [...new Set(Object.values(products).filter(
      (product) => !!product.payload?.bundle
    ).flatMap(
      (product) => product.payload.bundle.products.map(
        (item) => item.product_id
      )
    ).filter(
      id => !products[id]
    )).values()];

    if (product_ids.length) {
      await this.product_service.read({
        filters: [{
          filters: [{
            field: 'id',
            operation: Filter_Operation.in,
            value: JSON.stringify(product_ids),
            type: Filter_ValueType.ARRAY,
          }]
        }],
        limit: product_ids.length,
      }).then(
        response => {
          if (response.operation_status?.code === 200) {
            response.items.forEach(
              item => products[item.payload?.id] = item
            );
          }
          else {
            throw response.operation_status;
          }
        }
      );

      await this.mapBundles(products);
    }
  }

  private async getProductMap(
    ids: string[],
    subject?: Subject,
    context?: any,
  ): Promise<ProductMap> {
    const product_ids = [...new Set<string>(ids).values()];
    if (product_ids.length > 1000) {
      throw this.createOperationStatusCode(
        'product',
        this.operation_status_codes.LIMIT_EXHAUSTED,
      );
    }

    const product_id_json = JSON.stringify(product_ids);
    const products = await this.product_service.read(
      {
        filters: [{
          filters: [
            {
              field: 'product.id',
              operation: Filter_Operation.in,
              value: product_id_json,
              type: Filter_ValueType.ARRAY,
            }, {
              field: 'bundle.id',
              operation: Filter_Operation.in,
              value: product_id_json,
              type: Filter_ValueType.ARRAY,
            }
          ],
          operator: FilterOp_Operator.or
        }],
        limit: product_ids.length,
        subject,
      },
      context
    ).then(
      (response) => {
        if (response.operation_status?.code === 200) {
          return response.items.reduce(
            (a, b) => {
              a[b.payload?.id] = b;
              return a;
            }, {} as ProductMap
          );
        }
        else {
          throw response.operation_status;
        }
      }
    );

    await this.mapBundles(products);
    return products;
  }

  private getRatioedTaxMap(
    products: ProductMap,
    subject?: Subject,
    context?: any
  ): Promise<RatioedTaxMap> {
    const getTaxIdsRecursive = (
      product: ProductResponse
    ): string[] => {
      return product.payload?.product.tax_ids ??
        product.payload?.bundle?.products.flatMap(
          (p) => getTaxIdsRecursive(products[p.product_id])
        );
    };

    const tax_ids = JSON.stringify([
      ...new Set<string>(
        Object.values(
          products
        ).flatMap(
          (product) => getTaxIdsRecursive(product)
        ).filter(
          (id) => !!id
        )
      ).values()
    ]);

    return this.tax_service.read(
      {
        filters: [{
          filters: [
            {
              field: 'id',
              operation: Filter_Operation.in,
              value: tax_ids,
              type: Filter_ValueType.ARRAY,
            }
          ]
        }],
        subject,
      },
      context
    ).then(
      response => {
        if (response.operation_status?.code === 200) {
          return response.items?.reduce(
            (a, b) => {
              a[b.payload?.id] = b.payload;
              return a;
            },
            {} as RatioedTaxMap
          );
        }
        else {
          throw response.operation_status;
        }
      }
    );
  }

  private async aggregateInvoces(
    invoice_list: InvoiceList,
    subject?: Subject,
    context?: any
  ): Promise<AggregatedInvoiceResponse[]> {
    const product_map = await this.getProductMap(
      invoice_list.items.flatMap(
        item => item.sections.flatMap(
          section => section.positions.flatMap(
            position => position.product_item?.product_id
          )
        )
      ),
      subject,
      context
    );
    const tax_map = await this.getRatioedTaxMap(
      product_map,
      subject,
      context
    );
    const customer_map = await this.get<CustomerMap>(
      invoice_list.items.map(item => item.customer_id),
      this.customer_service,
      subject,
      context,
    );
    const shop_map = await this.get<ShopMap>(
      invoice_list.items.map(item => item.shop_id),
      this.shop_service,
      subject,
      context,
    );
    const organization_map = await this.get<OrganizationMap>(
      [
        ...Object.values(shop_map).map(shop => shop.payload.organization_id),
        ...Object.values(customer_map).map(
          customer => customer.payload.commercial?.organization_id ?? customer.payload.public_sector?.organization_id
        ),
      ],
      this.organization_service,
      subject,
      context,
    );
    const user_map = await this.get<UserMap>(
      invoice_list.items.map(item => item.user_id),
      this.user_service,
      subject,
      context,
    );

    const getTaxesRecursive = (
      main: Product,
      price_ratio = 1.0
    ): RatioedTax[] => {
      return [].concat(
        main?.product?.tax_ids.map(id => ({
          ...tax_map[id],
          tax_ratio: price_ratio
        })),
        main?.bundle?.products.flatMap(
          p => getTaxesRecursive(product_map[p.product_id]?.payload, p.price_ratio * price_ratio)
        )
      );
    };

    const mergeProductVariantRecursive = (
      nature: ProductNature,
      variant_id: string,
    ): ProductVariant => {
      const variant = nature.variants.find(v => v.id === variant_id);
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

    ///......


    const aggregatedInvoices = await Promise.all(invoice_list.items.map(
      async item => {
        const shop = await this.getById(item.id, shop_map, item.shop_id)
        return {
          payload: item,
          user: await this.getById(item.id, user_map, item.user_id),
          shop,
          shop_organization: shop.payload.organization_id
          //...

          sections: item.sections.map(
            section => ({
              aggregated_positions: section.positions.map(
                position => {
                  const product = product_map[position.product_item.product_id].payload;
                  const nature = (
                    product?.product?.physical ??
                    product?.product?.virtual ??
                    product?.product?.service
                  ) as ProductNature;
                  //...

                  return {
                    ...position,
                    bundle: product.bundle,
                    product,
                    variants: mergeProductVariantRecursive(nature, position.product_item.variant_id),
                    taxes: [],
                  };
                }
              )
            })
          )
        };
      }
    ));


    return await Promise.all(aggregatedInvoices);




    
    const product_item_map = await this.getProductItemMap(
      position_map,
      subject,
      context
    );
    const contact_point_map = await this.get<ContactPointMap>(
      Object.values(
        organization_map
      ).flatMap(
        item => item.payload?.contact_point_ids
      ),
      this.contact_point_service,
      subject,
      context,
    );
    const address_map = await this.get<AddressMap>(
      Object.values(
        contact_point_map
      ).map(
        item => item.payload?.physical_address_id
      ),
      this.address_service,
      subject,
      context,
    );
    const country_map = await this.get<CountryMap>(
      [
        ...Object.values(
          tax_map
        ).map(
          t => t.country_id
        ),
        ...Object.values(
          address_map
        ).map(
          item => item.payload?.country_id
        )
      ],
      this.country_service,
      subject,
      context,
    );

    

    const promises = invoice_list.items.map(async (order) => {
      try {
        const country = await this.getById(
          order.id,
          shop_map,
          order.shop_id
        ).then(
          shop => this.getById(
            order.id,
            organization_map,
            shop.payload.organization_id,
          )
        ).then(
          orga => this.getByIds(
            order.id,
            contact_point_map,
            orga.payload.contact_point_ids,
          )
        ).then(
          cps => cps.find(
            cp => cp.payload.contact_point_type_ids.indexOf(
              this.legal_address_type_id
            ) >= 0
          )
        ).then(
          cp => {
            if (!cp) {
              throw this.createStatusCode(
                order.id,
                'Shop',
                this.status_codes.NO_LEGAL_ADDRESS,
                order.shop_id,
              );
            }
            else {
              return this.getById(
                order.id,
                address_map,
                cp.payload.physical_address_id,
              );
            }
          }
        ).then(
          address => this.getById(
            order.id,
            country_map,
            address.payload.country_id
          )
        ).then(
          country => country.payload
        );

        order.items.forEach(
          (item) => {
            const product = product_map[item.product_id]?.payload;
            const nature = (product.product?.physical ?? product.product?.virtual) as ProductNature;
            const variant = mergeProductVariantRecursive(nature, item.variant_id);
            const taxes = getTaxesRecursive(product).filter(t => !!t);
            const unit_price = product.bundle ? product.bundle?.price : variant?.price;
            const gross = (unit_price.sale ? unit_price.sale_price : unit_price.regular_price) * item.quantity;
            const vats = taxes.filter(
              t => (
                t.country_id === country.id &&
                !!customer_map[order.customer_id]?.payload.private?.user_id &&
                country.country_code in COUNTRY_CODES_EU &&
                country_map[order.shipping_address.address.country_id]?.payload.country_code in COUNTRY_CODES_EU
              )
            ).map(
              t => ({
                tax_id: t.id,
                vat: gross * t.rate * t.tax_ratio
              }) as VAT
            );
            const net = vats.reduce((a, b) => b.vat + a, gross);
            item.unit_price = unit_price;
            item.amount = {
              gross,
              net,
              vats,
            };
          }
        );

        order.total_amounts = Object.values(order.items.reduce(
          (amounts, item) => {
            const amount = amounts[item.amount.currency_id];
            if (amount) {
              amount.gross += item.amount.gross;
              amount.net += item.amount.net;
              amount.vats.push(...item.amount.vats);
            }
            else {
              amounts[item.amount.currency_id] = { ...item.amount };
            }
            return amounts;
          },
          {} as { [key: string]: Amount }
        ));

        order.total_amounts.forEach(
          amount => {
            amount.vats = Object.values(
              amount.vats.reduce(
                (vats, vat) => {
                  if (vat.tax_id in vats) {
                    vats[vat.tax_id].vat = (vats[vat.tax_id]?.vat ?? 0) + vat.vat;
                  }
                  else {
                    vats[vat.tax_id] = { ...vat };
                  }
                  return vats;
                },
                {} as { [key: string]: VAT }
              )
            );
          }
        );

        return {
          payload: order,
          status: this.createStatusCode(
            order?.id,
            typeof(order),
            this.status_codes.OK,
          ),
        } as InvoiceResponse;
      }
      catch (e) {
        if (order) {
          order.order_state = OrderState.INVALID;
        };
        return {
          payload: order,
          status: {
            id: order?.id,
            code: e?.code ?? 500,
            message: e?.message ?? e?.details ?? e?.toString() ?? e
          }
        } as InvoiceResponse;
      }
    }) as InvoiceResponse[];

    const items = await Promise.all(promises);
    const status = items.reduce(
      (a, b) => a.status?.code > b.status?.code ? a : b
    )?.status;

    return {
      items,
      total_count: items.length,
      operation_status: {
        code: status.code,
        message: status.message,
      },
    } as InvoiceListResponse;
  }

  async read(call: any, context: any): Promise<any> {
    const results = await super.read(call, context);

    for (let itemObj of results.items) {
      if (itemObj?.payload?.document) {
        itemObj.payload.document =
          Buffer.from(itemObj.payload.document, 'base64').toString();
      }
    }

    return results;
  }

  async render(request: InvoiceList, context: any): Promise<DeepPartial<InvoiceListResponse>> { return null};
  async withdraw(request: InvoiceIdList, context: any): Promise<DeepPartial<InvoiceListResponse>> { return null};
  async send(request: InvoiceIdList, context: any): Promise<DeepPartial<StatusListResponse>> { return null};

  /*
  async deleteInvoicesByOrganization(orgIDs: string[],
    userIDs: string[]): Promise<void> {
    const ownerOrgURN = this.cfg.get('ownerAttributeKeys:ownerOrgURN');
    const ownerUserURN = this.cfg.get('ownerAttributeKeys:ownerUserURN');

    for (let org of orgIDs) {
      const result = await super.read(ReadRequest.fromPartial({
        custom_queries: ['filterByOwnership'],
        custom_arguments: {
          value: Buffer.from(JSON.stringify({
            entity: ownerOrgURN,
            instance: [org]
          }))
        }
      }), {});
      if (result?.operation_status?.code != 200) {
        this.logger.error('Error while filtering invoices by ownership',
          result);
        return;
      }
      let items = [];
      result.items.map((itemObj) => items.push(itemObj.payload));
      await this.deleteItemsByOwner(items, orgIDs, userIDs);
    }

    for (let user of userIDs) {
      const result = await super.read(ReadRequest.fromPartial({
        custom_queries: ['filterByOwnership'],
        custom_arguments: {
          value: Buffer.from(JSON.stringify({
            entity: ownerUserURN,
            instance: [user]
          }))
        }
      }), {});
      if (result?.operation_status?.code != 200) {
        this.logger.error('Error while filtering invoices by ownership',
          result);
        return;
      }
      let items = [];
      result.items.map((itemObj) => items.push(itemObj.payload));
      await this.deleteItemsByOwner(items, orgIDs, userIDs);
    }
  }

  async deleteItemsByOwner(items: Array<any>, orgIDs: string[],
    userIDs: string[]): Promise<void> {
    const ownerInstanceURN = this.cfg.get('urns:ownerInstance');
    const ownerIndicatoryEntityURN = this.cfg.get('urns:ownerEntity');
    const ownerOrgURN = this.cfg.get('urns:organization');
    const ownerUserURN = this.cfg.get('urns:user');

    let toDelete = [];
    for (let invoice of items) {
      if (invoice && invoice.meta && invoice.meta.owner &&
        invoice.meta.owner.length > 0) {
        const ownerList = _.cloneDeep(invoice.meta.owner);
        for (let i = ownerList.length - 1; i >= 0; i -= 1) {
          const owner = ownerList[i];
          if (owner.id === ownerInstanceURN &&
            (orgIDs.indexOf(owner.value) > -1 || userIDs.indexOf(owner.value) >
              -1)) {
            const ownerPrevAttribute = ownerList[i - 1];
            if ((ownerPrevAttribute.id === ownerIndicatoryEntityURN) &&
              (ownerPrevAttribute.value === ownerOrgURN ||
                ownerPrevAttribute.value === ownerUserURN)) {
              ownerList.splice(i - 1, 2);
              i--;
            }
          }
        }
        if (_.isEmpty(ownerList)) {
          toDelete.push(invoice.id);
        }
      }
    }
    await super.delete(DeleteRequest.fromPartial({ ids: toDelete }), {});
  }
  */
}
