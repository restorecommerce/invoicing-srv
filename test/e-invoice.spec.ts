import { describe, expect, it } from 'vitest';
import { create } from 'xmlbuilder2';
import { PaymentState, type Invoice } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import { generateInvoiceXml, InvoiceMappingError, mapInvoiceToEInvoice } from '../src/e-invoice.js';
import { createEInvoiceFixture } from './fixtures/e-invoice.js';

describe('Invoice XML mapping', () => {
  it('uses the billed party, related VAT and currency records, and the gross sale price', () => {
    const { invoice, records } = createEInvoiceFixture();
    const original = structuredClone(invoice);
    const mapped = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice'];
    expect(mapped['cbc:IssueDate']).toBe('2026-10-07');
    expect(mapped['cbc:DueDate']).toBe('2026-10-21');
    expect(mapped['cbc:DocumentCurrencyCode']).toBe('EUR');
    expect(mapped['cac:AccountingCustomerParty']['cac:Party']['cac:PartyLegalEntity']['cbc:RegistrationName']).toBe('Test Buyer GmbH');
    expect(mapped['cac:Delivery']['cac:DeliveryParty']['cac:PartyName']['cbc:Name']).toBe('Test Shipping Recipient');
    expect(mapped['cac:AccountingSupplierParty']['cac:Party']['cac:PartyTaxScheme'][0]['cbc:CompanyID']).toBe('DE123456789');
    expect(mapped['cac:InvoiceLine'][0]['cac:Item']['cbc:Name']).toBe('Test Product');
    expect(mapped['cac:InvoiceLine'][0]['cac:Price']['cbc:PriceAmount']).toBe('8.991596638655');
    expect(mapped['cac:InvoiceLine'][0]['cbc:LineExtensionAmount']).toBe('8.99');
    expect(mapped['cac:TaxTotal'][0]['cac:TaxSubtotal'][0]['cac:TaxCategory']['cbc:Percent']).toBe('19');
    expect(mapped['cac:LegalMonetaryTotal']['cbc:PayableAmount']).toBe('10.70');
    expect(invoice).toEqual(original);
  });

  it('accepts payment hints instead of a due date and an explicit seller tax registration ID', () => {
    const { invoice, records } = createEInvoiceFixture();
    delete invoice.due_date;
    invoice.payment_hints = ['Pay within 14 days'];
    invoice.seller_tax_registration_id = '123/456/78901';
    delete records.organizations.get('seller-1').vat_id;
    const mapped = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice'];
    expect(mapped['cac:PaymentTerms']['cbc:Note']).toBe('Pay within 14 days');
    expect(mapped['cac:AccountingSupplierParty']['cac:Party']['cac:PartyTaxScheme']).toEqual([
      { 'cbc:CompanyID': '123/456/78901', 'cac:TaxScheme': { 'cbc:ID': 'FC' } },
    ]);
  });

  it('maps a paid invoice to zero payable without requiring payment terms', () => {
    const { invoice, records } = createEInvoiceFixture();
    invoice.payment_state = PaymentState.PAYED;
    delete invoice.due_date;
    const totals = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice']['cac:LegalMonetaryTotal'];
    expect(totals['cbc:PrepaidAmount']).toBe('10.70');
    expect(totals['cbc:PayableAmount']).toBe('0.00');
  });

  it('flattens sections with duplicate position IDs and groups mixed VAT rates', () => {
    const { invoice, records } = createEInvoiceFixture();
    invoice.sections.push({ id: '002', positions: [{
      id: '001', manual_item: { name: 'Manual Service' }, quantity: 2, quantity_unit_code: 'HUR',
      unit_price: { currency_id: 'EUR', regular_price: 10.70 },
      amount: { currency_id: 'EUR', net: 20, gross: 21.40, vats: [{ tax_id: 'vat-7', vat: 1.40 }] },
    }] });
    invoice.total_amounts = [{ currency_id: 'EUR', net: 28.99, gross: 32.10, vats: [
      { tax_id: 'vat-19', vat: 1.71 }, { tax_id: 'vat-7', vat: 1.40 },
    ] }];
    const mapped = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice'];
    expect(mapped['cac:InvoiceLine'].map(line => line['cbc:ID'])).toEqual(['1', '2']);
    expect(mapped['cac:InvoiceLine'][1]['cac:Price']['cbc:PriceAmount']).toBe('10');
    expect(mapped['cac:TaxTotal'][0]['cac:TaxSubtotal'].map(group => group['cbc:TaxAmount'])).toEqual(['1.71', '1.40']);
  });

  it('resolves fulfillment item names and accepts an explicit net unit price', () => {
    const { invoice, records } = createEInvoiceFixture();
    const line = invoice.sections[0].positions[0];
    delete line.product_item;
    line.fulfillment_item = { product_id: 'shipping-1', variant_id: 'standard' };
    line.net_unit_price = 8.99;
    const mapped = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice']['cac:InvoiceLine'][0];
    expect(mapped['cac:Item']['cbc:Name']).toBe('Test Shipping');
    expect(mapped['cac:Price']['cbc:PriceAmount']).toBe('8.99');
  });

  it('retains VAT rounded on the category total rather than summing rounded line VAT', () => {
    const { invoice, records } = createEInvoiceFixture();
    const line = invoice.sections[0].positions[0];
    line.unit_price = { currency_id: 'EUR', regular_price: 0.04 };
    line.net_unit_price = 0.03;
    line.amount = { currency_id: 'EUR', net: 0.03, gross: 0.04, vats: [{ tax_id: 'vat-19', vat: 0.01 }] };
    invoice.sections[0].positions.push(structuredClone(line));
    invoice.total_amounts = [{ currency_id: 'EUR', net: 0.06, gross: 0.07, vats: [{ tax_id: 'vat-19', vat: 0.01 }] }];
    const mapped = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice'];
    expect(mapped['cac:TaxTotal'][0]['cbc:TaxAmount']).toBe('0.01');
    expect(mapped['cac:TaxTotal'][0]['cac:TaxSubtotal'][0]['cbc:TaxAmount']).toBe('0.01');
    expect(mapped['cac:LegalMonetaryTotal']['cbc:TaxInclusiveAmount']).toBe('0.07');
  });

  it('keeps a supplied zero VAT category and its exemption explanation', () => {
    const { invoice, records } = createEInvoiceFixture();
    const line = invoice.sections[0].positions[0];
    line.vat_category_code = 'E';
    line.vat_exemption_reason = 'Exempt supply under applicable tax provisions';
    line.amount = { currency_id: 'EUR', net: 10.70, gross: 10.70, vats: [{ tax_id: 'vat-0', vat: 0 }] };
    invoice.total_amounts = [structuredClone(line.amount)];
    const mapped = mapInvoiceToEInvoice(invoice, records)['ubl:Invoice'];
    expect(mapped['cac:InvoiceLine'][0]['cac:Item']['cac:ClassifiedTaxCategory']['cbc:ID']).toBe('E');
    expect(mapped['cac:TaxTotal'][0]['cac:TaxSubtotal'][0]['cac:TaxCategory']['cbc:TaxExemptionReason']).toBe(line.vat_exemption_reason);
  });

  it('reports missing fields together without inventing dates, unit codes, or tax IDs', () => {
    const { invoice, records } = createEInvoiceFixture();
    delete invoice.timestamp;
    delete invoice.due_date;
    delete invoice.sections[0].positions[0].quantity_unit_code;
    delete records.organizations.get('seller-1').vat_id;
    try {
      mapInvoiceToEInvoice(invoice, records);
      expect.fail('Expected missing export data to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(InvoiceMappingError);
      expect((error as InvoiceMappingError).issues.map(issue => issue.field)).toEqual(expect.arrayContaining([
        'timestamp', 'due_date/payment_hints', 'sections[0].positions[0].quantity_unit_code', 'seller_vat_id/seller_tax_registration_id',
      ]));
    }
  });

  it('reports missing related country and tax records as mapping issues', () => {
    const { invoice, records } = createEInvoiceFixture();
    records.countries = new Map();
    records.taxes = new Map();
    expect(() => mapInvoiceToEInvoice(invoice, records)).toThrow(InvoiceMappingError);
  });

  it('rejects missing line amounts instead of treating them as zero', () => {
    const { invoice, records } = createEInvoiceFixture();
    delete invoice.sections[0].positions[0].amount;
    expect(() => mapInvoiceToEInvoice(invoice, records)).toThrow(InvoiceMappingError);
  });

  it('requires a real unit code rather than using a default', async () => {
    const { invoice, records } = createEInvoiceFixture();
    invoice.sections[0].positions[0].quantity_unit_code = 'NOT-A-UNIT';
    await expect(generateInvoiceXml(invoice, records)).rejects.toThrow('validation failed');
  });

  it('maps dates in UTC and rejects an invalid issue date', () => {
    const { invoice, records } = createEInvoiceFixture();
    invoice.timestamp = new Date('2026-10-07T01:00:00+03:00');
    expect(mapInvoiceToEInvoice(invoice, records)['ubl:Invoice']['cbc:IssueDate']).toBe('2026-10-06');
    invoice.timestamp = new Date('invalid');
    expect(() => mapInvoiceToEInvoice(invoice, records)).toThrow(InvoiceMappingError);
  });

  it.each([
    ['gross/net mismatch', (invoice: Invoice) => { invoice.total_amounts[0].gross = 8.99; }],
    ['incorrect VAT', (invoice: Invoice) => { invoice.sections[0].positions[0].amount.vats[0].vat = 2; }],
    ['line/total mismatch', (invoice: Invoice) => { invoice.total_amounts[0].net = 10; }],
    ['mixed currencies', (invoice: Invoice) => { invoice.sections[0].positions[0].amount.currency_id = 'USD'; }],
    ['multiple invoice currencies', (invoice: Invoice) => { invoice.total_amounts.push({ currency_id: 'USD', net: 8.99, gross: 10.70 }); }],
    ['unexplained price mismatch', (invoice: Invoice) => { invoice.sections[0].positions[0].unit_price.sale_price = 20; }],
    ['missing explicit zero VAT category', (invoice: Invoice) => {
      invoice.sections[0].positions[0].amount.vats = [{ tax_id: 'vat-0', vat: 0 }];
    }],
  ])('rejects %s', (_name, change) => {
    const { invoice, records } = createEInvoiceFixture();
    change(invoice);
    expect(() => mapInvoiceToEInvoice(invoice, records)).toThrow(InvoiceMappingError);
  });

  it('generates parseable CII XML with the EN16931 guideline and original amounts', async () => {
    const { invoice, records } = createEInvoiceFixture();
    const xml = await generateInvoiceXml(invoice, records);
    const parsed = create(xml).end({ format: 'object' }) as any;
    const root = parsed['rsm:CrossIndustryInvoice'];
    expect(root['rsm:ExchangedDocumentContext']['ram:GuidelineSpecifiedDocumentContextParameter']['ram:ID']).toBe('urn:cen.eu:en16931:2017');
    expect(root['rsm:ExchangedDocument']['ram:ID']).toBe('TEST-2026-0001');
    expect(root['rsm:SupplyChainTradeTransaction']['ram:ApplicableHeaderTradeSettlement']['ram:SpecifiedTradeSettlementHeaderMonetarySummation']['ram:GrandTotalAmount']).toBe('10.70');
  });
});
