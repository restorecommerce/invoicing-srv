import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';
import { InvoiceService as ElectronicInvoiceService } from '@e-invoice-eu/core';
import { InvoiceExportFormat, type Invoice, type InvoiceList } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import { extractInvoiceXml } from '../src/e-invoice.js';
import { createEInvoiceFixture } from './fixtures/e-invoice.js';
import { DefaultSetting } from '../src/utils.js';

// Exercise Render's real orchestration with in-memory dependencies. The integration
// suite separately exercises the actual access-control decorator and gRPC transport.
vi.mock('@restorecommerce/acs-client', async (importOriginal) => ({
  ...await importOriginal<object>(),
  access_controlled_function: () => (_target: unknown, _context: unknown, descriptor: unknown) => descriptor,
}));
import { InvoiceService, InvoiceStatusCodes, InvoiceOperationStatusCodes } from '../src/services/invoice_srv.js';

let sourcePdf: Uint8Array;
beforeAll(async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  sourcePdf = await pdf.save();
});
afterEach(() => vi.restoreAllMocks());

function harness() {
  const fixture = createEInvoiceFixture();
  const stored: { key: string; bucket: string; object: Uint8Array; options: { content_type: string } }[] = [];
  const put = vi.fn(async (stream) => {
    let object;
    for await (const chunk of stream) { stored.push(chunk); object = chunk; }
    return { operation_status: { code: 200 }, response: {
      status: { code: 200 }, payload: { key: object.key, url: '//' + object.bucket + '/' + object.key },
    } };
  });
  const renderPdf = vi.fn(async () => ({ operation_status: { code: 200 }, combined: {
    status: { code: 200 }, payload: { pdf: { data: Buffer.from(sourcePdf) } },
  } }));
  const update = vi.fn(async (request: InvoiceList) => ({ operation_status: { code: 200 },
    items: request.items.map(payload => ({ payload, status: { code: 200 } })),
  }));
  const templates = vi.fn(async () => []);
  const renderHtml = vi.fn(async () => {});
  const emit = vi.fn();
  const service = Object.assign(Object.create(InvoiceService.prototype), {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    status_codes: InvoiceStatusCodes,
    operation_status_codes: InvoiceOperationStatusCodes,
    aggregate: vi.fn(async request => ({ ...fixture.records, items: request.items, settings: new Map() })),
    generateInvoiceNumbers: vi.fn(async (aggregation: { items: Invoice[] }) => {
      aggregation.items.forEach((invoice, i) => { invoice.invoice_number = 'TEST-API-' + String(i + 1); });
      return aggregation;
    }),
    loadDefaultTemplates: templates,
    emitRenderRequest: renderHtml,
    awaits_render_result: { await: vi.fn(async () => [{ id: 'INVOICE_PDF', body: '<p>Invoice</p>' }]) },
    resolveSettings: vi.fn(() => ({ ...DefaultSetting, shop_pdf_bucket: 'invoices', shop_html_bucket_disabled: true })),
    pdf_rendering_service: { render: renderPdf },
    ostorage_service: { put },
    superUpsert: update,
    events: { emit },
    emitters: { RENDERED: 'invoiceRendered' },
  }) as InvoiceService;
  return { ...fixture, service, stored, put, renderPdf, update, templates, renderHtml, emit };
}

