import * as _ from 'lodash';
import * as bluebird from 'bluebird';
import * as chassis from '@restorecommerce/chassis-srv';
import * as fetch from 'node-fetch';
import * as MemoryStream from 'memorystream';
import * as redis from 'redis';
import {InvoiceService} from './InvoiceResourceService';
import {
  BillingAddress, EconomicAreas, InvoicePositions, RenderingStrategy
} from './interfaces';
import {Events, Topic} from '@restorecommerce/kafka-client';
import {
  getJSONPaths, getPreviousMonth, marshallProtobufAny, requestID,
  storeInvoicePositions, unmarshallProtobufAny
} from './utils';
import * as grpcClient from '@restorecommerce/grpc-client';
import {Logger} from 'winston';
import {createLogger} from '@restorecommerce/logger';
import {createServiceConfig} from '@restorecommerce/service-config';
import {Arango} from '@restorecommerce/chassis-srv/lib/database/provider/arango/base';

bluebird.promisifyAll(redis.RedisClient.prototype);
const DELETE_ORG_DATA = 'deleteOrgData';

export let billingService: BillingService;

class BillingCommandInterface extends chassis.CommandInterface {
  constructor(server: chassis.Server, cfg: any, logger: Logger, events: Events,
    redisClient: redis.RedisClient) {
    super(server, cfg, logger, events, redisClient);
  }

  async restore(payload: any): Promise<any> {
    this.logger.info(
      'Restore operation called. Executing operation prologue...');
    this.logger.info('Resetting Redis counters...');

    const fieldGenConfig = this.config.invoiceFieldsGenerators;
    await billingService.redisClient.setAsync('invoices:invoice_number',
      fieldGenConfig.invoice.invoice_number.startingValue);
    return await super.restore(payload);
  }

  async reset(): Promise<any> {
    await super.reset();
    this.logger.info('Executing reset extension...');
    this.logger.info('Resetting Redis data...');

    // resetting counter
    const fieldGenConfig = this.config.invoiceFieldsGenerators;
    await billingService.redisClient.setAsync('invoices:invoice_number',
      fieldGenConfig.invoice.invoice_number.startingValue);

    this.logger.info('Resetting cached data...');
    // billingService.resourceProvider = new BillingResourceProvider(billingService.cfg,
    //   billingService.logger, billingService.microserviceClients);
    billingService.pendingTasks = new Map<string, Object>();
    this.logger.info('Reset concluded');

    return {};
  }

  makeResourcesRestoreSetup(db: any, collectionName: string): any {
    const that = this;
    return {
      [`${collectionName}Deleted`]: async function restoreDeleted(message: any,
        ctx: any, config: any, eventName: string): Promise<any> {
        await db.delete(collectionName, {id: message.id});
        return {};
      },
      [`${collectionName}Modified`]: async function restoreModified(message: any,
        ctx: any, config: any, eventName: string): Promise<any> {
        await db.update(collectionName, {id: message.id},
          _.omitBy(message, _.isNil));
        return {};
      },
      [`${collectionName}Created`]: async function restoreCreated(message: any,
        ctx: any, config: any, eventName: string): Promise<any> {
        await db.insert(`${collectionName}s`, message);
        // incrementing counter
        await billingService.redisClient.incrAsync('invoices:invoice_number');
        return {};
      }
    };
  }
}

export class BillingService {
  pendingTasks: Map<string, Object>;
  invoiceService: InvoiceService;
  redisClient: any;
  redisInvoicePosClient: any;
  cfg: any;
  logger: Logger;
  events: Events;
  offsetStore: chassis.OffsetStore;
  topics: Map<string, Topic>;
  server: chassis.Server;
  templatesURLPrefix: string;
  externalRrc: any;
  bodyTpl: any;
  layoutTpl: any;
  subjectTpl: any;
  attachmentTpl: any;
  commandInterface: BillingCommandInterface;

