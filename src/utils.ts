import {
  Invoice,
  InvoiceServiceImplementation,
  InvoiceListResponse,
  InvoiceList,
  InvoiceIdList,
  RequestInvoiceNumber,
  InvoiceNumberResponse,
  ManualItem,
  Position,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/invoice.js';
import {
  OperationStatus,
  StatusListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/status.js';
import {
  DeleteRequest,
  DeleteResponse,
  ReadRequest,
  Sort_SortOrder
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/resource_base.js';
import {
  ACSClientContext,
  AuthZAction,
  DefaultACSClientContextFactory,
  DefaultResourceFactory,
  Operation,
  access_controlled_function,
  access_controlled_service,
  injects_meta_data,
} from '@restorecommerce/acs-client';
import {
  Subject
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import {
  Payload_Strategy,
  RenderRequest,
  RenderResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/rendering.js';
import {
  PdfRenderingServiceDefinition,
  RenderingResponse as PdfRenderResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/pdf_rendering.js';
import {
  NotificationReqServiceDefinition,
  NotificationReq,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/notification_req.js';
import {
  ObjectServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/ostorage.js';
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
  ProductResponse,
  ProductServiceDefinition,
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
  type Aggregation,
  resolve,
  Resolver,
  ArrayResolver,
  ResourceAggregator,
  ResourceMap,
} from './experimental/ResourceAggregator.js';

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
};

export type AggregatedInvoiceList = Aggregation<InvoiceList, AggregationTemplate>;

export type Setting = {
  access_control_subject?: Subject;
  default_bucket?: string;
  invoice_html_bucket?: string;
  invoice_pdf_bucket?: string;
  disable_invoice_html_storage?: string;
  disable_invoice_pdf_storage?: string;
  invoice_html_bucket_options?: any;
  invoice_pdf_bucket_options?: any;
  puppeteer_options?: any;
  email_provider?: string;
  email_subject_template?: string;
  email_in_cc?: string[];
};

export type KnownUrns = {
  access_control_subject?: string;
  render_options?: string;
  render_strategy?: string;
  render_style?: string;
  render_template?: string;
  pdf_template_id?: string;
  pdf_template_url?: string;
  email_template_id?: string;
  email_template_url?: string;
  email_provider?: string;
  email_in_cc?: string;
  email_subject_template?: string;
  default_bucket?: string;
  invoice_html_bucket?: string;
  invoice_html_bucket_options?: string;
  invoice_pdf_bucket?: string;
  invoice_pdf_bucket_options?: string;
  invoice_pdf_puppeteer_options?: string;
  enable_invoice_html_storage?: string;
  enable_invoice_pdf_storage?: string;
  invoice_number_start?: string;
  invoice_number_increment?: string;
  invoice_number_pattern?: string;
};

export type InvoiceNumber = {
  id?: string;
  shop_id?: string;
  increment?: number;
  invoice_number?: string;
};

const resolveShopConfig = (
  aggregation: AggregatedInvoiceList,
  shop_id: string,
  urns: KnownUrns,
) => {
  const shop = aggregation.shops.get(shop_id);
  const options = Object.assign({},
    ...shop.settings.filter(
      s => s.id === urns.render_options
    ).map(
      s => JSON.parse(s.value)
    )
  );
  const templates = Buffer.from(
    JSON.stringify(
      Object.assign({},
        ...shop.settings.filter(
          s => s.id === urns.pdf_template_url
        ).map(
          (s, i) => ({ [i]: s.value })
        )
      )
    )
  );
  const strategy = shop.settings.find(
    s => s.id === urns.render_strategy
  )?.value ?? Payload_Strategy.INLINE;
  const style_url = shop.settings.find(
    s => s.id ===urns.render_style
  )?.value;

  return {
    options,
    templates,
    strategy,
    style_url,
  };
};

const resolveInvoice = (
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
  }
  const product_resolver = Resolver(
    'product_id',
    aggregation.products,
    {
      product: individual_product_resolver,
      bundle: {
        products: [{
          product: Resolver(
            'product_id',
            aggregation.products,
            individual_product_resolver
          )
        }]
      }
    }
  );
  const currency_resolver = Resolver('currency_id', aggregation.currencies),
  const tax_resolver = Resolver('tax_id', aggregation.taxes, {
    type: Resolver('type_id', aggregation.tax_types),
  });
  const amount_resolver = {
    currency: currency_resolver,
    vats: [{
      tax: tax_resolver
    }]
  };
  const fulfillment_prodyct_resolver = {
    product: Resolver(
      'product_id',
      aggregation.fulfillments_products,
      {
        tax: tax_resolver,
        country: Resolver('country_id', aggregation.countries),
      }
    ),
  }

  return resolve(
    invoice,
    {
      customer: Resolver('customer_id', aggregation.customers, {
        commercial: organization_resolver,
        public_sector: organization_resolver,
        private: {
          user: user_resolver,
          contact_points: contact_points_resolver
        },
      }),
      shop: Resolver('shop_id', aggregation.shops, {
        organization: organization_resolver
      }),
      user: user_resolver,
      sections: [{
        positions: [{
          product_item: {
            product: product_resolver,
          },
          fulfillment_item: fulfillment_prodyct_resolver,
          amount: amount_resolver,
          unit_price: {
            currency: currency_resolver,
          }
        }],
        amounts: [
          amount_resolver
        ]
      }]
    }
  );
}

export const resolveRenderData = (
  aggregation: AggregatedInvoiceList,
  invoice: Invoice,
  urns: KnownUrns,
) => Buffer.from(
  JSON.stringify({
    invoice: resolveInvoice(aggregation, invoice),
    config: resolveShopConfig(
      aggregation,
      invoice.shop_id,
      urns,
    )
  })
);