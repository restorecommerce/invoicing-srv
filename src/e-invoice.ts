import { Decimal } from 'decimal.js';
import {
  InvoiceService,
  type Invoice as ElectronicInvoice,
} from '@e-invoice-eu/core';
import {
  InvoiceExportFormat,
  PaymentState,
  type Invoice,
  type Position,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, decodePDFRawStream } from '@cantoo/pdf-lib';
import type { Address, Contact } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/address.js';
import type { Shop } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/shop.js';
import type { Organization } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/organization.js';
import type { Customer } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/customer.js';
import type { Country } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/country.js';
import type { Currency } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/currency.js';
import type { Tax } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax.js';
import type { Product } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product.js';
import type { FulfillmentProduct } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product.js';

type XmlInvoice = ElectronicInvoice['ubl:Invoice'];
type INVOICELINE = XmlInvoice['cac:InvoiceLine'][number];
type VATBREAKDOWN = NonNullable<XmlInvoice['cac:TaxTotal'][number]['cac:TaxSubtotal']>[number];
type PARTYVATTAXIDENTIFIERS = NonNullable<XmlInvoice['cac:AccountingSupplierParty']['cac:Party']['cac:PartyTaxScheme']>[number];
type InvoiceCurrencyCode = XmlInvoice['cbc:DocumentCurrencyCode'];
type InvoicedItemVATCategoryCode = INVOICELINE['cac:Item']['cac:ClassifiedTaxCategory']['cbc:ID'];
type InvoicedQuantityUnitOfMeasure = INVOICELINE['cbc:InvoicedQuantity@unitCode'];
type SellerCountryCode = XmlInvoice['cac:AccountingSupplierParty']['cac:Party']['cac:PostalAddress']['cac:Country']['cbc:IdentificationCode'];
type VATExemptionReasonCode = VATBREAKDOWN['cac:TaxCategory']['cbc:TaxExemptionReasonCode'];

/** A subset of the service's existing aggregation, without fetching or changing records. */
export type InvoiceExportRecords = {
  shops?: ReadonlyMap<string, Shop>;
  organizations?: ReadonlyMap<string, Organization>;
  customers?: ReadonlyMap<string, Customer>;
  countries?: ReadonlyMap<string, Country>;
  currencies?: ReadonlyMap<string, Currency>;
  taxes?: ReadonlyMap<string, Tax>;
  products?: ReadonlyMap<string, Product>;
  fulfillment_products?: ReadonlyMap<string, FulfillmentProduct>;
};

// ResourceMap.get throws on missing IDs; check presence so missing data becomes a mapping issue.
const lookup = <T>(records: ReadonlyMap<string, T> | undefined, id?: string): T | undefined =>
  id && records?.has(id) ? records.get(id) : undefined;

const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type InvoiceMappingIssue = { field: string; message: string };

export class InvoiceMappingError extends Error {
  constructor(public readonly issues: InvoiceMappingIssue[]) {
    super('Cannot export e-invoice: ' + issues.map(i => i.field + ': ' + i.message).join('; '));
    this.name = 'InvoiceMappingError';
  }
}

const text = (value?: string) => value?.trim() || undefined;
const addressName = (address?: Address) => text(address?.business_address?.name)
  ?? text([
    address?.residential_address?.given_name,
    address?.residential_address?.mid_name,
    address?.residential_address?.family_name,
  ].filter(Boolean).join(' '));

function itemDetails(position: Position, records: InvoiceExportRecords) {
  if (position.manual_item) {
    return { name: position.manual_item.name, description: position.manual_item.descritpion };
  }
  if (position.fulfillment_item) {
    const product = lookup(records.fulfillment_products, position.fulfillment_item.product_id);
    const variant = product?.variants?.find(v => v.id === position.fulfillment_item.variant_id);
    return { name: product?.name ?? variant?.name, description: variant?.description ?? product?.description };
  }
  const product = lookup(records.products, position.product_item?.product_id);
  const individual = product?.product;
  const nature = individual?.physical ?? individual?.virtual ?? individual?.service;
  const variant = [...(nature?.variants ?? []), ...(nature?.templates ?? [])]
    .find(v => v.id === position.product_item?.variant_id);
  return {
    name: individual?.name ?? product?.bundle?.name ?? variant?.name,
    description: variant?.description ?? individual?.description ?? product?.bundle?.description,
  };
}

