import { type RedisClientType, createClient } from 'redis';
import { registerProtoMeta } from '@restorecommerce/kafka-client';
import {
  InvoiceServiceDefinition,
  protoMetadata as InvoiceProtoMetadata,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import {
  protoMetadata as RenderingMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import {
  protoMetadata as NotificationReqMeta
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/notification_req.js';
import { ServiceBindConfig, WorkerBase } from './experimental/WorkerBase.js';
import { InvoiceService } from './services/invoice_srv.js';

registerProtoMeta(
  RenderingMeta,
  NotificationReqMeta,
);

export class Worker extends WorkerBase {
  protected async initServices(): Promise<ServiceBindConfig<any>[]> {
    const redisConfig = this.cfg.get('redis');
    redisConfig.db = this.cfg.get('redis:db-indexes:db-invoiceCounter');
    const redisClient: RedisClientType = createClient(redisConfig);
    await redisClient.connect();

    const serviceBindConfigs: ServiceBindConfig<any>[] = [
      {
        name: this.cfg.get('serviceNames:invoicing'),
        service: InvoiceServiceDefinition,
        implementation: new InvoiceService(
          this.topics.get('invoicing.resource'),
          this.topics.get('rendering'),
          this.topics.get('notificationReq'),
          this.db,
          redisClient,
          this.cfg,
          this.logger,
        ),
        meta: InvoiceProtoMetadata,
      } as ServiceBindConfig<InvoiceServiceDefinition>
    ];
    return serviceBindConfigs;
  }
}