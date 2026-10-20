import { expect } from 'vitest';
import { Decimal } from 'decimal.js';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';

// Resolve the real worker module when this helper is loaded through Vitest.
GlobalWorkerOptions.workerSrc = import.meta.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

const Money = Decimal.clone({ rounding: Decimal.ROUND_HALF_UP, precision: 40 });
const money = (value: string) => new Money(value.replace('€', '').replaceAll(',', '')).toFixed(2);

export function xmlElement(parent: XMLBuilder, ...path: string[]): XMLBuilder {
  return path.reduce((node, name) => {
    const child = node.find(n => n.node.nodeType === 1 && n.node.nodeName.split(':').at(-1) === name);
    if (!child) throw new Error('Missing XML element: ' + path.join('/'));
    return child;
  }, parent);
}

const xmlText = (parent: XMLBuilder, ...path: string[]) => xmlElement(parent, ...path).node.textContent.trim();

/** Reads page text, rather than PDF metadata or the attached XML. */
export async function visiblePdfPages(data: Uint8Array): Promise<string[]> {
  // PDF.js transfers its input buffer; copy it so callers can still use the PDF.
  const task = getDocument({ data: Uint8Array.from(data) });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => 'str' in item
        ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
    }
    return pages.map(page => page.split('\n').map(line => line.trim().replace(/\s+/g, ' ')).join('\n'));
  } finally {
    await task.destroy();
  }
}

/** Checks the values printed by the current English/EUR invoice template. */
export async function expectPdfInvoiceMatchesXml(
  pdf: Uint8Array,
  xml: Uint8Array | string,
  expected?: { shopName?: string },
): Promise<void> {
  const pages = await visiblePdfPages(pdf);
  const text = pages.join('\n');
  const root = create(typeof xml === 'string' ? xml : new TextDecoder().decode(xml)).root();
  const document = xmlElement(root, 'ExchangedDocument');
  const transaction = xmlElement(root, 'SupplyChainTradeTransaction');
  const agreement = xmlElement(transaction, 'ApplicableHeaderTradeAgreement');
  const seller = xmlElement(agreement, 'SellerTradeParty');
  const buyer = xmlElement(agreement, 'BuyerTradeParty');
  const settlement = xmlElement(transaction, 'ApplicableHeaderTradeSettlement');
  const totals = xmlElement(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');

  const capture = (pattern: RegExp, field: string) => {
    const match = text.match(pattern);
    expect(match, 'Missing visible PDF ' + field + '\n' + text).not.toBeNull();
    return match[1];
  };
  expect(text, 'PDF unresolved template placeholders').not.toMatch(/\{\{[^}]*\}\}/);
  pages.forEach((page, index) => {
    expect(page, 'PDF page numbering').toMatch(new RegExp(`\\bpage ${index + 1} of ${pages.length}\\b`));
  });
  if (expected?.shopName) expect(text, 'PDF shop title').toContain(expected.shopName);
  expect(capture(/^Billing Address:\s+(.+)$/m, 'buyer name'), 'PDF/XML buyer name')
    .toBe(xmlText(buyer, 'Name'));
  expect(text, 'PDF/XML seller name').toContain(xmlText(seller, 'Name'));
  // These fixtures include a seller VAT registration in the CII party data.
  expect(capture(/^VAT ID:\s+(\S+)$/m, 'seller VAT ID'), 'PDF/XML seller VAT ID')
    .toBe(xmlText(seller, 'SpecifiedTaxRegistration', 'ID'));
  const terms = settlement.find(node => node.node.nodeName.split(':').at(-1) === 'SpecifiedTradePaymentTerms');
  const instructions = terms?.find(node => node.node.nodeName.split(':').at(-1) === 'Description');
  if (instructions) {
    expect(capture(/^Payment:\s+(.+)$/m, 'payment instructions'), 'PDF/XML payment instructions')
      .toBe(instructions.node.textContent.trim().replace(/\s+/g, ' '));
  }
  expect(capture(/^Invoice Number\s+(\S+)$/m, 'invoice number'), 'PDF/XML invoice number')
    .toBe(xmlText(document, 'ID'));
  const date = xmlText(document, 'IssueDateTime', 'DateTimeString');
  expect(capture(/^Date\s+(\d{2}\/\d{2}\/\d{4})$/m, 'issue date'), 'PDF/XML issue date')
    .toBe(`${date.slice(4, 6)}/${date.slice(6, 8)}/${date.slice(0, 4)}`);

  // The euro symbol is read from every monetary cell below, including zero values.
  expect(xmlText(settlement, 'InvoiceCurrencyCode'), 'PDF/XML currency').toBe('EUR');
  const table = capture(/Position Name Quantity Price Amount\n([\s\S]+?)\nNet:/,
    'line-item table');
  const rows = table.trim().split('\n').filter(Boolean).map(row => {
    const match = row.match(/^\d+\s+(.+?)\s+(\d+)\s+(€[\d,]+\.\d{2})\s+(€[\d,]+\.\d{2})$/);
    expect(match, 'Cannot read visible PDF line: ' + row).not.toBeNull();
    return { name: match[1], quantity: Number(match[2]), grossUnitPrice: money(match[3]), grossAmount: money(match[4]) };
  });
  const xmlLines = transaction.filter(node => node.node.nodeName.split(':').at(-1) === 'IncludedSupplyChainTradeLineItem')
    .map(line => {
      const lineSettlement = xmlElement(line, 'SpecifiedLineTradeSettlement');
      const rate = new Money(xmlText(lineSettlement, 'ApplicableTradeTax', 'RateApplicablePercent')).div(100);
      const netPrice = new Money(xmlText(line, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount'));
      const basis = new Money(xmlText(line, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'BasisQuantity'));
      const netAmount = new Money(xmlText(lineSettlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'));
      return {
        name: xmlText(line, 'SpecifiedTradeProduct', 'Name'),
        quantity: Number(xmlText(line, 'SpecifiedLineTradeDelivery', 'BilledQuantity')),
        // PDF prices/amounts include VAT; CII line prices/amounts exclude VAT.
        grossUnitPrice: netPrice.div(basis).times(rate.plus(1)).toFixed(2),
        grossAmount: netAmount.times(rate.plus(1)).toFixed(2),
      };
    });
  expect(rows, 'PDF/XML line items').toEqual(xmlLines);

  expect(money(capture(/^Net:\s+(€[\d,]+\.\d{2})$/m, 'net total')), 'PDF/XML net total')
    .toBe(money(xmlText(totals, 'TaxBasisTotalAmount')));
  const vats = [...text.matchAll(/^\+ VAT\s+(\d+(?:\.\d+)?)\s*%\s*:\s+(€[\d,]+\.\d{2})$/gm)]
    .map(match => ({ rate: new Money(match[1]).toString(), amount: money(match[2]) }));
  const xmlVats = settlement.filter(node => node.node.nodeName.split(':').at(-1) === 'ApplicableTradeTax')
    .map(tax => ({ rate: new Money(xmlText(tax, 'RateApplicablePercent')).toString(),
      amount: money(xmlText(tax, 'CalculatedAmount')) }));
  expect(vats, 'PDF/XML VAT breakdown').toEqual(xmlVats);
  expect(vats.reduce((sum, vat) => sum.plus(vat.amount), new Money(0)).toFixed(2), 'PDF/XML VAT total')
    .toBe(money(xmlText(totals, 'TaxTotalAmount')));
  expect(money(capture(/^Total:\s+(€[\d,]+\.\d{2})$/m, 'gross total')), 'PDF/XML gross total')
    .toBe(money(xmlText(totals, 'GrandTotalAmount')));
}