/** Maps an invoice after related records have been loaded and its invoice number assigned. */
export function mapInvoiceToEInvoice(invoice: Invoice, records: InvoiceExportRecords): ElectronicInvoice {
  const issues: InvoiceMappingIssue[] = [];
  const issue = (field: string, message: string) => issues.push({ field, message });
  const requiredText = (value: string | undefined, field: string) => {
    if (!text(value)) issue(field, 'is required for e-invoice export');
    return text(value) ?? '';
  };
  const number = (value: number | undefined, field: string) => {
    if (value === undefined || !Number.isFinite(value)) {
      issue(field, 'must be a finite number');
      return new Money(0);
    }
    return new Money(value);
  };
  const money = (value: number | undefined, field: string) => {
    const amount = number(value, field);
    const rounded = amount.toDecimalPlaces(2);
    // Ignore binary floating point noise, but never silently round real fractions of a cent.
    if (amount.minus(rounded).abs().gt('0.00000001')) issue(field, 'must have at most two decimal places');
    return rounded;
  };
  const equal = (actual: Decimal, expected: Decimal, field: string, explanation: string) => {
    if (!actual.eq(expected)) issue(field, explanation + ' (expected ' + expected.toFixed(2) + ')');
  };
  const date = (value: Date | undefined, field: string, required = false) => {
    if (value === undefined) {
      if (required) issue(field, 'is required for e-invoice export');
      return undefined;
    }
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())
      || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) {
      issue(field, 'must be a valid date');
      return undefined;
    }
    return value.toISOString().slice(0, 10);
  };
  const period = (from: Date | undefined, to: Date | undefined, field: string) => {
    const start = date(from, field + '.from_date');
    const end = date(to, field + '.to_date');
    if (start && end && start > end) issue(field, 'from_date must not be after to_date');
    return start || end ? {
      ...(start && { 'cbc:StartDate': start }),
      ...(end && { 'cbc:EndDate': end }),
    } : undefined;
  };
  const postalAddress = (address: Address | undefined, field: string) => {
    if (!address) issue(field, 'is required for e-invoice export');
    const country = lookup(records.countries, address?.country_id);
    const code = requiredText(text(country?.country_code_alpha_2) ?? text(country?.country_code), field + '.country_code');
    if (code && !/^[A-Z]{2}$/.test(code)) issue(field + '.country_code', 'must be an ISO 3166-1 alpha-2 code');
    const street = text([address?.street, address?.building_number].filter(Boolean).join(' '));
    return {
      ...(street && { 'cbc:StreetName': street }),
      ...(text(address?.locality) && { 'cbc:CityName': text(address.locality) }),
      ...(text(address?.postcode) && { 'cbc:PostalZone': text(address.postcode) }),
      ...(text(address?.region) && { 'cbc:CountrySubentity': text(address.region) }),
      'cac:Country': { 'cbc:IdentificationCode': code as SellerCountryCode },
    };
  };
  const contact = (value?: Contact) => text(value?.name) || text(value?.phone) || text(value?.email) ? {
    ...(text(value?.name) && { 'cbc:Name': text(value.name) }),
    ...(text(value?.phone) && { 'cbc:Telephone': text(value.phone) }),
    ...(text(value?.email) && { 'cbc:ElectronicMail': text(value.email) }),
  } : undefined;

  const shop = lookup(records.shops, invoice.shop_id);
  const seller = lookup(records.organizations, shop?.organization_id);
  const customer = lookup(records.customers, invoice.customer_id);
  const buyer = lookup(records.organizations, customer?.commercial?.organization_id ?? customer?.public_sector?.organization_id);
  const buyerAddress = invoice.billing_address?.address ?? invoice.recipient?.address;
  const sellerName = requiredText(addressName(invoice.sender?.address) ?? seller?.name, 'seller.name');
  const buyerName = requiredText(addressName(buyerAddress) ?? buyer?.name, 'buyer.name');
  const sellerVatId = text(invoice.seller_vat_id) ?? text(seller?.vat_id);
  const sellerTaxId = text(invoice.seller_tax_registration_id);
  const buyerVatId = text(invoice.customer_vat_id) ?? text(buyer?.vat_id);
  const sellerPostalAddress = postalAddress(invoice.sender?.address, 'sender.address');
  const buyerPostalAddress = postalAddress(buyerAddress, 'billing_address.address');
  const sellerContact = contact(invoice.sender?.contact);
  const buyerContact = contact(invoice.billing_address?.contact ?? invoice.recipient?.contact);
  const deliveryAddress = invoice.recipient?.address
    ? postalAddress(invoice.recipient.address, 'recipient.address') : undefined;
  const deliveryName = addressName(invoice.recipient?.address);
  const invoiceNumber = requiredText(invoice.invoice_number, 'invoice_number');
  const issueDate = date(invoice.timestamp, 'timestamp', true);
  const dueDate = date(invoice.due_date, 'due_date');

  if (invoice.total_amounts?.length !== 1) issue('total_amounts', 'exactly one invoice currency is required');
  const total = invoice.total_amounts?.[0];
  const currencyId = requiredText(total?.currency_id, 'total_amounts[0].currency_id');
  const currency = requiredText(lookup(records.currencies, currencyId)?.code, 'currency.code') as InvoiceCurrencyCode;
  const totalNet = money(total?.net, 'total_amounts[0].net');
  const totalGross = money(total?.gross, 'total_amounts[0].gross');
  const totalVat = (total?.vats ?? []).reduce((sum, vat, i) =>
    sum.plus(money(vat.vat, 'total_amounts[0].vats[' + i + '].vat')), new Money(0));
  equal(totalGross, totalNet.plus(totalVat), 'total_amounts[0].gross', 'must equal net plus VAT');
  const prepaid = invoice.payment_state === PaymentState.PAYED ? totalGross : new Money(0);
  const payable = totalGross.minus(prepaid);
  const terms = invoice.payment_hints?.map(text).filter(Boolean).join('\n');
  if (payable.gt(0) && !dueDate && !terms) issue('due_date/payment_hints', 'a positive amount due requires a due date or payment terms');

  type Group = {
    code: InvoicedItemVATCategoryCode; rate: Decimal; net: Decimal; vat: Decimal;
    reason?: string; reasonCode?: VATExemptionReasonCode;
  };
  const groups = new Map<string, Group>();
  const groupsByTaxId = new Map<string, Set<string>>();
  const lines: INVOICELINE[] = [];
  let lineNetTotal = new Money(0);
  for (const [sectionIndex, section] of (invoice.sections ?? []).entries()) {
    for (const [positionIndex, position] of (section.positions ?? []).entries()) {
      const field = 'sections[' + sectionIndex + '].positions[' + positionIndex + ']';
      const quantity = number(position.quantity, field + '.quantity');
      if (!quantity.isInteger() || quantity.lt(0)) issue(field + '.quantity', 'must be a non-negative integer');
      const unitCode = requiredText(position.quantity_unit_code, field + '.quantity_unit_code') as InvoicedQuantityUnitOfMeasure;
      const details = itemDetails(position, records);
      const name = requiredText(details.name, field + '.item.name');
      if (position.amount?.currency_id !== currencyId) issue(field + '.amount.currency_id', 'must match the invoice currency');
      if (position.unit_price?.currency_id && position.unit_price.currency_id !== currencyId) issue(field + '.unit_price.currency_id', 'must match the invoice currency');
      const net = money(position.amount?.net, field + '.amount.net');
      const gross = money(position.amount?.gross, field + '.amount.gross');
      if (net.lt(0)) issue(field + '.amount.net', 'negative invoice lines cannot be represented by the current quantity and price fields');
      const vats = position.amount?.vats ?? [];
      if (vats.length > 1) issue(field + '.amount.vats', 'one invoice line must have a single VAT category and rate');
      const vat = vats[0];
      const vatAmount = vat ? money(vat.vat, field + '.amount.vats[0].vat') : new Money(0);
      const tax = lookup(records.taxes, vat?.tax_id);
      const category = text(position.vat_category_code) ?? (tax?.rate > 0 ? 'S' : undefined);
      const code = requiredText(category, field + '.vat_category_code') as InvoicedItemVATCategoryCode;
      if (code && !['S', 'Z', 'E', 'AE', 'K', 'G', 'O', 'L', 'M'].includes(code)) issue(field + '.vat_category_code', 'is not a supported EN16931 VAT category');
      const rate = tax?.rate !== undefined ? number(tax.rate, field + '.tax.rate')
        : ['Z', 'E', 'AE', 'K', 'G', 'O'].includes(code) ? new Money(0)
          : number(undefined, field + '.tax.rate');
      if (rate.lt(0) || rate.gt(1)) issue(field + '.tax.rate', 'must be a fraction between 0 and 1');
      if (['S', 'L', 'M'].includes(code) && rate.lte(0)) issue(field + '.tax.rate', 'this VAT category requires a positive rate');
      if (['Z', 'E', 'AE', 'K', 'G', 'O'].includes(code) && (!rate.isZero() || !vatAmount.isZero())) issue(field + '.amount.vats', 'this VAT category requires zero VAT');
      const reason = text(position.vat_exemption_reason);
      const reasonCode = text(position.vat_exemption_reason_code) as VATExemptionReasonCode;
      if (['E', 'AE', 'K', 'G', 'O'].includes(code) && !reason && !reasonCode) issue(field + '.vat_exemption_reason', 'an exemption explanation or VATEX code is required');
      if (['S', 'Z', 'L', 'M'].includes(code) && (reason || reasonCode)) issue(field + '.vat_exemption_reason', 'must be absent for this VAT category');
      equal(gross, net.plus(vatAmount), field + '.amount.gross', 'must equal net plus VAT');
      if (vatAmount.minus(net.times(rate).toDecimalPlaces(2)).abs().gt('0.01')) {
        issue(field + '.amount.vats', 'line VAT must agree with its rate within one cent of rounding');
      }

      let unitPrice: Decimal;
      const selectedGrossPrice = position.unit_price?.sale ? position.unit_price.sale_price : position.unit_price?.regular_price;
      if (position.net_unit_price !== undefined) {
        unitPrice = number(position.net_unit_price, field + '.net_unit_price');
        if (selectedGrossPrice !== undefined) equal(number(selectedGrossPrice, field + '.unit_price').toDecimalPlaces(2),
          unitPrice.times(rate.plus(1)).toDecimalPlaces(2), field + '.net_unit_price', 'must agree with the existing gross unit price');
      } else {
        unitPrice = number(selectedGrossPrice, field + '.unit_price').div(rate.plus(1));
      }
      if (unitPrice.lt(0)) issue(field + '.net_unit_price', 'must not be negative');
      // Retain enough precision to reproduce the line total after gross-to-net conversion.
      unitPrice = unitPrice.toDecimalPlaces(12);
      equal(unitPrice.times(quantity).toDecimalPlaces(2), net, field + '.net_unit_price', 'price times quantity must equal the line net amount; provide an explicit net_unit_price if needed');
      const groupKey = code + ':' + rate.toString();
      const group = groups.get(groupKey) ?? { code, rate, net: new Money(0), vat: new Money(0), reason, reasonCode };
      if (group.reason !== reason || group.reasonCode !== reasonCode) issue(field + '.vat_exemption_reason', 'must be consistent for the same VAT category and rate');
      group.net = group.net.plus(net);
      groups.set(groupKey, group);
      const taxId = vat?.tax_id ?? '';
      const taxGroups = groupsByTaxId.get(taxId) ?? new Set<string>();
      taxGroups.add(groupKey);
      groupsByTaxId.set(taxId, taxGroups);
      lineNetTotal = lineNetTotal.plus(net);
      const invoicePeriod = period(position.from_date, position.to_date, field);
      // The library's schema requires this currency attribute, although its Price type omits it.
      const price: INVOICELINE['cac:Price'] & { 'cbc:PriceAmount@currencyID': InvoiceCurrencyCode } = {
        'cbc:PriceAmount': unitPrice.toFixed(),
        'cbc:PriceAmount@currencyID': currency,
        'cbc:BaseQuantity': '1',
        'cbc:BaseQuantity@unitCode': unitCode,
      };
      lines.push({
        'cbc:ID': String(lines.length + 1),
        'cbc:InvoicedQuantity': quantity.toFixed(),
        'cbc:InvoicedQuantity@unitCode': unitCode,
        'cbc:LineExtensionAmount': net.toFixed(2),
        'cbc:LineExtensionAmount@currencyID': currency,
        ...(invoicePeriod && { 'cac:InvoicePeriod': invoicePeriod }),
        'cac:Item': {
          'cbc:Name': name,
          ...(text(details.description) && { 'cbc:Description': text(details.description) }),
          'cac:ClassifiedTaxCategory': {
            'cbc:ID': code,
            ...(code !== 'O' && { 'cbc:Percent': rate.times(100).toFixed() }),
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        },
        'cac:Price': price,
      });
    }
  }
  if (!lines.length) issue('sections.positions', 'at least one invoice line is required');
  equal(totalNet, lineNetTotal, 'total_amounts[0].net', 'must equal the sum of line net amounts');
  for (const [index, vat] of (total?.vats ?? []).entries()) {
    const id = vat.tax_id ?? '';
    const keys = groupsByTaxId.get(id);
    const amount = money(vat.vat, 'total_amounts[0].vats[' + index + '].vat');
    if (!keys?.size && !amount.isZero()) issue('total_amounts[0].vats', 'tax ' + id + ' does not occur in any invoice line');
    else if (keys?.size === 1) {
      const group = groups.get([...keys][0]);
      group.vat = group.vat.plus(amount);
    } else if (!amount.isZero()) issue('total_amounts[0].vats', 'tax ' + id + ' has ambiguous VAT categories');
  }
  const categories = new Set([...groups.values()].map(g => g.code));
  if ([...categories].some(c => ['S', 'Z', 'E', 'AE', 'K', 'G', 'L', 'M'].includes(c)) && !sellerVatId && !sellerTaxId) {
    issue('seller_vat_id/seller_tax_registration_id', 'a seller VAT ID or tax registration ID is required for these VAT categories');
  }
  if (categories.has('AE') && !buyerVatId && !text(buyer?.registration)) issue('customer_vat_id', 'reverse charge requires the buyer VAT ID or legal registration ID');
  if (categories.has('K') && (!sellerVatId || !buyerVatId)) issue('seller_vat_id/customer_vat_id', 'intra-community supply requires seller and buyer VAT IDs');
  if (categories.has('O') && categories.size > 1) issue('vat_category_code', 'outside-scope VAT cannot be combined with other categories');
  if (categories.has('O') && (text(invoice.seller_vat_id) || text(invoice.customer_vat_id))) issue('vat_category_code', 'outside-scope VAT must not include explicit party VAT IDs');

  const breakdown: VATBREAKDOWN[] = [...groups.values()].map(group => {
    equal(group.vat, group.net.times(group.rate).toDecimalPlaces(2), 'total_amounts[0].vats', 'VAT must equal the taxable amount times its rate');
    return {
      'cbc:TaxableAmount': group.net.toFixed(2),
      'cbc:TaxableAmount@currencyID': currency,
      'cbc:TaxAmount': group.vat.toFixed(2),
      'cbc:TaxAmount@currencyID': currency,
      'cac:TaxCategory': {
        'cbc:ID': group.code,
        ...(group.code !== 'O' && { 'cbc:Percent': group.rate.times(100).toFixed() }),
        ...(group.reason && { 'cbc:TaxExemptionReason': group.reason }),
        ...(group.reasonCode && { 'cbc:TaxExemptionReasonCode': group.reasonCode }),
        'cac:TaxScheme': { 'cbc:ID': 'VAT' },
      },
    };
  });
  // Outside-scope invoices must omit VAT IDs, including those stored on related organizations.
  const exportedSellerVatId = categories.has('O') ? undefined : sellerVatId;
  const exportedBuyerVatId = categories.has('O') ? undefined : buyerVatId;
  const taxIdentifiers: PARTYVATTAXIDENTIFIERS[] = [
    ...(exportedSellerVatId ? [{ 'cbc:CompanyID': exportedSellerVatId, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } }] : []),
    ...(sellerTaxId ? [{ 'cbc:CompanyID': sellerTaxId, 'cac:TaxScheme': { 'cbc:ID': 'FC' } }] : []),
  ];
  const invoicePeriod = period(invoice.from_date, invoice.to_date, 'invoice');
  if (issues.length) throw new InvoiceMappingError(issues);

  return {
    'ubl:Invoice': {
      'cbc:CustomizationID': 'urn:cen.eu:en16931:2017',
      'cbc:ID': invoiceNumber,
      'cbc:IssueDate': issueDate,
      ...(dueDate && { 'cbc:DueDate': dueDate }),
      'cbc:InvoiceTypeCode': '380',
      'cbc:DocumentCurrencyCode': currency,
      ...(invoicePeriod && { 'cac:InvoicePeriod': invoicePeriod }),
      ...(text(invoice.customer_order_number) && { 'cac:OrderReference': { 'cbc:ID': text(invoice.customer_order_number) } }),
      ...(deliveryAddress && { 'cac:Delivery': {
        'cac:DeliveryLocation': { 'cac:Address': deliveryAddress },
        ...(deliveryName && { 'cac:DeliveryParty': { 'cac:PartyName': { 'cbc:Name': deliveryName } } }),
      } }),
      'cac:AccountingSupplierParty': { 'cac:Party': {
        'cac:PostalAddress': sellerPostalAddress,
        ...(taxIdentifiers.length && { 'cac:PartyTaxScheme': taxIdentifiers as [PARTYVATTAXIDENTIFIERS] | [PARTYVATTAXIDENTIFIERS, PARTYVATTAXIDENTIFIERS] }),
        'cac:PartyLegalEntity': {
          'cbc:RegistrationName': sellerName,
          ...(text(seller?.registration) && { 'cbc:CompanyID': text(seller.registration) }),
        },
        ...(sellerContact && { 'cac:Contact': sellerContact }),
      } },
      'cac:AccountingCustomerParty': { 'cac:Party': {
        'cac:PostalAddress': buyerPostalAddress,
        ...(exportedBuyerVatId && { 'cac:PartyTaxScheme': { 'cbc:CompanyID': exportedBuyerVatId, 'cac:TaxScheme': { 'cbc:ID': 'VAT' } } }),
        'cac:PartyLegalEntity': {
          'cbc:RegistrationName': buyerName,
          ...(text(buyer?.registration) && { 'cbc:CompanyID': text(buyer.registration) }),
        },
        ...(buyerContact && { 'cac:Contact': buyerContact }),
      } },
      ...(terms && { 'cac:PaymentTerms': { 'cbc:Note': terms } }),
      'cac:TaxTotal': [{ 'cbc:TaxAmount': totalVat.toFixed(2), 'cbc:TaxAmount@currencyID': currency, 'cac:TaxSubtotal': breakdown }],
      'cac:LegalMonetaryTotal': {
        'cbc:LineExtensionAmount': lineNetTotal.toFixed(2),
        'cbc:LineExtensionAmount@currencyID': currency,
        'cbc:TaxExclusiveAmount': totalNet.toFixed(2),
        'cbc:TaxExclusiveAmount@currencyID': currency,
        'cbc:TaxInclusiveAmount': totalGross.toFixed(2),
        'cbc:TaxInclusiveAmount@currencyID': currency,
        ...(invoice.payment_state === PaymentState.PAYED && { 'cbc:PrepaidAmount': prepaid.toFixed(2), 'cbc:PrepaidAmount@currencyID': currency }),
        'cbc:PayableAmount': payable.toFixed(2),
        'cbc:PayableAmount@currencyID': currency,
      },
      'cac:InvoiceLine': lines as [INVOICELINE, ...INVOICELINE[]],
    },
  };
}

