import { it, describe, beforeAll, afterAll } from 'vitest';
import should from 'should';
import {
  Semaphore
} from 'async-mutex';
import {
  createClient,
  createChannel,
  GrpcClientConfig
} from '@restorecommerce/grpc-client';
import {
  Events,
  Topic
} from '@restorecommerce/kafka-client';
import {
  Invoice as Invoice_,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import {
  InvoiceServiceDefinition,
  InvoiceServiceClient
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/invoice.js';
import { GrpcMockServer } from '@alenon/grpc-mock-server';
import { Worker } from '../src/worker.js';
import {
  cfg,
  logger,
  samples,
  startWorker,
  connectEvents,
  connectTopics,
  mockServices,
} from './utils.js';

let mocking: GrpcMockServer[];
let worker: Worker;
let events: Events;
let topics: Topic;
let client: InvoiceServiceClient;
const invoiceCreatedSemaphore = new Semaphore(0);
const invoiceRenderedSemaphore = new Semaphore(0);

const onInvoiceCreated = (msg: Invoice_, context?:any): void => {
  should.exist(msg);
  invoiceCreatedSemaphore.release(1);
};

const onInvoiceRendered = (msg: Invoice_, context?:any): void => {
  should(msg?.documents?.length).greaterThan(0);
  invoiceRenderedSemaphore.release(1);
};

beforeAll(
  async function() {
    mocking = await mockServices(cfg.get('client'));
    worker = await startWorker();
    events = await connectEvents();
    topics = await connectTopics(events, 'invoicing.resource');
    client = createClient(
      {
        ...cfg.get('client:invoice'),
        logger
      } as GrpcClientConfig,
      InvoiceServiceDefinition,
      createChannel(cfg.get('client:invoice:address'))
    );

    await Promise.all([
      topics?.on('invoiceCreated', onInvoiceCreated),
      topics?.on('invoiceRendered', onInvoiceRendered),
    ]);
  },
  30000
);

afterAll(
  async function() {
    await Promise.allSettled([
      client?.delete({
        collection: true,
        subject: {
          id: 'superadmin',
          token: 'superadmin',
        }
      }),
      topics?.removeListener('orderCreated', onInvoiceCreated),
      topics?.removeListener('orderSubmitted', onInvoiceRendered),
    ]).finally(
      () => Promise.allSettled([
        events?.stop(),
        worker?.stop(),
      ])
    ).finally(
      () => mocking?.forEach(mock => mock?.stop())
    );
  },
  30000
);

describe('The Invoicing Service:', function() {
  it('should start up "beforeAll"', function() {
    should.exist(worker);
    should.exist(events);
    should.exist(topics);
    should.exist(client);
    logger.debug('Wait few seconds for system warm up...');
  });

  for (let [sample_name, sample] of Object.entries(samples.invoices.valid)) {
    it(
      `should create invoices using valid samples: ${sample_name}`,
      async function() {
        const response = await client.create(sample);
        logger.debug(response);
        should(
          response.operationStatus?.code
        ).equal(200);
        should(
          response.items!.every(item => item.status?.code === 200)
        ).True();
      },
      30000
    );

    it(
      'should have received an invoice create event',
      async function() {
        await invoiceCreatedSemaphore.acquire(1);
      },
      5000
    );
  }

  for (let [sample_name, sample] of Object.entries(samples.invoices.valid)) {
    it(
      `should render invoices using valid samples: ${sample_name}`,
      async function() {
        const response = await client.render(sample);
        should(
          response.operationStatus?.code
        ).equal(200);
        should(
          response.items!.every(item => item.status?.code === 200)
        ).True();
        should(
          response.items!.every(
            item => item.payload!.invoiceNumber!.startsWith('test-')
          )
        ).True();
      },
      30000
    );

    it(
      'should have received an invoice render event',
      async function() {
        await invoiceRenderedSemaphore.acquire(1);
      },
      5000
    );
  }

  for (let [sample_name, sample] of Object.entries(samples.invoices.valid)) {
    it(
      `should send invoices using valid samples: ${sample_name}`,
      async function() {
        const response = await client.send({
          items: sample.items?.map(
            item => ({
              id: item.id,
              subject: sample.subject,
            })
          ),
          totalCount: sample.items?.length,
          subject: sample.subject,
        });
        logger.debug(response);
        should(
          response.operationStatus?.code
        ).equal(200);
        should(
          response.status!.every(item => item?.code === 200)
        ).True();
      },
      30000
    );
  }

  for (let [sample_name, sample] of Object.entries(samples.invoices.valid)) {
    it(
      `should withdraw invoices using valid samples: ${sample_name}`,
      async function() {
        const response = await client.withdraw({
          items: sample.items?.map(
            item => ({
              id: item.id,
              subject: sample.subject,
            })
          ),
          totalCount: sample.items?.length,
          subject: sample.subject,
        });
        logger.debug(response);
        should(
          response.operationStatus?.code
        ).equal(200);
        should(
          response.items!.every(item => item.status?.code === 200)
        ).True();
      },
      30000
    );
  }

  for (let [sample_name, sample] of Object.entries(samples.invoices.valid)) {
    it(
      `should delete invoices using valid samples: ${sample_name}`,
      async function() {
        const response = await client.delete({
          ids: sample.items?.map(item => item.id!),
          subject: sample.subject,
        });
        logger.debug(response);
        should(
          response.operationStatus?.code
        ).equal(200);
        should(
          response.status!.every(item => item?.code === 200)
        ).True();
      },
      30000
    );
  }
});