import {
  ResourcesAPIBase,
  ServiceBase
} from '@restorecommerce/resource-base-interface';
import { type ServiceConfig } from '@restorecommerce/service-config';
import { type Logger } from '@restorecommerce/logger';
import { type DatabaseProvider } from '@restorecommerce/chassis-srv';
import { Topic } from '@restorecommerce/kafka-client';
import {
  OperationStatus,
  Status
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import { Meta } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/meta.js';
import {
  access_controlled_service,
} from '@restorecommerce/acs-client';
import {
  resolves_subject,
  injects_meta_data,
} from '../experimental/decorators.js';
import { CallContext } from '@restorecommerce/grpc-client';
import { ReadRequest } from '@restorecommerce/rc-grpc-clients';
import { Filter_Operation, Filter_ValueType } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/filter.js';
import { AccessControlledServiceBaseOperationStatusCodes } from '@restorecommerce/resource-base-interface/lib/experimental/AccessControlledServiceBase.js';

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


@access_controlled_service
export class InvoiceNumberService
  extends ServiceBase<InvoiceNumberListResponse, InvoiceNumberList>
{
  override get operationStatusCodes(): AccessControlledServiceBaseOperationStatusCodes {
    return super.operationStatusCodes;
  }

  constructor(
    protected readonly topic: Topic,
    protected readonly db: DatabaseProvider,
    protected readonly cfg: ServiceConfig,
    readonly logger: Logger,
  ) {
    super(
      cfg.get('database:main:entities:1') ?? 'invoice_number',
      undefined, // topic,
      logger,
      new ResourcesAPIBase(
        db,
        cfg.get('database:main:collections:1') ?? 'invoice_numbers',
        cfg.get('fieldHandlers'),
        undefined,
        undefined,
        logger,
      ),
      false,
    );
    super.operationStatusCodes = {
      ...AccessControlledServiceBaseOperationStatusCodes,
      ...cfg?.get('operationStatusCodes'),
    };
  }

  public async get(
    ids: string[],
    subject?: Subject,
    context?: CallContext,
    bypassACS = false,
  ): Promise<InvoiceNumberListResponse> {
    ids = Array.from(new Set(ids)).filter(id => id);
    if (ids.length > 1000) {
      throw this.operationStatusCodes.LIMIT_EXHAUSTED;
    }

    if (ids.length === 0) {
      const response = {
        total_count: 0,
        operation_status: this.operationStatusCodes.SUCCESS,
      };
      return response as InvoiceNumberListResponse;
    }

    const request = ReadRequest.fromPartial({
      filters: [{
        filters: [{
          field: '_key',
          operation: Filter_Operation.in,
          value: JSON.stringify(ids),
          type: Filter_ValueType.ARRAY
        }]
      }],
      limit: ids.length,
      subject
    });
    return await this.read(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  public override async create(
    request: InvoiceNumberList,
    context: any
  ): Promise<InvoiceNumberListResponse> {
    return super.create(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  public override async update(
    request: InvoiceNumberList,
    context: any
  ): Promise<InvoiceNumberListResponse> {
    return super.update(request, context);
  }

  @resolves_subject()
  @injects_meta_data()
  public override async upsert(
    request: InvoiceNumberList,
    context: any
  ): Promise<InvoiceNumberListResponse> {
    return super.upsert(request, context);
  }
}