import { randomUUID } from 'node:crypto';
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
  Any
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/google/protobuf/any.js';
import {
  RenderRequest_Strategy
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import {
  type Aggregation,
  Resolver,
  ArrayResolver,
  ResourceMap,
  ResolverMap,
  Resolved,
} from './experimental/index.js';

export const DefaultUrns = {
  shop_default_bucket:                'urn:restorecommerce:shop:setting:invoice:bucket:default',        // [string]: overrides default bucket for file storage - default: cfg -> 'invoice'
  shop_html_bucket:                   'urn:restorecommerce:shop:setting:invoice:bucket:html',           // [string]: bucket for html render results - default: default_bucket -> cfg -> 'invoice'
  shop_html_bucket_options:           'urn:restorecommerce:shop:setting:invoice:bucket:html:options',   // [json]: override html bucket options - default: cfg -> null
  shop_html_bucket_disabled:          'urn:restorecommerce:shop:setting:invoice:bucket:html:disabled',  // [boolean]: deactivate storage of html render results - default: cfg -> false
  shop_pdf_bucket:                    'urn:restorecommerce:shop:setting:invoice:bucket:pdf',            // [string]: bucket for pdf render results - default: default_bucket -> cfg -> 'invoice' 
  shop_pdf_bucket_options:            'urn:restorecommerce:shop:setting:invoice:bucket:pdf:options',    // [json]: override pdf bucket options - default: cfg -> null
  shop_pdf_bucket_disabled:           'urn:restorecommerce:shop:setting:invoice:bucket:pdf:disabled',   // [boolean]: deactivate storage of pdf render results - default: cfg -> false
  shop_bucket_key_delimiter:          'urn:restorecommerce:shop:setting:invoice:bucket:key:delimiter',  // [char]: delimiter used for generated bucket keys - default: cfg -> '/'
  shop_bucket_endpoint:               'urn:restorecommerce:shop:setting:invoice:bucket:endpoint',       // [string] endpoint to bucket server (incl. protocol and ports if needed) -> default: cfg -> null
  shop_pdf_render_options:            'urn:restorecommerce:shop:setting:invoice:pdf:render:options',    // [json]: override pdf rendering options - default: cfg -> null
  shop_pdf_render_strategy:           'urn:restorecommerce:shop:setting:invoice:pdf:render:strategy',   // [enum]: override pdf rendering strategy - default: cfg -> INLINE
  shop_puppeteer_options:             'urn:restorecommerce:shop:setting:invoice:puppeteer:options',     // [json]: override pdf puppeteer options - default: cfg -> null
  shop_puppeteer_wait:                'urn:restorecommerce:shop:setting:invoice:puppeteer:wait',        // [json]: override pdf puppeteer wait - default: cfg -> null
  shop_email_render_options:          'urn:restorecommerce:shop:setting:invoice:email:render:options',  // [json]: override email rendering options - default: cfg -> null
  shop_email_render_strategy:         'urn:restorecommerce:shop:setting:invoice:email:render:strategy', // [enum]: override email rendering strategy - default: cfg -> INLINE
  shop_email_provider:                'urn:restorecommerce:shop:setting:invoice:email:provider',        // [string]: override to supported email provider - default: cfg -> null
  shop_email_cc:                      'urn:restorecommerce:shop:setting:invoice:email:cc',              // [string]: add recipients in CC (comma separated) - default: cfg -> null
  shop_email_bcc:                     'urn:restorecommerce:shop:setting:invoice:email:bcc',             // [string]: add recipients in BC (comma separated) - default: cfg -> null
  shop_invoice_number_start:          'urn:restorecommerce:shop:setting:invoice:number:start',          // [number]: start for invoice number counter if no counter is given or smaller - default: cfg -> 0
  shop_invoice_number_increment:      'urn:restorecommerce:shop:setting:invoice:number:increment',      // [number]: increment for invoice number counter - default: cfg -> 1
  shop_invoice_number_pattern:        'urn:restorecommerce:shop:setting:invoice:number:pattern',        // [number]: pattern for invoice number using sprintf syntax - default: cfg -> 'invoice-%010i'
  shop_locales:                       'urn:restorecommerce:shop:setting:locales',                       // [string]: list of locales in descending preference (comma separated) - default: cfg -> 'en'
  customer_locales:                   'urn:restorecommerce:customer:setting:locales',                   // [string]: list of locales in descending preference (comma separated) - default: cfg -> 'en'
  customer_email_cc:                  'urn:restorecommerce:customer:setting:invoide:email:cc',          // [string]: add recipients in CC (comma separated) - default: cfg -> null
  customer_email_bcc:                 'urn:restorecommerce:customer:setting:invoide:email:bcc',         // [string]: add recipients in BC (comma separated) - default: cfg -> null
};

export type KnownUrns = typeof DefaultUrns;
export type ProductNature = PhysicalProduct | VirtualProduct | ServiceProduct;
export type ProductVariant = PhysicalVariant | VirtualVariant | ServiceVariant;
export type PositionProduct = ProductVariant | Bundle;
export type AggregatedPosition = Position & {
  product: PositionProduct;
};

export type InvoiceAggregationTemplate = {
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
  fulfillment_products?: ResourceMap<FulfillmentProduct>;
  locales?: ResourceMap<Locale>;
  timezones?: ResourceMap<Timezone>;
  currencies?: ResourceMap<Currency>;
  templates?: ResourceMap<Template>;
  settings?: ResourceMap<Setting>;
};
export const InvoiceAggregationTemplate = {} as InvoiceAggregationTemplate;

export type AggregatedInvoiceList = Aggregation<InvoiceList, InvoiceAggregationTemplate>;

const parseList = (value: string) => value?.split(/\s*,\s*/)
const SettingParser: { [key: string]: (value: string) => any } = {
  shop_html_bucket_options: JSON.parse,
  shop_pdf_bucket_options: JSON.parse,
  shop_pdf_render_options: JSON.parse,
  shop_puppeteer_options: JSON.parse,
  shop_puppeteer_wait: Number.parseInt,
  shop_invoice_number_start: Number.parseInt,
  shop_invoice_number_increment: Number.parseInt,
  shop_email_render_options: JSON.parse,
  shop_locales: parseList,
  shop_email_cc: parseList,
  shop_email_bcc: parseList,
  customer_locales: parseList,
  customer_email_cc: parseList,
  customer_email_bcc: parseList,
};
export const parseSetting = (key: string, value: string) => {
  const parser = SettingParser[key];
  if (parser) {
    return parser(value);
  }
  else {
    return value;
  }
}

export const DefaultSetting = {
  shop_default_bucket: 'invoices',
  shop_html_bucket: undefined as string,
  shop_html_bucket_options: undefined as any,
  shop_html_bucket_disabled: false,
  shop_pdf_bucket: undefined as string,
  shop_pdf_bucket_options: undefined as any,
  shop_pdf_bucket_disabled: false,
  shop_pdf_render_options: undefined as any,
  shop_pdf_render_strategy: RenderRequest_Strategy.INLINE,
  shop_puppeteer_options: undefined as any,
  shop_puppeteer_wait: undefined as number,
  shop_email_render_options: undefined as any,
  shop_email_render_strategy: RenderRequest_Strategy.INLINE,
  shop_email_provider: undefined as string,
  shop_email_cc: undefined as string[],
  shop_email_bcc: undefined as string[],
  shop_invoice_number_start: 0,
  shop_invoice_number_increment: 1,
  shop_invoice_number_pattern: 'invoice-%010i',
  shop_locales: ['en'] as string[],
  shop_bucket_key_delimiter: '/',
  shop_bucket_endpoint: 'localhost:5000/storage',
  customer_locales: ['en'] as string[],
  customer_email_cc: undefined as string[],
  customer_email_bcc: undefined as string[],
};
export type ResolvedSetting = typeof DefaultSetting;

export type InvoiceNumber = {
  id?: string;
  shop_id?: string;
  increment?: number;
  invoice_number?: string;
};

export const makeID = () => randomUUID().replaceAll('-', '');

const mergeProductVariantRecursive = (
  nature: ProductNature,
  variant_id: string
): ProductVariant => {
  const variant = nature?.templates?.find(
    v => v.id === variant_id
  ) ?? nature?.variants?.find(
    v => v.id === variant_id
  );
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

const mergeProductVariant = (
  product: IndividualProduct,
  variant_id: string
): IndividualProduct => {
  const key = Object.keys(product).find(
    key => ['physical', 'virtual', 'service'].includes(key)
  ) as 'physical' | 'virtual' | 'service';
  const nature = product[key];
  const variant = mergeProductVariantRecursive(nature, variant_id);
  return {
    ...product,
    [key]: {
      variants: [variant]
    }
  }
};

export function resolve<T, M extends ResolverMap>(
  entity: T,
  resolverMap?: M,
): Resolved<T & M, M>;
export function resolve<T, M extends ResolverMap>(
  entity: T[],
  resolverMap?: M[],
): Resolved<T & M, M>[] {
  if (!entity) {
    return;
  }
  else if (Array.isArray(entity)) {
    return entity.map(value => resolve(value, resolverMap[0]));
  }
  else {
    const copy = { ...(entity as any) };
    return Object.assign(
      copy,
      ...Object.entries(resolverMap ?? {}).map(
        ([k, r]) => {
          const id = typeof r?.[0] === 'string' && copy[r[0]];
          if (!id) {
            return {
              [k]: r?.[2] ? resolve(copy[k], r[2]) : resolve(copy[k], r)
            };
          }
          else if (Array.isArray(id)) {
            return {
              [k]: id.map(
                id => r[2]
                  ? resolve(r[1]?.get(id.toString()), r[2])
                  : r[1]?.get(id.toString())
              )
            };
          }
          else if (typeof id === 'string') {
            return {
              [k]: r[2]
                ? resolve(r[1]?.get(id), r[2])
                : r[1]?.get(id)
            };
          }
        }
      ).filter(e => e)
    );
  }
};

export const resolveInvoice = (
  aggregation: AggregatedInvoiceList,
  invoice: Invoice,
) => {
  const country_resolver = Resolver('country_id', aggregation.countries);
  const currency_resolver = Resolver(
    'currency_id',
    aggregation.currencies,
    {
      countries: ArrayResolver('country_ids', aggregation.countries),
    }
  );
  const address_resolver = Resolver(
    'address_id',
    aggregation.addresses,
    {
      country: country_resolver,
    }
  );
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
  const tax_resolver = Resolver(
    'tax_id',
    aggregation.taxes,
    {
      type: Resolver('type_id', aggregation.tax_types),
    }
  );
  const amount_resolver = {
    currency: currency_resolver,
    vats: [{
      tax: tax_resolver
    }]
  };
  const fulfillment_product_resolver = {
    product: Resolver(
      'product_id',
      aggregation.fulfillment_products,
      {
        tax: tax_resolver,
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
    amounts: [amount_resolver],
  }];

  const resolved = resolve(
    invoice,
    {
      sender: {
        address: address_resolver
      },
      recipient: {
        address: address_resolver
      },
      billing_address: {
        address: address_resolver
      },
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
      sections: section_resolver,
      total_amounts: [amount_resolver],
    }
  );

  resolved.sections?.forEach(
    (section: typeof resolved.sections[0]) => section.positions?.forEach(
      (position: typeof section.positions[0]) => {
        const product = position.product_item?.product;
        if (product?.product) {
          position.product_item.product = {
            ...product,
            product: mergeProductVariant(
              product.product,
              position.product_item.variant_id
            )
          };
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

export const packRenderData = (
  aggregation: AggregatedInvoiceList,
  invoice: Invoice,
) => {
  const resolved = {
    invoice: resolveInvoice(
      aggregation,
      invoice
    ),
  };
  const buffer = marshallProtobufAny(resolved);
  return buffer;
};