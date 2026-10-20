import { it, describe, beforeAll, afterAll, afterEach, expect, vi } from 'vitest';
import { InvoiceService as ElectronicInvoiceService } from '@e-invoice-eu/core';
import { create } from 'xmlbuilder2';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractInvoiceXml } from '../src/e-invoice.js';
import { apiExportRecords, createApiExportInvoice, createApiConsistencyInvoice } from './fixtures/api-export.js';
import { expectPdfInvoiceMatchesXml, visiblePdfPages, xmlElement } from './helpers/invoice-content.js';
import { ObjectServiceDefinition } from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/ostorage.js';
import type { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/auth.js';
import type { TaxListResponse } from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/tax.js';
import { rules } from './mocks.js';
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
  InvoiceServiceClient,
  InvoiceExportFormat,
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
afterEach(() => vi.restoreAllMocks());

async function readStoredDocument(url: string, subject?: Subject): Promise<Buffer> {
  const storage = createClient(cfg.get('client:ostorage'), ObjectServiceDefinition,
    createChannel(cfg.get('client:ostorage:address')));
  const [bucket, ...key] = url.match(/[^/]+/g)!;
  const chunks: Buffer[] = [];
  for await (const chunk of storage.get({ bucket, key: key.join('/'), download: true,
    subject: cfg.get('authorization:techUser') ?? subject })) {
    expect(chunk.response?.status?.code).toBe(200);
    chunks.push(Buffer.from(chunk.response.payload.object));
  }
  return Buffer.concat(chunks);
}

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

  for (const format of [InvoiceExportFormat.ZUGFERD_XML, InvoiceExportFormat.ZUGFERD_PDF, InvoiceExportFormat.ZUGFERD_BOTH]) {
    it('ZUGFeRD export through gRPC: ' + format, async () => {
      const subject = samples.invoices.valid['as superadmin'].subject;
      const invoice = createApiExportInvoice('api-export-' + format.toLowerCase());
      const generate = vi.spyOn(ElectronicInvoiceService.prototype, 'generate');
      const response = await client.render({ items: [invoice], exportFormat: format, subject });
      expect(response.operationStatus?.code).toBe(200);
      expect(response.items?.[0].status?.code).toBe(200);
      expect(response.items[0].payload.dueDate).toEqual(invoice.dueDate);
      expect(generate).toHaveBeenCalledTimes(1);
      const rendered = response.items[0].payload;
      const documents = rendered.documents;
      expect(documents).toHaveLength(format === InvoiceExportFormat.ZUGFERD_BOTH ? 2 : 1);
      const storage = createClient(cfg.get('client:ostorage'), ObjectServiceDefinition,
        createChannel(cfg.get('client:ostorage:address')));
      const data = new Map<string, Buffer>();
      const output = join(process.cwd(), 'output', 'e-invoice', 'api');
      await mkdir(output, { recursive: true });
      const sourcePdf = generate.mock.calls[0][1]?.pdf?.buffer;
      if (sourcePdf) await writeFile(join(output, format.toLowerCase() + '.source.pdf'), sourcePdf);
      for (const doc of documents) {
        const [bucket, ...key] = doc.url.match(/[^/]+/g);
        const chunks: Buffer[] = [];
        for await (const chunk of storage.get({ bucket, key: key.join('/'), download: true,
          subject: cfg.get('authorization:techUser') ?? subject })) {
          expect(chunk.response?.status?.code).toBe(200);
          chunks.push(Buffer.from(chunk.response.payload.object));
        }
        const bytes = Buffer.concat(chunks);
        expect(doc.bytes).toBe(bytes.byteLength);
        data.set(doc.contentType, bytes);
        const extension = doc.contentType === 'application/pdf' ? 'pdf' : 'xml';
        expect(doc.filename).toBe(rendered.invoiceNumber + '.' + extension);
        await writeFile(join(output, format.toLowerCase() + '.' + extension), bytes);
      }
      const pdf = data.get('application/pdf');
      if (pdf) {
        const embedded = Buffer.from(await extractInvoiceXml(pdf));
        await expectPdfInvoiceMatchesXml(pdf, embedded, { shopName: apiExportRecords.shops?.get(invoice.shopId!)?.name });
        expect(embedded.toString('utf8')).toContain(rendered.invoiceNumber);
        await writeFile(join(output, format.toLowerCase() + '.embedded.xml'), embedded);
        if (format === InvoiceExportFormat.ZUGFERD_BOTH) expect(data.get('application/xml')).toEqual(embedded);
      } else expect(data.get('application/xml').toString('utf8')).toContain(rendered.invoiceNumber);
      // Verify persistence directly: the legacy access-control mocks do not support Read.
      const saved = (await worker.db.find('invoices')).find(item => item.id === invoice.id);
      expect(saved?.documents?.map((d: { url?: string }) => d.url)).toEqual(documents.map(d => d.url));
    }, 30000);
  }

  for (const format of [InvoiceExportFormat.ZUGFERD_PDF, InvoiceExportFormat.ZUGFERD_BOTH]) {
    it('ZUGFeRD export compares visible PDF values with XML and detects mismatches: ' + format, async () => {
      const subject = samples.invoices.valid['as superadmin'].subject;
      const invoice = createApiConsistencyInvoice('api-consistency-' + format.toLowerCase());
      const response = await client.render({ items: [invoice], exportFormat: format, subject });
      expect(response.operationStatus?.code).toBe(200);
      expect(response.items?.[0].status?.code).toBe(200);
      const storage = createClient(cfg.get('client:ostorage'), ObjectServiceDefinition,
        createChannel(cfg.get('client:ostorage:address')));
      const data = new Map<string, Buffer>();
      const output = join(process.cwd(), 'output', 'e-invoice', 'api');
      await mkdir(output, { recursive: true });
      for (const doc of response.items[0].payload.documents) {
        const [bucket, ...key] = doc.url.match(/[^/]+/g);
        const chunks: Buffer[] = [];
        for await (const chunk of storage.get({ bucket, key: key.join('/'), download: true,
          subject: cfg.get('authorization:techUser') ?? subject })) {
          expect(chunk.response?.status?.code).toBe(200);
          chunks.push(Buffer.from(chunk.response.payload.object));
        }
        const bytes = Buffer.concat(chunks);
        data.set(doc.contentType, bytes);
        await writeFile(join(output, 'consistency-' + format.toLowerCase() +
          (doc.contentType === 'application/pdf' ? '.pdf' : '.xml')), bytes);
      }
      const pdf = data.get('application/pdf');
      const embedded = await extractInvoiceXml(pdf);
      const xml = data.get('application/xml') ?? embedded;
      if (format === InvoiceExportFormat.ZUGFERD_BOTH) expect(Buffer.from(embedded)).toEqual(xml);
      const expected = { shopName: apiExportRecords.shops?.get(invoice.shopId!)?.name };
      await expectPdfInvoiceMatchesXml(pdf, xml, expected);

      // Deliberately change one XML value while retaining the real stored PDF.
      // These checks prove that equality cannot pass just because XML is attached.
      const settlement = ['SupplyChainTradeTransaction', 'ApplicableHeaderTradeSettlement'];
      const totals = [...settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation'];
      const line = ['SupplyChainTradeTransaction', 'IncludedSupplyChainTradeLineItem'];
      const agreement = ['SupplyChainTradeTransaction', 'ApplicableHeaderTradeAgreement'];
      const mismatches = [
        { path: ['ExchangedDocument', 'ID'], value: 'DIFFERENT-NUMBER', field: 'invoice number' },
        { path: ['ExchangedDocument', 'IssueDateTime', 'DateTimeString'], value: '20261231', field: 'issue date' },
        { path: [...agreement, 'BuyerTradeParty', 'Name'], value: 'Different Buyer GmbH', field: 'buyer name' },
        { path: [...agreement, 'SellerTradeParty', 'Name'], value: 'Different Supplier GmbH', field: 'seller name' },
        { path: [...agreement, 'SellerTradeParty', 'SpecifiedTaxRegistration', 'ID'], value: 'DE111111111', field: 'seller VAT ID' },
        { path: [...settlement, 'SpecifiedTradePaymentTerms', 'Description'], value: 'Pay immediately', field: 'payment instructions' },
        { path: [...line, 'SpecifiedTradeProduct', 'Name'], value: 'Different product', field: 'line items' },
        { path: [...line, 'SpecifiedLineTradeDelivery', 'BilledQuantity'], value: '99', field: 'line items' },
        { path: [...line, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount'], value: '999.99', field: 'line items' },
        { path: [...line, 'SpecifiedLineTradeSettlement', 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'], value: '999.99', field: 'line items' },
        { path: [...totals, 'TaxBasisTotalAmount'], value: '999.99', field: 'net total' },
        { path: [...settlement, 'ApplicableTradeTax', 'CalculatedAmount'], value: '999.99', field: 'VAT breakdown' },
        { path: [...settlement, 'ApplicableTradeTax', 'RateApplicablePercent'], value: '8', field: 'VAT breakdown' },
        { path: [...totals, 'TaxTotalAmount'], value: '999.99', field: 'VAT total' },
        { path: [...totals, 'GrandTotalAmount'], value: '999.99', field: 'gross total' },
      ];
      for (const mismatch of mismatches) {
        const altered = create(new TextDecoder().decode(xml)).root();
        xmlElement(altered, ...mismatch.path).node.textContent = mismatch.value;
        await expect(expectPdfInvoiceMatchesXml(pdf, altered.end(), expected), mismatch.path.join('/'))
          .rejects.toThrow('PDF/XML ' + mismatch.field);
      }
    }, 30000);
  }

  it('ZUGFeRD export prints zero VAT with its actual rate', async () => {
    const subject = samples.invoices.valid['as superadmin'].subject;
    const invoice = createApiExportInvoice('api-export-zero-vat');
    const position = invoice.sections[0].positions[0];
    position.vatCategoryCode = 'Z';
    position.unitPrice = { currencyId: 'EUR', regularPrice: 10.70, sale: false };
    position.amount = { currencyId: 'EUR', net: 10.70, gross: 10.70, vats: [{ taxId: 'vat-0', vat: 0 }] };
    invoice.totalAmounts = [structuredClone(position.amount)];
    const response = await client.render({ items: [invoice], exportFormat: InvoiceExportFormat.ZUGFERD_BOTH, subject });
    expect(response.operationStatus?.code).toBe(200);
    expect(response.items?.[0].status?.code).toBe(200);
    const documents = response.items[0].payload.documents;
    const pdf = await readStoredDocument(documents.find(doc => doc.contentType === 'application/pdf')!.url!, subject);
    const xml = await readStoredDocument(documents.find(doc => doc.contentType === 'application/xml')!.url!, subject);
    expect(Buffer.from(await extractInvoiceXml(pdf))).toEqual(xml);
    await expectPdfInvoiceMatchesXml(pdf, xml, { shopName: apiExportRecords.shops?.get(invoice.shopId!)?.name });
    const output = join(process.cwd(), 'output', 'e-invoice', 'api');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'zero-vat-zugferd_both.pdf'), pdf);
    await writeFile(join(output, 'zero-vat-zugferd_both.xml'), xml);
  }, 30000);

  it('ZUGFeRD export template preserves the legacy PDF label when a tax rate is unavailable', async () => {
    const subject = samples.invoices.valid['as superadmin'].subject;
    const invoice = structuredClone(samples.invoices.valid['as superadmin'].items![0]);
    invoice.id = 'api-export-legacy-missing-rate';
    let tax: { rate?: number } | undefined;
    rules.tax.read(undefined, (_error: unknown, response: TaxListResponse) => {
      tax = response.items?.find(item => item.payload?.id === 'tax_1')?.payload;
    });
    expect(tax).toBeDefined();
    const rate = tax!.rate;
    delete tax!.rate;
    try {
      const response = await client.render({ items: [invoice], subject });
      expect(response.operationStatus?.code).toBe(200);
      expect(response.items?.[0].status?.code).toBe(200);
      const document = response.items[0].payload.documents[0];
      const pdf = await readStoredDocument(document.url!, subject);
      const text = (await visiblePdfPages(pdf)).join('\n');
      expect(text).toMatch(/^\+ tax_1\s*:\s+€1\.71$/m);
      expect(text).not.toContain('NaN');
    } finally {
      tax!.rate = rate;
    }
  }, 30000);

  it('ZUGFeRD export returns validation errors over gRPC', async () => {
    const subject = samples.invoices.valid['as superadmin'].subject;
    const invoice = createApiExportInvoice('api-export-invalid');
    delete invoice.timestamp;
    delete invoice.sections[0].positions[0].quantityUnitCode;
    const response = await client.render({ items: [invoice], exportFormat: InvoiceExportFormat.ZUGFERD_BOTH, subject });
    expect(response.operationStatus?.code).toBe(207);
    expect(response.items?.[0].status?.code).toBe(400);
    expect(response.items[0].status.message).toContain('timestamp');
    expect(response.items[0].status.message).toContain('quantity_unit_code');
    expect(response.items[0].payload.documents ?? []).toHaveLength(0);
  }, 30000);

  it('ZUGFeRD export resolves VAT records for a manual line without a catalog product', async () => {
    const subject = samples.invoices.valid['as superadmin'].subject;
    const invoice = createApiExportInvoice('api-export-manual');
    const position = invoice.sections[0].positions[0];
    delete position.productItem;
    position.manualItem = { name: 'Manual consulting service' };
    const response = await client.render({ items: [invoice], exportFormat: InvoiceExportFormat.ZUGFERD_XML, subject });
    expect(response.operationStatus?.code).toBe(200);
    expect(response.items?.[0].status?.code).toBe(200);
    expect(response.items[0].payload.documents[0].contentType).toBe('application/xml');
  }, 30000);
});
