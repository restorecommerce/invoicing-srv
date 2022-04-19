export interface InvoiceRow {
  product: string; // not to be confused with the `product` resource
  pricePerUnit: number;
  quantity: number;
  vat: string;
  amount: number;
  contractStartDate?: number;
}

export interface InvoiceRowSum {
  tableList: InvoiceRow[];
  totalPrice: InvoicePrice;
}

export interface ProductInfo {
  organization: any;
  product: any;
  tax: any;
}

export interface InvoicePrice {
  gross: number;
  net: number;
}

export interface BillingAddress {
  country_name: string;
  telephone: string;
  street: string;
  postcode: string;
  region: string;
  locality: string;
  timezone: string;
  email: string;
  website: string;
  economic_area: EconomicAreas;
  locale: string;
  organization_name: string;
}

export enum EconomicAreas {
  DE = 'DE',
  EEA = 'EEA', // outside of Germany, within EEA
  OTHER = 'OTHER'
}


export enum RenderingStrategy {
  INLINE = 1,
  COPY = 2
}

export enum Currency {
  EUR = 1
}

export enum UnitCode {
  QTY = 1,
  MON = 2
}

export interface InvoicePositions {
  id: string;
  invoice_positions: InvoicePosition[];
  sender_billing_address: BillingAddress;
  recipient_billing_address: BillingAddress;
  recipient_organization: any;
  sender_organization: any;
  recipient_customer: any;
  payment_method_details: any;
  invoice_no?: string;
  from_date?: number;
  to_date?: number;
}

export interface InvoicePosition {
  currency: string;
  tableList: InvoiceRow[];
  totalPrice: InvoicePrice;
}

export interface PaymentMethodDetails {
  type: string;
  iban?: string;
  bic?: string;
  bankName?: string;
  transferType?: string;
  eMail?: string; // in case of PayPal
}

export interface InvoiceNumberResponse {
  invoice_no: string;
}