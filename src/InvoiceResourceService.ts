import {
  ResourcesAPIBase, ServiceBase
} from '@restorecommerce/resource-base-interface';
import { Events, Topic } from '@restorecommerce/kafka-client';
import * as _ from 'lodash';
import { RedisClientType } from 'redis';
import { Readable, Transform } from 'stream';

export class InvoiceService extends ServiceBase {
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

  async getInvoiceCount(): Promise<any> {
    const count = await this.redisClient.get('invoices:invoice_number');
    await this.redisClient.incr('invoices:invoice_number');
    return count;
  }

  /**
   * Temporarily hold the invoice in redis to later be persisted in the database.
   * @param invoice
   * @param requestID
   */
  async holdInvoice(invoice: any, requestID: string): Promise<any> {
    // TODO: HASH SET!!!
    await this.redisClient.set(`tmp_invoices:${requestID}`,
      JSON.stringify(invoice));
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

    fileName = `${fileName}_${org_userID}.pdf`;
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
            bucket: 'inovoices',
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

    await super.create({
      request: {
        items: [invoice]
      }
    }, {});

    // deleted in-memory invoice if it exists
    await this.redisClient.del(`tmp_invoices:${invoice.invoice_number}`);
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
      const result = await super.read({
        request: {
          custom_queries: ['filterByOwnership'],
          custom_arguments: {
            value: Buffer.from(JSON.stringify({
              entity: ownerOrgURN,
              instance: [org]
            }))
          }
        }
      });
      if (result?.operation_status?.code != 200) {
        this.logger.error('Error while filtering invoices by ownership',
          result.error);
        return;
      }
      let items = [];
      result.items.map((itemObj) => items.push(itemObj.payload));
      await this.deleteItemsByOwner(items, orgIDs, userIDs);
    }

    for (let user of userIDs) {
      const result = await super.read({
        request: {
          custom_queries: ['filterByOwnership'],
          custom_arguments: {
            value: Buffer.from(JSON.stringify({
              entity: ownerUserURN,
              instance: [user]
            }))
          }
        }
      });
      if (result?.operation_status?.code != 200) {
        this.logger.error('Error while filtering invoices by ownership',
          result.error);
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
    await super.delete({ request: { ids: toDelete } });
  }
}