  constructor(cfg: any, logger: Logger) {
    this.cfg = cfg;
    this.logger = logger;
    const redisConfig = cfg.get('redis');
    redisConfig.db = cfg.get('redis:db-indexes:db-invoiceCounter');
    this.redisClient = redis.createClient(redisConfig);
    redisConfig.db = cfg.get('redis:db-indexes:db-invoicePositions');
    this.redisInvoicePosClient = redis.createClient(redisConfig);
    this.pendingTasks = new Map<string, Object>();
    const that = this;

    this['eventsListener'] = async (msg: any, context: any, config: any,
      eventName: string): Promise<any> => {

      switch (eventName) {
        case 'triggerInvoices':
          await that.sendRenderRequests(msg);
          break;
        case 'storeInvoicePositions':
          // store Invoice positions to redis - although an array is sent to kafka
          // it emits each object to kafka (just like for any normal resource)
          const eachInvoicePos = msg;
          that.logger.info(`Received message with event name ${eventName}:`,
            {eachInvoicePos});
          await storeInvoicePositions(that.redisInvoicePosClient,
            eachInvoicePos.id, eachInvoicePos, that.logger);
          break;
        case 'renderResponse':
          try {
            const reqID = msg.id;
            const split = reqID.split('###');
            let emailAddress: string = split[0];
            const invoiceNumber = split[1];
            const org_userID = split[2];

            let found = false;
            for (let [jobID, jobData] of that.pendingTasks) {
              if (jobData['pendingEmails'].has(reqID)) {
                found = true;
                if (msg.response.length == 0) {
                  that.logger.silly(
                    'Empty response from rendering request. Skipping.');
                  return;
                }

                // parsing render response
                const renderedEmailBody = msg.response[0];
                const renderedEmailSubject = msg.response[1];
                const renderedAttachment = msg.response[2];

                const emailObj = unmarshallProtobufAny(renderedEmailBody);
                const subjectObj = unmarshallProtobufAny(renderedEmailSubject);
                const attachmentObj = unmarshallProtobufAny(renderedAttachment);

                // sending HTML content for PDF rendering request
                const pdf = await that.renderPDF(attachmentObj.attachment);
                await that.sendInvoiceEmail(subjectObj.subject, emailObj.body,
                  pdf, emailAddress, invoiceNumber, org_userID);
                // the jobDone would now be handled on contract-srv
                jobData['pendingEmails'].delete(reqID);

                const deleteResponse = await new Promise((resolve, reject) => {
                  that.redisInvoicePosClient.del(jobID,
                    (err: any, response: any): any => {
                      if (err) {
                        reject(err);
                      }
                      resolve(response);
                    });
                });
                if (deleteResponse === 1) {
                  that.logger.info(`Redis key ${jobID} deleted Successfully`);
                }

                if (jobData['pendingEmails'].size == 0) { // flush
                  const jobDoneMessage: any = jobData['job'];
                  await that.topics.get('jobs').emit('jobDone', jobDoneMessage);
                  that.pendingTasks.delete(jobID);
                }
              }
            }

            if (!found) {
              that.logger.silly('Unknown render response with ID', msg.id,
                '; discarding message.');
            }
          } catch (err) {
            if (err.name) {
              that.logger.error(err.name);
              that.logger.verbose(err.stack);
            } else {
              that.logger.error(err);
            }
          }
          break;
        case DELETE_ORG_DATA:
          try {
            // get list of Org and userIDs
            const {org_ids, user_ids} = msg;
            // delete associated resources with the orgs and users
            that.logger.info('Deleting invoices for organizations :',
              {ids: org_ids});
            await that.invoiceService.deleteInvoicesByOrganization(org_ids,
              user_ids);
          } catch (err) {
            that.logger.error('Exception caught deleting Org data:', err);
          }
          break;

        default:  // commands
          await that.commandInterface.command(msg, context);
          break;
      }
    };
  }

