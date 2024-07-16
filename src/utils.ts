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
  type CallContext
} from 'nice-grpc-common';
import { type Logger } from '@restorecommerce/logger';
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
import { Subject } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
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
  ShopListResponse,
  ShopResponse,
  ShopServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/shop.js';
import {
  CustomerResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/customer.js';
import {
  OrganizationResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/organization.js';
import {
  ContactPointResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/contact_point.js';
import {
  AddressResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/address.js';
import {
  CountryResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/country.js';
import {
  UserResponse,
  UserServiceDefinition,
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
  ManufacturerResponse,
  ManufacturerServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/manufacturer.js';
import {
  Tax,
  TaxResponse,
  TaxServiceDefinition,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/tax.js';
import {
  FulfillmentProductResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product.js';
import {
  type Aggregation,
  resolve,
  ResourceAggregator,
  ResponseMap,
} from './experimental/ResourceAggregator.js';

export type ProductNature = PhysicalProduct | VirtualProduct | ServiceProduct;
export type ProductVariant = PhysicalVariant | VirtualVariant | ServiceVariant;
export type PositionProduct = ProductVariant | Bundle;
export type AggregatedPosition = Position & {
  product: PositionProduct;
};

export type AggregationTemplate = {
  shops?: ResponseMap<ShopResponse>;
  customers?: ResponseMap<CustomerResponse>;
  organizations?: ResponseMap<OrganizationResponse>;
  contact_points?: ResponseMap<ContactPointResponse>;
  addresses?: ResponseMap<AddressResponse>;
  countries?: ResponseMap<CountryResponse>;
  users?: ResponseMap<UserResponse>;
  products?: ResponseMap<ProductResponse>;
  taxes?: ResponseMap<TaxResponse>;
  manufacturers?: ResponseMap<ManufacturerResponse>;
  fulfillments_products?: ResponseMap<FulfillmentProductResponse>;
};

export type AggregatedInvoice = Aggregation<InvoiceList, AggregationTemplate>;

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

export const extractInvoiceDetails = (
  invoice: Invoice
) => {
  const clone = {
    ...invoice
  };
  delete clone.meta;
  delete clone.documents;
  delete clone.sections;
  return clone;
};

private mergeProductVariantRecursive(
  nature: ProductNature,
  variant_id: string,
): ProductVariant {
  const variant = nature?.variants?.find(v => v.id === variant_id);
  if (variant?.parent_variant_id) {
    const template = this.mergeProductVariantRecursive(
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

private mergeProductVariant(
  product: IndividualProduct,
  variant_id: string,
): ProductVariant {
  const nature = product.physical ?? product.virtual ?? product.service;
  const variant = this.mergeProductVariantRecursive(nature, variant_id);

  return {
    ...product,
    ...variant,
  };
};

private aggregatePosition(
  aggregation: AggregatedInvoice,
  position: Position,
): AggregatedPosition {
  const product = position.product_item && aggregation.products.get(
    position.product_item.product_id
  );
  const variant = product.payload.product && this.mergeProductVariant(
    product.payload.product,
    position.product_item.variant_id
  );

  return {
    ...position,
    product: variant && product.payload.bundle
  };
};

private extractShopConfigs(
  aggregation: AggregatedInvoice,
  shop_id: string
) {
  const shop = aggregation.shops.get(shop_id)!.payload;
  const options = Object.assign({},
    ...shop.settings.filter(
      s => s.id === this.urns.render_options
    ).map(
      s => JSON.parse(s.value)
    )
  );
  const templates = Buffer.from(
    JSON.stringify(
      Object.assign({},
        ...shop.settings.filter(
          s => s.id === this.urns.pdf_template_url
        ).map(
          (s, i) => ({ [i]: s.value })
        )
      )
    )
  );
  const strategy = shop.settings.find(
    s => s.id === this.urns.render_strategy
  )?.value ?? Payload_Strategy.INLINE;
  const style_url = shop.settings.find(
    s => s.id ===this.urns.render_style
  )?.value;

  return {
    options,
    templates,
    strategy,
    style_url,
  };
};

const resolveInvoice = (
  aggregation: AggregatedInvoice,
  invoice: Invoice,
) => resolve(
  invoice,
  {
    customer: ['customer', aggregation.customers, {
      test: ['something', aggregation.customers, {}]
    }],
    shop_id: ['shop', aggregation.shops],
    user_id: ['user', aggregation.users],
    organization_id: ['organization', aggregation.organizations],
    contact_point_ids: ['contact_points', aggregation.contact_points],
    country_id: ['country', aggregation.countries],
    address_id: ['address', aggregation.addresses],
    product_id: ['product', aggregation.products],
  }
);

export const resolveRenderData = (
  aggregation: AggregatedInvoice,
  invoice: Invoice,
) => Buffer.from(
  JSON.stringify({
    invoice: resolveInvoice(
      aggregation,
      invoice,
    ),
    config: resolveShopConfig(
      aggregation,
      invoice.shop_id,
    )
  })
);