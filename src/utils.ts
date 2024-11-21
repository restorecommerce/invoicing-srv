import {
  Invoice,
  InvoiceList,
  Position,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import {
  Shop,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/shop.js';
import {
  Customer,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/customer.js';
import {
  Organization,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/organization.js';
import {
  ContactPoint,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/contact_point.js';
import {
  Address,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/address.js';
import {
  Country,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/country.js';
import {
  Currency,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/currency.js';
import {
  User,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/user.js';
import {
  Bundle,
  IndividualProduct,
  PhysicalProduct,
  PhysicalVariant,
  Product,
  ServiceProduct,
  ServiceVariant,
  VirtualProduct,
  VirtualVariant
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product.js';
import {
  Manufacturer,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/manufacturer.js';
import {
  ProductCategory,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product_category.js';
import {
  ProductPrototype,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/product_prototype.js';
import {
  TaxType,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax_type.js';
import {
  Tax,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax.js';
import {
  FulfillmentProduct,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product.js';
import {
  Locale,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/locale.js';
import {
  Timezone,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/timezone.js';
import {
  Template,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/template.js';
import {
  Setting,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/setting.js';
import {
  type Aggregation,
  resolve,
  Resolver,
  ArrayResolver,
  ResourceMap,
} from './experimental/ResourceAggregator.js';
import { Any } from '@restorecommerce/rc-grpc-clients/dist/generated-server/google/protobuf/any.js';

export const DefaultUrns = {
  invoice_role: 'urn:invoice_role',
  render_options: 'urn:render_options',
  render_strategy: 'urn:render_strategy',
  render_style: 'render_style',
  render_template: 'render_template',
  pdf_template_id: 'pdf_template_id',
  pdf_template_url: 'pdf_template_url',
  email_template_id: 'email_template_id',
  email_template_url: 'email_template_url',
  email_provider: 'email_provider',
  email_in_cc: 'email_in_cc',
  email_subject_template: 'email_subject_template',
  default_bucket: 'default_bucket',
  invoice_html_bucket: 'invoice_html_bucket',
  invoice_html_bucket_options: 'invoice_html_bucket_options',
  invoice_pdf_bucket: 'invoice_pdf_bucket',
  invoice_pdf_bucket_options: 'invoice_pdf_bucket_options',
  invoice_pdf_puppeteer_options: 'invoice_pdf_puppeteer_options',
  enable_invoice_html_storage: 'enable_invoice_html_storage',
  enable_invoice_pdf_storage: 'enable_invoice_pdf_storage',
  invoice_number_start: 'invoice_number_start',
  invoice_number_increment: 'invoice_number_increment',
  invoice_number_pattern: 'invoice_number_pattern',
  disable_invoice_html_storage: 'disable_invoice_html_storage',
  disable_invoice_pdf_storage: 'disable_invoice_pdf_storage',
  puppeteer_options: 'puppeteer_options',
};

export type KnownUrns = typeof DefaultUrns;

export type ProductNature = PhysicalProduct | VirtualProduct | ServiceProduct;
export type ProductVariant = PhysicalVariant | VirtualVariant | ServiceVariant;
export type PositionProduct = ProductVariant | Bundle;
export type AggregatedPosition = Position & {
  product: PositionProduct;
};

export type AggregationTemplate = {
  shops?: ResourceMap<Shop>;
  customers?: ResourceMap<Customer>;
  organizations?: ResourceMap<Organization>;
  contact_points?: ResourceMap<ContactPoint>;
  addresses?: ResourceMap<Address>;
  countries?: ResourceMap<Country>;
  users?: ResourceMap<User>;
  products?: ResourceMap<Product>;
  taxes?: ResourceMap<Tax>;
  tax_types?: ResourceMap<TaxType>;
  manufacturers?: ResourceMap<Manufacturer>;
  categories?: ResourceMap<ProductCategory>;
  prototypes?: ResourceMap<ProductPrototype>;
  fulfillments_products?: ResourceMap<FulfillmentProduct>;
  locales?: ResourceMap<Locale>;
  timezones?: ResourceMap<Timezone>;
  currencies?: ResourceMap<Currency>;
  templates?: ResourceMap<Template>;
  settings?: ResourceMap<Setting>;
};

export type AggregatedInvoiceList = Aggregation<InvoiceList, AggregationTemplate>;

export type KnownSetting = {
  default_bucket?: string;
  invoice_number_start?: number;
  invoice_number_increment?: number;
  invoice_html_bucket?: string;
  invoice_pdf_bucket?: string;
  disable_invoice_html_storage?: string;
  disable_invoice_pdf_storage?: string;
  invoice_html_bucket_options?: any;
  invoice_pdf_bucket_options?: any;
  invoice_number_pattern?: any;
  puppeteer_options?: any;
  email_provider?: string;
  email_subject_template?: string;
  email_in_cc?: string[];
  bucket_key_delimiter?: string;
  ostorage_domain_prefix?: string;
};

export type InvoiceNumber = {
  id?: string;
  shop_id?: string;
  increment?: number;
  invoice_number?: string;
};

const mergeProductVariantRecursive = (nature: ProductNature, variant_id: string): ProductVariant => {
  const variant = nature?.variants?.find(v => v.id === variant_id);
  if (variant?.parent_variant_id) {
    const template = mergeProductVariantRecursive(
      nature, variant.parent_variant_id
    );
    return {
      ...template,
      ...variant,
    };
  }
  else {
    return variant;
  }
};

const mergeProductVariant = (product: IndividualProduct, variant_id: string): ProductVariant => {
  const nature = product.physical ?? product.virtual ?? product.service;
  const variant = mergeProductVariantRecursive(nature, variant_id);
  return {
    ...product,
    ...variant
  }
};

export const resolveInvoice = (
  aggregation: AggregatedInvoiceList,
  invoice: Invoice,
) => {
  const contact_points_resolver = ArrayResolver(
    'contact_point_ids',
    aggregation.contact_points,
    {
      physical_address: Resolver(
        'physical_address_id',
        aggregation.addresses,
        {
          country: Resolver('country_id', aggregation.countries),
        }
      ),
      locale: Resolver('locale_id', aggregation.locales),
      timezone: Resolver('timezone_id', aggregation.timezones),
    }
  );
  const organization_resolver = Resolver(
    'organization_id',
    aggregation.organizations,
    {
      contact_points: contact_points_resolver
    }
  );
  const user_resolver = Resolver('user_id', aggregation.users, {
    locale: Resolver('locale_id', aggregation.locales),
    timezone: Resolver('timezone_id', aggregation.timezones),
  });
  const individual_product_resolver = {
    category: Resolver('category_id', aggregation.categories),
    manufacturer: Resolver('manufacturer_id', aggregation.manufacturers),
    origin_country: Resolver('origin_country_id', aggregation.countries),
    prototype: Resolver('prototype_id', aggregation.prototypes),
  };
  const product_resolver = {
    product: Resolver(
      'product_id',
      aggregation.products,
      {
        product: individual_product_resolver,
        bundle: {
          products: {
            product: Resolver(
              'product_id',
              aggregation.products,
              individual_product_resolver
            )
          }
        }
      }
    )
  };
  const currency_resolver = Resolver(
    'currency_id',
    aggregation.currencies,
  );
  const tax_resolver = Resolver('tax_id', aggregation.taxes, {
    type: Resolver('type_id', aggregation.tax_types),
  });
  const amount_resolver = [{
    currency: currency_resolver,
    vats: [{
      tax: tax_resolver
    }]
  }];
  const fulfillment_product_resolver = {
    product: Resolver(
      'product_id',
      aggregation.fulfillments_products,
      {
        tax: tax_resolver,
        country: Resolver('country_id', aggregation.countries),
      }
    ),
  };
  const section_resolver = [{
    positions: [{
      product_item: product_resolver,
      fulfillment_item: fulfillment_product_resolver,
      amount: amount_resolver,
      unit_price: {
        currency: currency_resolver,
      }
    }],
    amounts: amount_resolver,
  }];

  const resolved = resolve(
    invoice,
    {
      customer: Resolver('customer_id', aggregation.customers, {
        commercial: organization_resolver,
        public_sector: organization_resolver,
        private: {
          contact_points: contact_points_resolver
        },
      }),
      shop: Resolver('shop_id', aggregation.shops, {
        organization: organization_resolver
      }),
      user: user_resolver,
      sections: section_resolver
    }
  );

  resolved.sections?.forEach(
    (section: typeof resolved.sections[0]) => section.positions?.forEach(
      (position: typeof section.positions[0]) => {
        const product = position.product_item?.product;
        if (product?.product) {
          product.product = mergeProductVariant(
            product.product,
            position.product_item.variant_id
          );
        }
      }
    )
  );
  return resolved;
};

export const marshallProtobufAny = (
  obj: any,
  type_url?: string
): Any => ({
  type_url,
  value: Buffer.from(
    JSON.stringify(
      obj
    )
  )
});

export const unmarshallProtobufAny = (payload: Any): any => JSON.parse(
  payload.value!.toString()
);