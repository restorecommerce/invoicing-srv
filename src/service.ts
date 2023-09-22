import {
  ResourcesAPIBase, ServiceBase
} from '@restorecommerce/resource-base-interface';
import { Events, Topic } from '@restorecommerce/kafka-client';
import * as _ from 'lodash';
import { RedisClientType } from 'redis';
import { Readable, Transform } from 'stream';
import { InvoiceNumberResponse } from './interfaces';
import {
  InvoiceServiceImplementation,
  InvoiceListResponse, InvoiceList,
  InvoiceResponse,
  DeepPartial
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice';
import { ReadRequest, DeleteRequest } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth';

export class InvoiceService extends ServiceBase<InvoiceListResponse, InvoiceList> implements InvoiceServiceImplementation {
  invoiceCount: number;
  redisClient: RedisClientType<any, any>;
  cfg: any;
  logger: any;
  ostorageService: any;

  constructor(cfg: any, db: any, events: Events, logger: any, redisClient: RedisClientType<any, any>,
    resourceTopic: Topic, ostorageService: any) {
    super('invoice', resourceTopic, logger,
      new ResourcesAPIBase(db, 'invoices'), true);
    let startingValue: string;
    redisClient.get('invoices:invoice_number').then((reply: string) => {
      if (!reply) {
        const invoiceFieldsCfg = cfg.get('invoiceFieldsGenerators:invoice');
        startingValue = invoiceFieldsCfg.invoice_number.startingValue || '0';

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
    this.cfg = cfg;
    this.logger = logger;
    this.ostorageService = ostorageService;
  }

  async generateInvoiceNumber(call: any, ctx?: any): Promise<InvoiceNumberResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    await this.redisClient.incr('invoices:invoice_number');
    return { invoice_no: count };
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

  private async invoiceAggregation(
    invoice: InvoiceList,
    subject?: Subject,
    context?: any
  ): Promise<RenderedInvoice> {
    const aggregatedInvoice: RenderedInvoice = {
      // Initialize the structure of rendered invoice
      sections: [],
      total_amounts: [], 
      // Add other invoice fields
    };
  
    try {
      // Gather information for the invoice based on invoice object
      aggregatedInvoice.invoice_number = invoice.invoice_number;
      aggregatedInvoice.payment_state = invoice.payment_state;
      // Add sender and recipient information
      aggregatedInvoice.sender = {
        // sender information
      };
      aggregatedInvoice.recipient = {
        // recipient information
      };
  
      // Loop through sections in the invoice
      for (const section of invoice.sections) {
        const aggregatedSection: AggregatedSection = {
          // Initialize the structure of aggregated section
          positions: [],
          // Add other section-level fields as needed
        };
  
        // Loop through positions in the section
        for (const position of section.positions) {
          let aggregatedPosition: AggregatedPosition = {
            // Initialize the structure of aggregated position
            // Include fields like unit_price, quantity, amount, etc.
          };
  
          if (position.product_item) {
            // Handle ProductItem aggregation
            const productItem = position.product_item;
  
            // Retrieve product information based on productItem.product_id
            const productInfo = await this.getProductInfo(productItem.product_id);
  
            // Calculate amounts, considering unit price and quantity
            const unitPrice = productInfo.unit_price;
            const quantity = position.quantity;
            const amount = unitPrice * quantity;
  
            aggregatedPosition = {
              // Populate aggregated position with calculated values
            };
          } else if (position.fulfillment_item) {
            // Handle FulfillmentItem aggregation
            const fulfillmentItem = position.fulfillment_item;
  
            // Retrieve fulfillment product information
            const fulfillmentInfo = await this.getFulfillmentInfo(
              fulfillmentItem.product_id
            );
  
            // Calculate amounts, similar to the ProductItem case
            // consider fulfillment-specific details
  
            aggregatedPosition = {
              //  aggregated position for FulfillmentItem
            };
          } else if (position.manual_item) {
            // Handle ManualItem aggregation
            const manualItem = position.manual_item;
  
            // Extract information directly from ManualItem
            // Populate aggregated position with manual item details
            aggregatedPosition = {
              // Populate aggregated position for ManualItem
            };
          }
  
          // Add the aggregated position to the section
          aggregatedSection.positions.push(aggregatedPosition);
        }
  
        // Add the aggregated section to the invoice
        aggregatedInvoice.sections.push(aggregatedSection);
      }
  
      // Calculate total amounts based on aggregated positions
      // handle multiple currencies and VAT 
  
      return aggregatedInvoice;
    } catch (error) {
      throw new Error(`Error aggregating invoice: ${error}`);
    }
  }
  
  // Helper functions for retrieving product and fulfillment information
  private async getProductInfo(productId: string): Promise<ProductInfo> {
    // Implement logic to fetch product details based on productId
    // Return product information
  }
  
  private async getFulfillmentInfo(productId: string): Promise<FulfillmentInfo> {
    // Implement logic to fetch fulfillment product details based on productId
    // Return fulfillment product information 
  }

  private async invoiceAggregation(
    invoice: Invoice,
    subject?: Subject,
    context?: any
  ): Promise<RenderedInvoice> {
    // Initialize variables to store aggregated data
    const aggregatedInvoice: RenderedInvoice = {
      // Initialize the structure of rendered invoice 
      // based on invoice structure.
    };
  
    try {
      // Gather information for the invoice based on invoice object
  
      // Loop through sections in the invoice
      for (const section of invoice.sections) {
        // Create a structure for the aggregated section
        const aggregatedSection: AggregatedSection = {
          // Initialize the structure of aggregated section
          // based on section structure.
        };
  
        // Loop through positions in the section
        for (const position of section.positions) {
          // Determine the type of item (ProductItem, FulfillmentItem, ManualItem)
          if (position.product_item) {
            // Handle ProductItem aggregation
            // Retrieve product information, calculate amounts, etc.
          } else if (position.fulfillment_item) {
            // Handle FulfillmentItem aggregation
            // Retrieve fulfillment product information, calculate amounts, etc.
          } else if (position.manual_item) {
            // Handle ManualItem aggregation
            // Extract information directly from ManualItem
          }
  
          // Add the aggregated position to the section
          aggregatedSection.positions.push(aggregatedPosition);
        }
  
        // Add the aggregated section to the invoice
        aggregatedInvoice.sections.push(aggregatedSection);
      }
  
      // Calculate total amounts, add other necessary invoice-level data
  
      return aggregatedInvoice;
    } catch (error) {
      // Handle any errors that occur during aggregation
      throw new Error(`Error aggregating invoice: ${error}`);
    }
  }
  

  private async invoiceAggregation (
    invoice_list: InvoiceList,
    subject?: Subject,
    context?: any
  ): Promise<DeepPartial<InvoiceListResponse>> {
    const section_map = await this.getSectionMap(
      invoice_list.items,
      subject,
      context
    );
    const position_map = await this.getPositionMap(
      section_map,
      subject,
      context
    );
    const product_item_map = await this.getProductItemMap(
      position_map,
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
      Object.values(
        shop_map
      ).map(
        item => item.payload?.organization_id
      ),
      this.organization_service,
      subject,
      context,
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

  private async getSectionMap(
    orders: InvoiceList,
    subject?: Subject,
    context?: any,
  ): Promise<InvoiceMap> {
    const product_ids = [...new Set<string>(orders.flatMap(
      (o) => o.items.map(
        (item) => item.product_id
      )
    ).filter(
      (id) => !!id
    )).values()];

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
}