/** Generates standalone CII XML with the ZUGFeRD EN16931 guideline identifier. */
export async function generateInvoiceXml(invoice: Invoice, records: InvoiceExportRecords): Promise<string> {
  const mapped = mapInvoiceToEInvoice(invoice, records);
  const service = new InvoiceService({ log: () => {}, warn: () => {}, error: () => {} });
  // CII emits the same invoice syntax used by ZUGFeRD, without requiring a PDF.
  const result = await service.generate(mapped, { format: 'CII', lang: 'en' });
  if (typeof result !== 'string') throw new Error('Invoice XML generation returned a non-XML result');
  return result;
}

export type InvoiceExportFile = {
  data: Uint8Array;
  extension: 'pdf' | 'xml';
  content_type: 'application/pdf' | 'application/xml';
};

/** Returns the exact attachment bytes; it does not regenerate or reserialize XML. */
export async function extractInvoiceXml(pdf: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.load(pdf, { updateMetadata: false });
  const names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const tree = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  const matches: PDFDict[] = [];
  const visit = (node: PDFDict) => {
    const files = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    for (let i = 0; files && i < files.size(); i += 2) {
      const filename = files.lookup(i);
      if ((filename instanceof PDFString || filename instanceof PDFHexString) && filename.decodeText() === 'factur-x.xml') {
        matches.push(files.lookup(i + 1, PDFDict));
      }
    }
    const children = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    for (let i = 0; children && i < children.size(); i++) visit(children.lookup(i, PDFDict));
  };
  if (tree) visit(tree);
  if (matches.length !== 1) throw new Error('Expected exactly one factur-x.xml attachment in the generated PDF');
  const stream = matches[0].lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'));
  if (!(stream instanceof PDFRawStream)) throw new Error('The invoice XML attachment has no readable stream');
  return decodePDFRawStream(stream).decode();
}

