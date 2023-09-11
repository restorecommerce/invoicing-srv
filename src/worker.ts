import {
  Server,
  OffsetStore,
  database,
  buildReflectionService,
  Health
} from '@restorecommerce/chassis-srv';
import {
  Events,
  Topic,
  registerProtoMeta
} from '@restorecommerce/kafka-client';
import {
  // FulfillmentRequestList,
  // InvoiceIdList,
  // InvoiceList,
  InvoiceServiceDefinition,
  // InvoiceState,
  protoMetadata as InvoiceMeta,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice';
import {
  CommandInterfaceServiceDefinition,
  protoMetadata as CommandInterfaceMeta,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/commandinterface';
import { ServiceConfig, createServiceConfig } from '@restorecommerce/service-config';
import { createLogger } from '@restorecommerce/logger';
import { InvoiceService } from './service';
import { RedisClientType as RedisClient, createClient } from 'redis';
import { Arango } from '@restorecommerce/chassis-srv/lib/database/provider/arango/base';
import { Logger } from 'winston';
import { BindConfig } from '@restorecommerce/chassis-srv/lib/microservice/transport/provider/grpc';
import { HealthDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/grpc/health/v1/health';
import { ServerReflectionService } from 'nice-grpc-server-reflection';
import { Fulfillment } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth';
import { InvoicingCommandInterface } from './command_interface';
import { createClient as grpcClient, createChannel } from '@restorecommerce/grpc-client';
import { ObjectServiceDefinition as OstorageServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/ostorage';

registerProtoMeta(
  InvoiceMeta,
  CommandInterfaceMeta,
);

export class Worker {
  private _cfg: ServiceConfig;
  private _offsetStore: OffsetStore;
  private _server: Server;
  private _events: Events;
  private _logger: Logger;
  private _redisClient: RedisClient;
  private _invoicingService: InvoiceService;
  private _invoicingCommandInterface: InvoicingCommandInterface;

  get cfg() {
    return this._cfg;
  }

  protected set cfg(value: any) {
    this._cfg = value;
  }

  get offsetStore() {
    return this._offsetStore;
  }

  protected set offsetStore(value: OffsetStore) {
    this._offsetStore = value;
  }

  get server() {
    return this._server;
  }

  protected set server(value: Server) {
    this._server = value;
  }

  get events() {
    return this._events;
  }

  protected set events(value: Events) {
    this._events = value;
  }

  get logger() {
    return this._logger;
  }

  protected set logger(value: Logger) {
    this._logger = value;
  }

  get redisClient() {
    return this._redisClient;
  }

  protected set redisClient(value: RedisClient) {
    this._redisClient = value;
  }

  get invoicingService() {
    return this._invoicingService;
  }

  protected set invoicingService(value: InvoiceService) {
    this._invoicingService = value;
  }

  get invoicingCommandInterface() {
    return this._invoicingCommandInterface;
  }

  protected set invoicingCommandInterface(value: InvoicingCommandInterface) {
    this._invoicingCommandInterface = value;
  }

  protected readonly topics = new Map<string, Topic>();
  protected readonly serviceActions = new Map<string, ((msg: any, context: any, config: any, eventName: string) => Promise<any>)>();

  protected readonly handlers = {
    // handleCreateInvoices: (msg: InvoiceList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.create(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleUpdateInvoices: (msg: InvoiceList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.update(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleUpsertInvoices: (msg: InvoiceList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.upsert(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleSubmitInvoices: (msg: InvoiceList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.submit(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillInvoices: (msg: FulfillmentRequestList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.createFulfillment(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleWithdrawInvoices: (msg: InvoiceIdList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.withdraw(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleCancelInvoices: (msg: InvoiceIdList, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.cancel(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleDeleteInvoices: (msg: any, context: any, config: any, eventName: string) => {
    //   return this.invoicingService?.delete(msg, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillmentSubmitted: (msg: Fulfillment, context: any, config: any, eventName: string) => {
    //   if (msg?.reference?.instance_type !== this.invoicingService.instanceType) return;
    //   const ids = [msg?.reference?.instance_id];
    //   const subject = {} as Subject; // System Admin?
    //   return this.invoicingService?.updateState(ids, InvoiceState.IN_PROCESS, subject, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillmentInvalid: (msg: Fulfillment, context: any, config: any, eventName: string) => {
    //   if (msg?.reference?.instance_type !== this.invoicingService.instanceType) return;
    //   const ids = [msg?.reference?.instance_id];
    //   const subject = {} as Subject; // System Admin?
    //   return this.invoicingService?.updateState(ids, InvoiceState.INVALID, subject, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillmentFulfilled: (msg: Fulfillment, context: any, config: any, eventName: string) => {
    //   if (msg?.reference?.instance_type !== this.invoicingService.instanceType) return;
    //   const ids = [msg?.reference?.instance_id];
    //   const subject = {} as Subject; // System Admin?
    //   return this.invoicingService?.updateState(ids, InvoiceState.DONE, subject, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillmentFailed: (msg: Fulfillment, context: any, config: any, eventName: string) => {
    //   if (msg?.reference?.instance_type !== this.invoicingService.instanceType) return;
    //   const ids = [msg?.reference?.instance_id];
    //   const subject = {} as Subject; // System Admin?
    //   return this.invoicingService?.updateState(ids, InvoiceState.FAILED, subject, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillmentWithdrawn: (msg: Fulfillment, context: any, config: any, eventName: string) => {
    //   if (msg?.reference?.instance_type !== this.invoicingService.instanceType) return;
    //   const ids = [msg?.reference.instance_id];
    //   const subject = {} as Subject; // System Admin?
    //   return this.invoicingService?.updateState(ids, InvoiceState.CANCELLED, subject, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    // handleFulfillmentCancelled: (msg: Fulfillment, context: any, config: any, eventName: string) => {
    //   if (msg?.reference?.instance_type !== this.invoicingService.instanceType) return;
    //   const ids = [msg?.reference.instance_id];
    //   const subject = {} as Subject; // System Admin?
    //   return this.invoicingService?.updateState(ids, InvoiceState.CANCELLED, subject, context).then(
    //     () => this.logger.info(`Event ${eventName} handled.`),
    //     err => this.logger.error(`Error while handling event ${eventName}: ${err}`)
    //   );
    // },
    handleQueuedJob: (msg: any, context: any, config: any, eventName: string) => {
      return this.serviceActions.get(msg?.type)(msg?.data?.payload, context, config, msg?.type).then(
        () => this.logger.info(`Job ${msg?.type} done.`),
        (err: any) => this.logger.error(`Job ${msg?.type} failed: ${err}`)
      );
    },
    handleCommand: (msg: any, context: any, config: any, eventName: string) => {
      return this.invoicingCommandInterface.command(msg, context);
    }
  };

  async start(cfg?: ServiceConfig, logger?: Logger): Promise<any> {
    // Load config
    this._cfg = cfg = cfg ?? createServiceConfig(process.cwd());
    this.logger = logger = logger ?? createLogger(cfg.get('logger'));

    // get database connection
    const db = await database.get(cfg.get('database:main'), logger);

    // create events
    const kafkaCfg = cfg.get('events:kafka');
    this.events = new Events(kafkaCfg, logger);
    await this.events.start();
    this.offsetStore = new OffsetStore(this.events, cfg, logger);
    logger.info('Event Groupes started');

    const redisConfig = cfg.get('redis');
    redisConfig.db = this.cfg.get('redis:db-indexes:db-subject');
    this.redisClient = createClient(redisConfig);
    await this.redisClient.connect();

    await Promise.all(Object.keys(kafkaCfg.topics).map(async key => {
      const topicName = kafkaCfg.topics[key].topic;
      const topic = await this.events.topic(topicName);
      const offsetValue = await this.offsetStore.getOffset(topicName);
      logger.info('subscribing to topic with offset value', topicName, offsetValue);
      await Promise.all(Object.entries(kafkaCfg.topics[key]?.events ?? {}).map(
        ([eventName, handler]) => {
          const handle = this.handlers[handler as string];
          if (!!handle) {
            this.serviceActions[eventName as string] = handle;
            return topic.on(
              eventName as string,
              handle,
              { startingOffset: offsetValue }
            );
          }
          else {
            logger.warn(`Topic Listener with handle name ${handler} not supported!`);
          }
        }
      ));
      await topic.consumer?.run();
      this.topics.set(key, topic);
    }));

    // create server
    this.server = new Server(cfg.get('server'), logger);

    // invoicing command interface
    logger.verbose('Setting up command interface services');
    this.invoicingCommandInterface = new InvoicingCommandInterface(
      this.server,
      cfg,
      logger,
      this.events,
      this.redisClient
    );

    const clientCfg = this.cfg.get('client:services:ostorage');
    const channel = createChannel(clientCfg.address);
    const ostorageService = grpcClient({
      ...clientCfg,
      logger
    }, OstorageServiceDefinition, channel);

    // invoicing service
    logger.verbose('Setting up invoicing services');
    this.invoicingService =
      new InvoiceService(this.cfg, db, this.events, this.logger,
        this.redisClient, this.topics.get('invoice.resource'), ostorageService);

    logger.verbose('Add server bindings');
    const serviceNamesCfg = cfg.get('serviceNames');

    await this.server.bind(serviceNamesCfg.invoicing, {
      service: InvoiceServiceDefinition,
      implementation: this.invoicingService
    } as unknown as BindConfig<InvoiceServiceDefinition>);

    await this.server.bind(serviceNamesCfg.cis, {
      service: CommandInterfaceServiceDefinition,
      implementation: this.invoicingCommandInterface,
    } as BindConfig<CommandInterfaceServiceDefinition>);

    await this.server.bind(serviceNamesCfg.health, {
      service: HealthDefinition,
      implementation: new Health(
        this.invoicingCommandInterface,
        {
          logger,
          cfg,
          dependencies: [],
          readiness: () => (db as Arango).db.version().then(v => !!v)
        }
      )
    } as BindConfig<HealthDefinition>);

    // Add reflection service
    const reflectionServiceName = serviceNamesCfg.reflection;
    const reflectionService = buildReflectionService([
      { descriptor: InvoiceMeta.fileDescriptor },
    ]);

    await this.server.bind(reflectionServiceName, {
      service: ServerReflectionService,
      implementation: reflectionService
    });

    // start server
    await this.server.start();
    this.logger.info('server started successfully');
  }

  async stop(): Promise<any> {
    this.logger.info('Shutting down');
    await Promise.allSettled([
      this.events?.stop().catch(
        err => this.logger.error(err)
      )
    ]);
    await Promise.allSettled([
      this.server?.stop().catch(
        err => this.logger.error(err)
      ),
      this.offsetStore?.stop().catch(
        err => this.logger.error(err)
      ),
    ]);
  }
}

if (require.main === module) {
  const worker = new Worker();
  const logger = worker.logger;
  worker.start().catch((err) => {
    logger.error('startup error', err);
    process.exit(1);
  });

  process.on('SIGINT', () => {
    worker.stop().catch((err) => {
      logger.error('shutdown error', err);
      process.exit(1);
    });
  });
}