describe('Invoice Render export selection', () => {
  it.each([undefined, InvoiceExportFormat.PDF])('keeps ordinary PDF behavior for %s without e-invoice data', async (format) => {
    const h = harness();
    delete h.invoice.timestamp;
    delete h.invoice.sections[0].positions[0].quantity_unit_code;
    delete h.records.organizations.get('seller-1').vat_id;
    const generate = vi.spyOn(ElectronicInvoiceService.prototype, 'generate');
    const response = await h.service.render({ items: [h.invoice], export_format: format });
    expect(response.operation_status.code).toBe(200);
    expect(h.stored).toHaveLength(1);
    expect(Array.from(h.stored[0].object)).toEqual(Array.from(sourcePdf));
    expect(response.items[0].payload.documents[0].content_type).toBe('application/pdf');
    expect(generate).not.toHaveBeenCalled();
  });

  it('stores XML only without loading templates or rendering a PDF', async () => {
    const h = harness();
    const generate = vi.spyOn(ElectronicInvoiceService.prototype, 'generate');
    const response = await h.service.render({ items: [h.invoice], export_format: InvoiceExportFormat.ZUGFERD_XML });
    expect(response.operation_status.code).toBe(200);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0].options.content_type).toBe('application/xml');
    expect(new TextDecoder().decode(h.stored[0].object)).toContain('TEST-API-1');
    expect(response.items[0].payload.documents[0].filename).toBe('TEST-API-1.xml');
    expect(h.templates).not.toHaveBeenCalled();
    expect(h.renderHtml).not.toHaveBeenCalled();
    expect(h.renderPdf).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.emit).toHaveBeenCalledWith('invoiceRendered', response.items[0].payload);
  });

  it('stores one hybrid PDF with invoice XML embedded', async () => {
    const h = harness();
    const generate = vi.spyOn(ElectronicInvoiceService.prototype, 'generate');
    const response = await h.service.render({ items: [h.invoice], export_format: InvoiceExportFormat.ZUGFERD_PDF });
    expect(response.operation_status.code).toBe(200);
    expect(h.stored).toHaveLength(1);
    expect(h.stored[0].options.content_type).toBe('application/pdf');
    expect(new TextDecoder().decode(await extractInvoiceXml(h.stored[0].object))).toContain('TEST-API-1');
    expect(response.items[0].payload.documents[0].filename).toBe('TEST-API-1.pdf');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('generates once and stores exactly the embedded XML when both outputs are requested', async () => {
    const h = harness();
    h.invoice.documents = [{ id: 'previous', filename: 'previous.pdf' }];
    const generate = vi.spyOn(ElectronicInvoiceService.prototype, 'generate');
    const response = await h.service.render({ items: [h.invoice], export_format: InvoiceExportFormat.ZUGFERD_BOTH });
    expect(response.operation_status.code).toBe(200);
    expect(h.stored).toHaveLength(2);
    const [pdf, xml] = h.stored;
    expect(pdf.options.content_type).toBe('application/pdf');
    expect(xml.options.content_type).toBe('application/xml');
    expect(Array.from(xml.object)).toEqual(Array.from(await extractInvoiceXml(pdf.object)));
    expect(pdf.key.split('/').slice(0, -1)).toEqual(xml.key.split('/').slice(0, -1));
    const documents = response.items[0].payload.documents;
    expect(documents).toHaveLength(3);
    expect(documents[0].id).toBe('previous');
    expect(new Set(documents.map(d => d.id)).size).toBe(3);
    expect(documents.slice(1).map(d => d.bytes)).toEqual(h.stored.map(s => s.object.byteLength));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(h.renderPdf).toHaveBeenCalledTimes(1);
  });

  it.each([InvoiceExportFormat.ZUGFERD_XML, InvoiceExportFormat.ZUGFERD_PDF, InvoiceExportFormat.ZUGFERD_BOTH])(
    'returns missing-field errors for %s before rendering or storage', async format => {
      const h = harness();
      delete h.invoice.timestamp;
      delete h.invoice.sections[0].positions[0].quantity_unit_code;
      const response = await h.service.render({ items: [h.invoice], export_format: format });
      expect(response.operation_status.code).toBe(207);
      expect(response.items[0].status.code).toBe(400);
      expect(response.items[0].status.message).toContain('timestamp');
      expect(response.items[0].status.message).toContain('quantity_unit_code');
      expect(h.renderPdf).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
      expect(h.emit).not.toHaveBeenCalled();
    },
  );

  it('returns library code-list validation failures as caller errors', async () => {
    const h = harness();
    h.invoice.sections[0].positions[0].quantity_unit_code = 'INVALID';
    const response = await h.service.render({ items: [h.invoice], export_format: InvoiceExportFormat.ZUGFERD_XML });
    expect(response.items[0].status.code).toBe(400);
    expect(response.items[0].status.message).toContain('unitCode');
    expect(h.put).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  it('preserves successful items in a batch with an invalid invoice', async () => {
    const h = harness();
    const invalid = structuredClone(h.invoice);
    invalid.id = 'invalid';
    delete invalid.timestamp;
    const response = await h.service.render({ items: [h.invoice, invalid], export_format: InvoiceExportFormat.ZUGFERD_XML });
    expect(response.operation_status.code).toBe(207);
    expect(response.items.map(item => item.status.code)).toEqual([200, 400]);
    expect(h.update.mock.calls[0][0].items.map((invoice: Invoice) => invoice.id)).toEqual([h.invoice.id]);
    expect(h.emit).toHaveBeenCalledTimes(1);
  });

  it('does not persist or announce a partially stored export as successful', async () => {
    const h = harness();
    h.put.mockImplementationOnce(async () => ({ operation_status: { code: 200 }, response: { status: { code: 200 }, payload: { key: 'first', url: '//first' } } }));
    h.put.mockImplementationOnce(async () => ({ operation_status: { code: 503, message: 'Storage unavailable' } }) as any);
    const response = await h.service.render({ items: [h.invoice], export_format: InvoiceExportFormat.ZUGFERD_BOTH });
    expect(response.items[0].status.code).toBe(503);
    expect(response.items[0].payload.documents ?? []).toHaveLength(0);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it('rejects unknown export selections', async () => {
    const h = harness();
    const response = await h.service.render({ items: [h.invoice], export_format: InvoiceExportFormat.UNRECOGNIZED });
    expect(response.operation_status.code).toBe(400);
    expect(h.put).not.toHaveBeenCalled();
  });
});
