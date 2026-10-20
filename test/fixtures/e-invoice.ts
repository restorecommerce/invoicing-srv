import type { Invoice } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import type { InvoiceExportRecords } from '../../src/e-invoice.js';

const recordsById = <T extends { id?: string }>(items: T[]) => new Map(items.map(item => [item.id, item]));

/** Fictional, complete export data, kept separate from the minimal legacy PDF fixture. */
export function createEInvoiceFixture(): { invoice: Invoice; records: InvoiceExportRecords } {
  return {
    invoice: {
      id: 'export-invoice-1',
      invoice_number: 'TEST-2026-0001',
      timestamp: new Date('2026-10-07T00:00:00Z'),
      due_date: new Date('2026-10-21T00:00:00Z'),
      shop_id: 'shop-1',
      customer_id: 'customer-1',
      sender: { address: {
        business_address: { name: 'Test Supplier GmbH' },
        street: 'Musterstrasse', building_number: '1', locality: 'Berlin', postcode: '10115', country_id: 'germany',
      } },
      billing_address: { address: {
        business_address: { name: 'Test Buyer GmbH' },
        street: 'Beispielweg', building_number: '7', locality: 'Muenchen', postcode: '80331', country_id: 'germany',
      } },
      recipient: { address: {
        business_address: { name: 'Test Shipping Recipient' },
        street: 'Lieferweg', building_number: '9', locality: 'Hamburg', postcode: '20095', country_id: 'germany',
      } },
      sections: [{ id: '001', positions: [{
        id: '001', product_item: { product_id: 'product-1', variant_id: 'blue' },
        quantity: 1, quantity_unit_code: 'C62',
        unit_price: { currency_id: 'EUR', regular_price: 11.89, sale: true, sale_price: 10.70 },
        amount: { currency_id: 'EUR', net: 8.99, gross: 10.70, vats: [{ tax_id: 'vat-19', vat: 1.71 }] },
      }] }],
      total_amounts: [{ currency_id: 'EUR', net: 8.99, gross: 10.70, vats: [{ tax_id: 'vat-19', vat: 1.71 }] }],
    },
    records: {
      shops: recordsById([{ id: 'shop-1', name: 'Test Supplier Shop', organization_id: 'seller-1' }]),
      customers: recordsById([{ id: 'customer-1', commercial: { organization_id: 'buyer-1' } }]),
      organizations: recordsById([
        { id: 'seller-1', name: 'Test Supplier GmbH', vat_id: 'DE123456789' },
        { id: 'buyer-1', name: 'Test Buyer GmbH', vat_id: 'DE987654321' },
      ]),
      countries: recordsById([{ id: 'germany', country_code_alpha_2: 'DE' }]),
      currencies: recordsById([{ id: 'EUR', code: 'EUR', precision: 2 }]),
      taxes: recordsById([{ id: 'vat-19', rate: 0.19 }, { id: 'vat-7', rate: 0.07 }, { id: 'vat-0', rate: 0 }]),
      products: recordsById([{ id: 'product-1', product: {
        name: 'Test Product', physical: { variants: [{ id: 'blue', name: 'Test Product Blue', description: 'Fictional product for export tests' }] },
      } }]),
      fulfillment_products: recordsById([{ id: 'shipping-1', name: 'Test Shipping', variants: [{ id: 'standard', name: 'Standard Shipping' }] }]),
    },
  };
}
