import {
  InvoiceServiceDefinition,
  protoMetadata as InvoiceProtoMetadata,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import { ServiceBindConfig, WorkerBase } from './experimental/WorkerBase.js';
import { InvoiceService } from './service.js'; 

export class Worker extends WorkerBase {
  protected async initServices(): Promise<ServiceBindConfig<any>[]> {
    const serviceBindConfigs: ServiceBindConfig<any>[] = [
      {
        name: this.cfg.get('serviceNames:invoicing'),
        service: InvoiceServiceDefinition,
        implementation: new InvoiceService(
          this.topics.get('invoicing.resource'),
          this.db,
          this.cfg,
          this.logger,
        ),
        meta: InvoiceProtoMetadata,
      } as ServiceBindConfig<InvoiceServiceDefinition>
    ];
    return serviceBindConfigs;
  }
}