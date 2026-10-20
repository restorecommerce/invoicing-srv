import { Invoice as ClientInvoice } from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/invoice.js';
import { Invoice as ServerInvoice } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import { createEInvoiceFixture } from './e-invoice.js';

// These IDs differ from the legacy mocks. Existing country/currency records cover DE/EUR.
export const apiExportRecords = createEInvoiceFixture().records;

export function createApiExportInvoice(id: string): ClientInvoice {
  const { invoice } = createEInvoiceFixture();
  invoice.id = id;
  invoice.recipient = structuredClone(invoice.billing_address);
  invoice.payment_hints = ['Bank transfer within 14 days'];
  return ClientInvoice.fromJSON(ServerInvoice.toJSON(invoice));
}

/** Different quantities/prices and VAT rates expose swapped lines and net/gross errors. */
export function createApiConsistencyInvoice(id: string): ClientInvoice {
  const invoice = createApiExportInvoice(id);
  invoice.sections[0].positions.push({
    id: '002', manualItem: { name: 'Consulting & Support' }, quantity: 2, quantityUnitCode: 'HUR',
    unitPrice: { currencyId: 'EUR', regularPrice: 10.70, sale: false },
    amount: { currencyId: 'EUR', net: 20, gross: 21.40, vats: [{ taxId: 'vat-7', vat: 1.40 }] },
  }, {
    id: '003', fulfillmentItem: { productId: 'shipping-1', variantId: 'standard' }, quantity: 1, quantityUnitCode: 'C62',
    unitPrice: { currencyId: 'EUR', regularPrice: 5.95, sale: false },
    amount: { currencyId: 'EUR', net: 5, gross: 5.95, vats: [{ taxId: 'vat-19', vat: 0.95 }] },
  });
  invoice.totalAmounts = [{ currencyId: 'EUR', net: 33.99, gross: 38.05,
    vats: [{ taxId: 'vat-19', vat: 2.66 }, { taxId: 'vat-7', vat: 1.40 }] }];
  invoice.sections[0].amounts = structuredClone(invoice.totalAmounts);
  return invoice;
}