/** Uses one library generation call for XML-only, hybrid PDF, or both outputs. */
export async function generateInvoiceExport(
  mapped: ElectronicInvoice,
  format: InvoiceExportFormat,
  sourcePdf?: Uint8Array,
): Promise<InvoiceExportFile[]> {
  const service = new InvoiceService({ log: () => {}, warn: () => {}, error: () => {} });
  if (format === InvoiceExportFormat.ZUGFERD_XML) {
    const xml = await service.generate(mapped, { format: 'CII', lang: 'en' });
    if (typeof xml !== 'string') throw new Error('Invoice XML generation returned a non-XML result');
    return [{ data: new TextEncoder().encode(xml), extension: 'xml', content_type: 'application/xml' }];
  }
  if (format !== InvoiceExportFormat.ZUGFERD_PDF && format !== InvoiceExportFormat.ZUGFERD_BOTH) {
    throw new Error('Unsupported e-invoice export format');
  }
  if (!sourcePdf?.length) throw new Error('A source PDF is required for ZUGFeRD PDF export');
  const result = await service.generate(mapped, {
    format: 'ZUGFeRD-EN16931', lang: 'en',
    pdf: { buffer: sourcePdf, filename: mapped['ubl:Invoice']['cbc:ID'] + '.pdf', mimetype: 'application/pdf' },
  });
  if (typeof result === 'string') throw new Error('ZUGFeRD generation returned a non-PDF result');
  const files: InvoiceExportFile[] = [{ data: result, extension: 'pdf', content_type: 'application/pdf' }];
  if (format === InvoiceExportFormat.ZUGFERD_BOTH) {
    files.push({ data: await extractInvoiceXml(result), extension: 'xml', content_type: 'application/xml' });
  }
  return files;
}

/** Converts mapper and library input-validation failures to a useful API message. */
export function invoiceValidationMessage(error: unknown): string | undefined {
  if (error instanceof InvoiceMappingError) return error.message;
  const validation = error as { validation?: boolean; errors?: { instancePath?: string; message?: string }[] };
  if (validation?.validation && Array.isArray(validation.errors)) {
    return 'Cannot export e-invoice: ' + validation.errors.map(e =>
      (e.instancePath || 'invoice') + ': ' + e.message).join('; ');
  }
  return undefined;
}