  async start(): Promise<void> {
    const db = await chassis.database.get(this.cfg.get('database:main'),
      this.logger);
    const serviceNamesCfg = this.cfg.get('serviceNames');

    // create Server
    this.server = new chassis.Server(this.cfg.get('server'), this.logger);

    // create events
    const kafkaCfg = this.cfg.get('events:kafka');
    this.events = new Events(kafkaCfg, this.logger);
    await this.events.start();
    this.offsetStore =
      new chassis.OffsetStore(this.events, this.cfg, this.logger);

    const topicTypes = _.keys(kafkaCfg.topics);
    this.topics = new Map<string, Topic>();

    for (let topicType of topicTypes) {
      const topicName = kafkaCfg.topics[topicType].topic;
      const topic = this.events.topic(topicName);
      const offSetValue: number = await this.offsetStore.getOffset(topicName);
      this.logger.info('subscribing to topic with offset value', {topicName},
        {offSetValue});
      if (kafkaCfg.topics[topicType].events) {
        const eventNames = kafkaCfg.topics[topicType].events;
        for (let eventName of eventNames) {
          await topic.on(eventName, this['eventsListener'], {
            startingOffset: offSetValue
          });
        }
      }
      this.topics.set(topicType, topic);
    }

    this.commandInterface = new BillingCommandInterface(this.server,
      this.cfg, this.logger, this.events, this.redisClient);
    await this.server.bind(serviceNamesCfg.cis, this.commandInterface);

    // ostorage client to store billing pdfs
    const clientCfg = this.cfg.get('client:services:ostorage');
    const client = new grpcClient.Client(clientCfg, this.logger);
    const ostorageService = await client.connect();

    this.invoiceService =
      new InvoiceService(this.cfg, db, this.events, this.logger,
        this.redisClient, this.topics.get('invoice.resource'), ostorageService);
    await this.server.bind(serviceNamesCfg.billing, this.invoiceService);

    // Add ReflectionService
    const reflectionServiceName = serviceNamesCfg.reflection;
    const transportName = this.cfg.get(
      `server:services:${reflectionServiceName}:serverReflectionInfo:transport:0`);
    const transport = this.server.transport[transportName];
    const reflectionService = new chassis.ServerReflection(transport.$builder,
      this.server.config);
    await this.server.bind(serviceNamesCfg.reflection, reflectionService);

    await this.server.bind(serviceNamesCfg.health,
      new chassis.Health(this.commandInterface, {
        readiness: async () => !!await ((db as Arango).db).version()
      }));

    // load templates
    await this.loadTemplates();

    // start server
    await this.server.start();
    this.logger.info('server started successfully');
  }

  // This needs to read only those contract_ids i.e. invoicePositions for which
  // the email notification needs to be sent out now and this is in turn decided by contract-srv
  // which actually reads the schedule and triggers sending of Invoice
  async sendRenderRequests(msg: any): Promise<boolean> {
    try {
      const ids = msg.ids;
      // id can be either contract or customer_id stored as key in redis
      // for the invoicePosition
      for (let id of ids) {
        // the id here refers to contractID or orderID along with org or userID
        const org_userID = id.split('###')[1];
        let invoiceData: any = await new Promise((resolve, reject) => {

          this.redisInvoicePosClient.get(id, (err, response) => {
            if (err) {
              reject(err);
            }
            resolve(response);
          });
        });
        if (!invoiceData) {
          this.logger.info(
            `There was no Invoice positions stored for the identifier ${id} and hence
            skipping sending notification of Invoice`);
          continue;
        }
        invoiceData = JSON.parse(invoiceData.toString());
        let data: any = {};
        data.invoice_positions = invoiceData.invoice_positions;
        data.recipient_customer = invoiceData.recipient_customer;
        data.recipient_organization = invoiceData.recipient_organization;
        data.recipient_billing_address = invoiceData.recipient_billing_address;
        data.sender_billing_address = invoiceData.sender_billing_address;
        data.sender_organization = invoiceData.sender_organization;
        data.payment_method_details = invoiceData.payment_method_details;

        // generate invoice pdfs
        const invoice = await this.buildInvoice(data, org_userID);
        await this.sendHTMLRenderRequest(invoiceData.recipient_billing_address,
          invoice, id);
      }
    } catch (err) {
      if (err.name) {
        this.logger.error(err.name);
        this.logger.verbose(err.stack);
      } else {
        this.logger.error(err);
      }
      return false;
    }

    return true;
  }

  async sendInvoiceEmail(subject: string, body: string, invoice: Buffer,
    email: string, invoiceNumber: number, org_userID: string): Promise<void> {
    const now = getPreviousMonth();
    const notification = {
      body,
      subject,
      transport: 'email',
      email: {
        to: email.split(',')
      },
      attachments: [
        {
          buffer: invoice,
          filename: `Invoice_${now.format('YYYY')}_${now.format('MMMM')}.pdf`,
          content_type: 'application/pdf',
        }
      ]
    };

    await this.topics.get('notificationReq').emit('sendEmail', notification);

    // persist invoice and delete tmp from Redis
    await this.invoiceService.saveInvoice(
      requestID(email, invoiceNumber, org_userID),
      invoice, `Invoice_${now.format('YYYY')}_${now.format('MMMM')}`);
  }

