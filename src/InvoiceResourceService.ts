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
  InvoiceListResponse, InvoiceList
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice';
import { ReadRequest, DeleteRequest } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base';
import { billingService } from './service';
import { PDFRenderer } from 'pdf-renderer-library';

export class InvoiceService extends ServiceBase<InvoiceListResponse, InvoiceList> implements InvoiceService {
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

  // TODO Mark invoices as withdrawn
  async withdraw(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    await this.redisClient.set('invoices:withdrawn', 'true').catch(err => {
      this.logger.error('Error marking invoices as withdrwn');
    });
    return {
      items: context,
      total_count: Number(count)
    };
  }

  // TODO Should Evaluates and (re-)Renders invoices as PDF to ostorage. (creates if not exist, updates if id is given)
  // async render(call: any, ctx?: any): Promise<InvoiceListResponse> {
  //   const context = call?.request?.context;
  //   let count = await this.redisClient.get('invoices:invoice_number');
  //   await this.redisClient.incr('invoices:invoice_number');
  //   return {
  //     items: context,
  //     total_count: Number(count)
  //   };
  // }

  async render(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    const invoiceNumber = await this.redisClient.incr('invoices:invoice_number');

    // Render the invoice as a PDF
    const pdfRenderer = new PDFRenderer(); // Initialize the PDF renderer
    const invoicePdf = await pdfRenderer.renderInvoice(context); // Render the invoice using the context data

    // Save the PDF to storage
    const storageId = call?.request?.storageId;
    if (storageId) {
      // If a storageId is provided, update the existing PDF in storage
      await this.updatePdfInStorage(storageId, call.request.requestID, invoicePdf, call.request.fileName);
    } else {
      // If no storageId is provided, create a new PDF in storage
      const newStorageId = await this.createPdfInStorage(call.request.requestID, invoicePdf, call.request.fileName);
      call.request.storageId = newStorageId; // Update the storageId in the call object
    }

    return {
      items: context,
      total_count: Number(count)
    };
  }

  async createPdfInStorage(requestID: string, invoicePdf: Buffer, fileName): Promise<any> {
    return this.saveInvoice(requestID, invoicePdf, fileName);
    
    // Logic to create a new PDF in storage and return the storageId
    // ...
  }

  async updatePdfInStorage(storageId: string, requestID: string, invoicePdf: Buffer, fileName): Promise<void> {
    return this.saveInvoice(storageId, invoicePdf, fileName);
    // Logic to update the existing PDF in storage with the provided storageId
    // ...
  }

  // TODO Triggers notification-srv (sends invoice per email for instance)
  async send(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let listItems = call?.request?.items;
    let email = call?.request?.billingAddress?.contact?.email;
    billingService.sendInvoiceEmail(call.subject, call.body, call.invoice, email, call.invoice_number, call.org_userID);
    let count = await this.redisClient.get('invoices:invoice_number');

    return {
      items: listItems,
      total_count: Number(count)
    };
  }

  // What is this for ?
  // // gRPC version of the send method
  // async sendGRPC(call: any, callback: any): Promise<void> {
  //   try {
  //     const request = call.request;
  //     const response = await this.send(request);
  //     callback(null, response);
  //   } catch (error) {
  //     callback(error);
  //   }
  // }

  async create(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    // await this.redisClient.incr('invoices:invoice_number');
    // TODO YOU need to create a Invoice and store it to Invoice ArangoDB.
    // Also upload PDF to OSS
    let listItems = call?.request?.items;
    await super.create(listItems, context);
    await this.saveInvoice(call?.requestID, call?.document, call?.filename);
    return {
      items: listItems,
      total_count: Number(count)
    };
  }

  // TODO
  // UPDATE UPSERT -> UPDATES or UPSERTS INVOICE Resources
  // DELETE -> Should DELETE Invoice Resource

  async upsert(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    await this.redisClient.incr('invoices:invoice_number');
    let listItems = call?.request?.items;
    await super.upsert(listItems, context);
    return {
      items: listItems,
      total_count: Number(count)
    };
  }

  async update(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    await this.redisClient.incr('invoices:invoice_number');
    let listItems = call?.request?.items;
    await super.update(listItems, context);
    return {
      items: listItems,
      total_count: Number(count)
    };
  }

  async delete(call: any, ctx?: any): Promise<InvoiceListResponse> {
    const context = call?.request?.context;
    let count = await this.redisClient.get('invoices:invoice_number');
    let listItems = call?.request?.items;
    await super.delete(listItems, context);
    return {
      items: listItems,
      total_count: Number(count)
    };
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
      if (itemObj?.payload?.documents) {
        for (let doc of itemObj?.payload?.documents) {
          doc.id =
            Buffer.from(doc.id, 'base64').toString();
        }
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
}
