import { describe, expect, it } from 'vitest';
import {
  InvoiceExportFormat,
  InvoiceList as ClientInvoiceList,
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/invoice.js';
import {
  InvoiceList as ServerInvoiceList,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';

describe('Invoice Render request compatibility', () => {
  it('preserves the existing request bytes when export selection is omitted', () => {
    const request = ClientInvoiceList.fromPartial({
      items: [{ id: 'legacy' }],
      totalCount: 1,
    });
    const bytes = ClientInvoiceList.encode(request).finish();

    // Captured from the published 5.2.3 client before adding export_format.
    expect(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')).toBe('0a080a066c65676163791001');
    expect(ServerInvoiceList.decode(bytes)).toEqual({
      items: [{ id: 'legacy' }],
      total_count: 1,
    });
    expect(ClientInvoiceList.toJSON(request)).toEqual({
      items: [{ id: 'legacy' }],
      totalCount: 1,
    });
  });

  it.each([
    InvoiceExportFormat.PDF,
    InvoiceExportFormat.ZUGFERD_XML,
    InvoiceExportFormat.ZUGFERD_PDF,
    InvoiceExportFormat.ZUGFERD_BOTH,
  ])('transmits %s between the client and server request types', (exportFormat) => {
    const request = ClientInvoiceList.fromPartial({
      items: [{ id: 'invoice-1' }],
      exportFormat,
    });
    const serverRequest = ServerInvoiceList.decode(ClientInvoiceList.encode(request).finish());

    expect(serverRequest.export_format).toBe(exportFormat);
    expect(serverRequest.items?.[0]?.id).toBe('invoice-1');
    expect(ClientInvoiceList.decode(ServerInvoiceList.encode(serverRequest).finish())).toEqual(request);
  });

  it('transmits the optional e-invoice details without changing their values', () => {
    const request = ClientInvoiceList.fromPartial({ items: [{
      timestamp: new Date('2026-10-07T00:00:00Z'),
      dueDate: new Date('2026-10-21T00:00:00Z'),
      sellerVatId: 'DE123456789', sellerTaxRegistrationId: '123/456/78901',
      sections: [{ positions: [{ quantityUnitCode: 'C62', vatCategoryCode: 'E',
        vatExemptionReason: 'Exempt supply', vatExemptionReasonCode: 'VATEX-EU-132', netUnitPrice: 8.99,
      }] }],
    }] });
    const server = ServerInvoiceList.decode(ClientInvoiceList.encode(request).finish());
    expect(server.items[0].due_date).toEqual(request.items[0].dueDate);
    expect(server.items[0].seller_vat_id).toBe('DE123456789');
    expect(server.items[0].sections[0].positions[0].quantity_unit_code).toBe('C62');
    expect(ClientInvoiceList.decode(ServerInvoiceList.encode(server).finish())).toEqual(request);
  });
});