  /**
   *
   * @param data
   */
  async buildInvoice(data: InvoicePositions, org_userID: string): Promise<any> {
    const {
      invoice_positions, sender_billing_address, sender_organization,
      recipient_billing_address, recipient_organization, recipient_customer,
      payment_method_details
    } = data;

    const phoneNumber = recipient_billing_address.telephone;

    const subTotalGross = invoice_positions[0].totalPrice.gross;
    const subTotalNet = invoice_positions[0].totalPrice.net;

    let vatText: string, showVAT = true;

    // VAT value is only chargeable within Germany,
    // but it should be shown if the country belongs to EEA

    switch (recipient_billing_address.economic_area) {
      case EconomicAreas.DE:
        vatText = '+ VAT';
        break;
      case EconomicAreas.EEA:
        vatText = `VAT Free, ${sender_organization.vat_id}`;
        break;
      case EconomicAreas.OTHER:
        vatText = 'VAT Free';
        showVAT = true;
        break;
    }
    const senderLogo = sender_organization.logo;

    const now = new Date();
    const lastMonth = new Date();
    lastMonth.setDate(0);

    const invoice = {
      month: lastMonth.toISOString(),
      logo: senderLogo,

      senderOrganizationName: sender_organization.name,
      senderStreet: sender_billing_address.street,
      senderPostcode: sender_billing_address.postcode,
      senderRegion: sender_billing_address.region,
      senderCountry: sender_billing_address.country_name,

      invoiceNumber: await this.invoiceService.getInvoiceCount(),
      timestamp: now.toISOString(),
      timezone: sender_billing_address.timezone,
      paymentStatus: 'unpaid',
      customerNumber: recipient_customer.customer_number,
      showVAT,
      customerVAT: sender_organization.vat_id,

      customerName: recipient_organization.name,
      customerStreet: recipient_billing_address.street,
      customerPostcode: recipient_billing_address.postcode,
      customerRegion: recipient_billing_address.region,
      customerCountry: recipient_billing_address.country_name,

      productList: invoice_positions[0].tableList,
      currency: invoice_positions[0].currency,

      subTotalGross,
      subTotalNet,

      vatText,
      vatValue: subTotalGross - subTotalNet,
      total: subTotalGross,

      senderBank: payment_method_details.bankName,
      senderIBAN: payment_method_details.iban,
      senderBIC: payment_method_details.bic,

      senderEmail: sender_billing_address.email,
      senderWebsite: sender_billing_address.website,
      senderPhoneNumber: phoneNumber,

      senderRegistrationNumber: sender_organization.registration,
      senderRegistrationCourt: sender_organization.registration_court,
      senderVAT: sender_organization.vat_id
    };

    // invoice resource temporarily held in memory until PDF is rendered from HTML
    const invoiceResource = {
      timestamp: invoice.timestamp,
      customer_id: recipient_customer.id,
      total_amount: invoice.total,
      net_amount: invoice.subTotalNet,
      vat_amount: invoice.vatValue,
      payment_status: invoice.paymentStatus,
      invoice_number: invoice.invoiceNumber
    };

    await this.invoiceService.holdInvoice(invoiceResource, requestID(
      recipient_billing_address.email, invoiceResource.invoice_number,
      org_userID));
    return invoice;
  }

  /**
   *
   * @param billingAddress
   * @param invoice
   * @param msg_id
   */
  async sendHTMLRenderRequest(billingAddress: BillingAddress, invoice: any,
    msg_id: string): Promise<void> {

    const options = {
      texts: {},
      locale: billingAddress.locale || 'de-DE'
    };

    let styleURL: string;
    if (this.externalRrc) {
      styleURL = this.externalRrc.styleURL;
    }
    // msg_id is contract_id###organization_id or order_id###organization_id
    // or order_id###user_id - this is needed for setting the scope of generated
    // invoice while storing in ostorage-srv
    const identifier = msg_id.split('###')[1];
    const id = requestID(billingAddress.email, invoice.invoiceNumber,
      identifier);
    const renderRequest = {
      id,
      payload: [
        {
          templates: marshallProtobufAny({
            body: {body: this.bodyTpl, layout: this.layoutTpl}
          }),
          data: marshallProtobufAny(invoice),
          options: marshallProtobufAny(options),
          content_type: 'application/html'
        },
        {
          templates: marshallProtobufAny({
            subject: {body: this.subjectTpl}
          }),
          data: marshallProtobufAny(invoice),
          options: marshallProtobufAny(options),
          content_type: 'application/text'
        },
        {
          templates: marshallProtobufAny({
            attachment: {body: this.attachmentTpl, layout: this.layoutTpl},
          }),
          data: marshallProtobufAny(invoice),
          style_url: styleURL,
          options: marshallProtobufAny(options),
          strategy: RenderingStrategy.COPY,
          content_type: 'application/pdf'
        },
      ]
    };

    await this.topics.get('rendering').emit('renderRequest', renderRequest);

    if (!this.pendingTasks.has(msg_id)) {
      this.pendingTasks.set(msg_id, {
        pendingEmails: new Set<String>()
      });
    }

    this.pendingTasks.get(msg_id)['pendingEmails'].add(id);
  }

