import { RedisClientType as RedisClient, createClient } from 'redis';
import {
  InvoiceServiceDefinition,
  protoMetadata as InvoiceProtoMetadata,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import { ServiceBindConfig, WorkerBase } from './experimental/WorkerBase.js';
import { InvoiceService } from './services/invoice_srv.js';

export class Worker extends WorkerBase {
  protected async initServices(): Promise<ServiceBindConfig<any>[]> {
    const redisConfig = this.cfg.get('redis');
    redisConfig.db = this.cfg.get('redis:db-indexes:db-invoiceCounter');
    const redisClient: RedisClient = createClient(redisConfig);
    await redisClient.connect();
    
    const serviceBindConfigs: ServiceBindConfig<any>[] = [
      {
        name: this.cfg.get('serviceNames:invoicing'),
        service: InvoiceServiceDefinition,
        implementation: new InvoiceService(
          this.topics.get('invoicing.resource'),
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