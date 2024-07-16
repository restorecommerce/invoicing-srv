import {
  ResourcesAPIBase,
  ServiceBase
} from '@restorecommerce/resource-base-interface';
import { type ServiceConfig } from '../experimental/WorkerBase.js';
import { type Logger } from '@restorecommerce/logger';
import { type DatabaseProvider } from '@restorecommerce/chassis-srv';
import { Topic } from '@restorecommerce/kafka-client';
import { OperationStatus, Status } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import { Meta } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/meta.js';

export interface InvoiceNumber {
  id?: string;
  meta?: Meta;
  shop_id?: string;
  counter?: number; 
  invoice_number?: string;
};

export interface InvoiceNumberResponse {
  payload?: InvoiceNumber;
  status?: Status;
};

export interface InvoiceNumberList {
  items?: InvoiceNumber[];
  total_count?: number;
  subject?: Subject;
};

export interface InvoiceNumberListResponse {
  items?: InvoiceNumberResponse[];
  total_count?: number;
  operation_status?: OperationStatus;
};


export class InvoiceNumberService
  extends ServiceBase<InvoiceNumberListResponse, InvoiceNumberList>
{
  constructor(
    protected readonly topic: Topic,
    protected readonly db: DatabaseProvider,
    protected readonly cfg: ServiceConfig,
    readonly logger: Logger,
  ) {
    super(
      cfg.get('database:main:entities:1') ?? 'invoice_number',
      topic,
      logger,
      new ResourcesAPIBase(
        db,
        cfg.get('database:main:collections:1') ?? 'invoice_numbers',
        cfg.get('fieldHandlers'),
      ),
      !!cfg.get('events:enableEvents'),
    );
  }
}