  async loadTemplates(): Promise<any> {
    try {
      this.logger.info('Loading HBS templates...');

      const hbsTemplates = this.cfg.get('hbs_templates');
      this.templatesURLPrefix = hbsTemplates.prefix;
      const templates = hbsTemplates.templates;

      let response = await fetch(this.templatesURLPrefix + templates['layout'],
        {});
      this.layoutTpl = await response.text();

      response = await fetch(this.templatesURLPrefix + templates['body'], {});
      this.bodyTpl = await response.text();

      response =
        await fetch(this.templatesURLPrefix + templates['subject'], {});
      this.subjectTpl = await response.text();

      if (templates['attachment']) {
        response =
          await fetch(this.templatesURLPrefix + templates['attachment'], {});
        this.attachmentTpl = await response.text();
      }

      response =
        await fetch(this.templatesURLPrefix + templates['resources'], {});
      this.externalRrc = JSON.parse(await response.text());
    } catch (err) {
      this.logger.error('Error ocurred while loading HBS templates:', err);
    }
  }

  /**
   * used for rendering the pdf, the url for rendering is constructed using the
   * configurations and pdf options
   * @param htmlInvoice - Invoice
   * @returns Promise<Buffer>
   */
  async renderPDF(htmlInvoice: any): Promise<Buffer> {
    const apiKey = this.cfg.get('pdf-rendering:apiKey');
    let baseURL = this.cfg.get('pdf-rendering:url');
    const footerTemplatePrefix = 'pdf.footerTemplate';
    const headerTemplatePrefix = 'pdf.headerTemplate';
    let pdfOptions = [];
    const paramSeparator = '&';
    getJSONPaths(this.cfg.get('pdf-rendering:options'), '', pdfOptions);
    let pdfOptionsURI = '';
    for (let pdfOption of pdfOptions) {
      if (pdfOption.includes(footerTemplatePrefix)) {
        const footerTemplateURL = pdfOption.split('=')[1];
        let response = await this.fetchURL(footerTemplateURL, {method: 'GET'});
        // let footerTemplate = response.toString().replace(/(\r\n|\n|\r)/gm, '');
        // footerTemplate = footerTemplate.replace(/\s+/g, '');
        pdfOption = footerTemplatePrefix + '=' + response.toString();
      } else if (pdfOption.includes(headerTemplatePrefix)) {
        const headerTemplateURL = pdfOption.split('=')[1];
        const response = await this.fetchURL(headerTemplateURL,
          {method: 'GET'});
        pdfOption = headerTemplatePrefix + '=' + response.toString();
      }
      pdfOptionsURI = pdfOptionsURI + pdfOption + paramSeparator;
    }
    if (!_.isEmpty(pdfOptionsURI)) {
      // add query params
      baseURL = baseURL + '?' + pdfOptionsURI;
    }
    // construct the pdfOptionsURI
    const headers = {
      'X-API-KEY': apiKey,
      'Content-Type': 'text/html'
    };
    const options = {
      method: 'POST',
      body: htmlInvoice,
      headers
    };
    return await this.fetchURL(baseURL, options);
  }

  private async fetchURL(url: string, options: any): Promise<Buffer> {
    const stream = new MemoryStream(null, {readable: false});
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error('Error retrieving PDF!');
    }
    const pdfResult = await response.body;
    pdfResult.pipe(stream);

    return new Promise<Buffer>((resolve, reject) => {
      pdfResult.on('end', () => {
        resolve(stream.toBuffer());
      });
    });
  }

  async stop(): Promise<any> {
    this.logger.info('Shutting down');
    await this.server.stop();
    await this.events.stop();
    await this.offsetStore.stop();
  }
}

if (require.main === module) {
  const cfg = createServiceConfig(process.cwd());
  const logger = createLogger(cfg.get('logger'));
  const service = new BillingService(cfg, logger);
  service.start().catch((err) => {
    console.error('client error', err.stack);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    service.stop().catch((err) => {
      console.error('shutdown error', err);
      process.exit(1);
    });
  });
}
