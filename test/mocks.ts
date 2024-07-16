import {
  Response,
  Response_Decision,
  ReverseQuery,
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/access_control.js';
import {
  InvoiceList,
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/invoice.js';
import { 
  ProductListResponse,
  ProductResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/product.js';
import {
  OrganizationListResponse,
  OrganizationResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/organization.js';
import {
  ContactPointListResponse,
  ContactPointResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/contact_point.js';
import {
  AddressListResponse,
  BillingAddress,
  ShippingAddress
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/address.js';
import {
  CountryListResponse,
  CountryResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/country.js';
import {
  TaxListResponse,
  TaxResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/tax.js';
import {
  TaxTypeListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/tax_type.js';
import {
  PackingSolutionListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/fulfillment_product.js';
import {
  UserListResponse,
  UserResponse,
  UserType
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/user.js';
import {
  ShopListResponse,
  ShopResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/shop.js';
import {
  CustomerListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/customer.js';
import {
  FulfillmentListResponse,
  FulfillmentResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/fulfillment.js';
import {
  OperationStatus
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/status.js';
import {
  InvoiceListResponse,
  PaymentState
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/invoice.js';
import {
  Effect
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/rule.js';
import {
  Subject
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/auth.js';
import {
  HierarchicalScope
} from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/auth.js';
import {
  getRedisInstance,
  logger
} from './utils.js';
import { FulfillmentProductListResponse } from '@restorecommerce/rc-grpc-clients/dist/generated-server/io/restorecommerce/fulfillment_product.js';

type Address = ShippingAddress & BillingAddress;

const mainMeta = {
  modifiedBy: 'SYSTEM',
  acls: [],
  created: new Date(),
  modified: new Date(),
  owners: [
    {
      id: 'urn:restorecommerce:acs:names:ownerIndicatoryEntity',
      value: 'urn:restorecommerce:acs:model:organization.Organization',
      attributes: [
        {
          id: 'urn:restorecommerce:acs:names:ownerInstance',
          value: 'main',
          attributes: []
        }
      ]
    },
  ]
};

const subjects: { [key: string]: Subject } = {
  superadmin: {
    id: 'superadmin',
    scope: 'main',
    token: 'superadmin',
  },
  admin: {
    id: 'admin',
    scope: 'sub',
    token: 'admin',
  },
};

const operationStatus: OperationStatus = {
  code: 200,
  message: 'OK',
};

const residentialAddresses: Address[] = [{
  address: {
    id: 'address_1',
    residentialAddress: {
      title: 'Mr.',
      givenName: 'Jack',
      familyName: 'Black',
    },
    street: 'Some Where',
    buildingNumber: '66',
    countryId: 'germany',
  },
  contact: {
    email: 'user@test.spec',
    name: 'Jack Black',
    phone: '00000000000'
  },
  comments: 'Drop it at the backdoor',
}];

const businessAddresses: Address[] = [{
  address: {
    id: 'address_2',
    businessAddress: {
      name: 'Restorecommerce GmbH',
    },
    street: 'Somewhere',
    buildingNumber: '66',
    countryId: 'germany'
  },
  contact: {
    email: 'info@restorecommerce.io'
  }
}];

const countries: CountryResponse[] = [{
  payload: {
    id: 'germany',
    countryCode: 'DE',
    name: 'Deutschland',
    geographicalName: 'Germany',
    economicAreas: [],
  },
  status: {
    id: 'germany',
    code: 200,
    message: 'OK',
  }
}];

const taxes: TaxResponse[] = [
  {
    payload: {
      id: 'tax_1',
      countryId: 'germany',
      rate: 0.19,
      typeId: 'taxType_1',
      variant: 'MwSt.'
    },
    status: {
      id: 'tax_1',
      code: 200,
      message: 'OK'
    }
  }
]

const products: ProductResponse[] = [
  {
    payload: {
      id: 'physicalProduct_1',
      active: true,
      shopId: 'shop_1',
      tags: [],
      associations: [],
      product: {
        name: 'Physical Product 1',
        description: 'This is a physical product',
        manufacturerId: 'manufacturer_1',
        taxIds: [
          taxes[0].payload?.id as string,
        ],
        physical: {
          variants: [
            {
              id: '1',
              name: 'Physical Product 1 Blue',
              description: 'This is a physical product in blue',
              price: {
                currencyId: 'currency_1',
                regularPrice: 9.99,
                salePrice: 8.99,
                sale: false,
              },
              images: [],
              files: [],
              stockKeepingUnit: '123456789',
              stockLevel: 300,
              package: {
                sizeInCm: {
                  height: 10,
                  length: 20,
                  width: 15,
                },
                weightInKg: 0.58,
                rotatable: true,
              },
              properties: [
                {
                  id: 'urn:product:property:color:main:name',
                  value: 'blue',
                  unitCode: 'text',
                },
                {
                  id: 'urn:product:property:color:main:value',
                  value: '#0000FF',
                  unitCode: '#RGB',
                }
              ],
            },
            {
              id: '2',
              name: 'Physical Product 1 Red',
              description: 'This is a physical product in red',
              images: [],
              files: [],
              properties: [
                {
                  id: 'urn:product:property:color:main:name',
                  value: 'red',
                  unitCode: 'text',
                },
                {
                  id: 'urn:product:property:color:main:value',
                  value: '#FF0000',
                  unitCode: '#RGB',
                }
              ],
              parentVariantId: '1',
            }
          ]
        }
      },
    },
    status: {
      id: 'physicalProduct_1',
      code: 200,
      message: 'OK',
    }
  },
];

const contactPoints = [
  {
    payload: {
      id: 'contactPoint_1',
      contactPointTypeIds: [
        'legal'
      ],
      name: 'Contact Point 1',
      description: 'A mocked Contact Point for testing',
      email: 'info@shop.com',
      localeId: 'localization_1',
      physicalAddressId: businessAddresses[0].address?.id,
      telephone: '0123456789',
      timezoneId: 'timezone_1',
      website: 'www.shop.com',
    },
    status: {
      id: 'contactPoint_1',
      code: 200,
      message: 'OK',
    }
  }
] as ContactPointResponse[];

const organizations = [
  {
    payload: {
      id: 'organization_1',
      contactPointIds: [
        contactPoints[0].payload?.id,
      ],
      paymentMethodIds: [],
    },
    status: {
      id: 'organization_1',
      code: 200,
      message: 'OK',
    },
  }
] as OrganizationResponse[];

const shops = [
  {
    payload: {
      id: 'shop_1',
      name: 'Shop1',
      description: 'a mocked shop for unit tests',
      domain: 'www.shop.com',
      organizationId: organizations[0].payload?.id,
      shopNumber: '0000000001',
    },
    status: {
      id: 'shop_1',
      code: 200,
      message: 'OK',
    }
  }
] as ShopResponse[];

const validInvoices: { [key: string]: InvoiceList } = {
  'as superadmin': {
    items: [
      {
        id: 'validInvoice_1',
        userId: 'userId_1',
        customerId: 'customerId_1',
        shopId: 'invalid_shop_1',
        sender: businessAddresses[0],
        recipient: residentialAddresses[0],
        documents: [],
        sections: [
          {
            id: '000',
            positions: [
              {
                id: '000',
                productItem: {
                  productId: 'physicalProduct_1',
                  variantId: '1',
                },
                amount: {
                  currencyId: 'euro',
                  gross: 8.99,
                  net: 8.99,
                  vats: [
                    {
                      taxId: 'tax_1',
                      vat: 0,
                    }
                  ]
                }
              }
            ]
          }
        ],
      }
    ],
    totalCount: 1,
    subject: subjects.superadmin,
  },
};

const users: { [key: string]: UserResponse } = {
  superadmin: {
    payload: {
      id: 'superadmin',
      name: 'manuel.mustersuperadmin',
      first_name: 'Manuel',
      last_name: 'Mustersuperadmin',
      email: 'manuel.mustersuperadmin@restorecommerce.io',
      password: 'A$1rcadminpw',
      default_scope: 'r-ug',
      role_associations: [
        {
          id: 'superadmin-1-administrator-r-id',
          role: 'superadministrator-r-id',
          attributes: [],
        },
      ],
      locale_id: 'de-de',
      timezone_id: 'europe-berlin',
      active: true,
      user_type: UserType.ORG_USER,
      tokens: [
        {
          token: 'superadmin',
        }
      ],
      meta: mainMeta,
    },
    status: {
      id: 'superadmin',
      code: 200,
      message: 'OK',
    }
  },
  admin: {
    payload: {
      id: 'admin',
      name: 'manuel.musteradmin',
      first_name: 'Manuel',
      last_name: 'Musteradmin',
      email: 'manuel.musteradmin@restorecommerce.io',
      password: 'A$1rcadminpw',
      default_scope: 'sub',
      role_associations: [
        {
          id: 'admin-1-administrator-r-id',
          role: 'administrator-r-id',
          attributes: [
            {
              id: 'urn:restorecommerce:acs:names:roleScopingEntity',
              value: 'urn:restorecommerce:acs:model:organization.Organization',
              attributes: [
                {
                  id: 'urn:restorecommerce:acs:names:roleScopingInstance',
                  value: 'sub',
                }
              ],
            }
          ],
        },
      ],
      locale_id: 'de-de',
      timezone_id: 'europe-berlin',
      active: true,
      user_type: UserType.ORG_USER,
      tokens: [
        {
          token: 'admin',
        }
      ],
      meta: mainMeta,
    },
    status: {
      id: 'admin',
      code: 200,
      message: 'OK',
    }
  },
};

const hierarchicalScopes: { [key: string]: HierarchicalScope[] } = {
  superadmin: [
    {
      id: 'main',
      role: 'superadministrator-r-id',
      children: [
        {
          id: 'sub',
        }
      ]
    }
  ],
  admin: [
    {
      id: 'sub',
      role: 'administrator-r-id',
    }
  ]
};

const whatIsAllowed: ReverseQuery = {
  policySets: [
    {
      id: 'policy_set',
      combiningAlgorithm: 'urn:oasis:names:tc:xacml:3.0:rule-combining-algorithm:permit-overrides',
      effect: Effect.DENY,
      policies: [
        {
          id: 'policy_superadmin_permit_all',
          combiningAlgorithm: 'urn:oasis:names:tc:xacml:3.0:rule-combining-algorithm:permit-overrides',
          effect: Effect.DENY,
          target: {
            subjects: [
              {
                id: 'urn:restorecommerce:acs:names:role',
                value: 'superadministrator-r-id',
              },
            ],
          },
          rules: [{
            effect: Effect.PERMIT,
            target: {
              subjects: [
                {
                  id: 'urn:restorecommerce:acs:names:role',
                  value: 'superadministrator-r-id',
                },
              ],
            },
          }],
          hasRules: true,
        },{
          id: 'policy_admin_permit_all_by_scope',
          combiningAlgorithm: 'urn:oasis:names:tc:xacml:3.0:rule-combining-algorithm:permit-overrides',
          effect: Effect.DENY,
          target: {
            subjects: [
              {
                id: 'urn:restorecommerce:acs:names:role',
                value: 'administrator-r-id',
              },
            ],
          },
          rules: [{
            id: 'admin_can_do_all_by_scope',
            effect: Effect.PERMIT,
            target: {
              subjects: [
                {
                  id: 'urn:restorecommerce:acs:names:role',
                  value: 'administrator-r-id',
                },
                {
                  id: 'urn:restorecommerce:acs:names:roleScopingEntity',
                  value: 'urn:restorecommerce:acs:model:organization.Organization',
                },
              ],
            },
          }],
          hasRules: true
        },
      ]
    },
  ],
  operationStatus,
};

export const fulfillmentProducts: FulfillmentProductListResponse = {

}

export const samples = {
  residentialAddresses,
  businessAddresses,
  invoices: {
    valid: validInvoices,
  },
};

export const rules: { [key: string]: any } = {
  'acs-srv': {
    isAllowed: (
      call: any,
      callback: (error: any, response: Response) => void,
    ) => callback(null, {
      decision: Response_Decision.PERMIT,
    }),
    whatIsAllowed: (
      call: any,
      callback: (error: any, response: ReverseQuery) => void,
    ) => callback(null, whatIsAllowed),
  },
  user: {
    read: (
      call: any,
      callback: (error: any, response: UserListResponse) => void,
    ) => callback(null, {}),
    findByToken: (
      call: any,
      callback: (error: any, response: UserResponse) => void,
    ) => {
      getRedisInstance().then(
        async client => {
          const subject = users[call.request.token];
          await client.set(
            `cache:${ subject.payload?.id }:subject`,
            JSON.stringify(subject.payload),
          );
          await client.set(
            `cache:${ subject.payload?.id }:hrScopes`,
            JSON.stringify(hierarchicalScopes[call.request.token]),
          );
          return subject;
        },
      ).then(
        subject => callback(null, subject),
        error => logger.error(error),
      );
    }
  },
  shop: {
    read: (
      call: any,
      callback: (error: any, response: ShopListResponse) => void,
    ) => callback(null, {
      items: shops,
      totalCount: shops.length,
      operationStatus
    }),
  },
  organization: {
    read: (
      call: any,
      callback: (error: any, response: OrganizationListResponse) => void,
    ) => callback(null, {
      items: organizations,
      totalCount: organizations.length,
      operationStatus,
    })
  },
  customer: {
    read: (
      call: any,
      callback: (error: any, response: CustomerListResponse) => void,
    ) => callback(null, {
      items: [
        {
          payload: {
            id: 'customer_1',
            private: {
              userId: 'user_1',
              contactPointIds: [
                'cantactPoint_1'
              ],
            },
          },
          status: {
            id: 'customer_1',
            code: 200,
            message: 'OK',
          }
        }
      ],
      totalCount: 1,
      operationStatus
    }),
  },
  contact_point: {
    read: (
      call: any,
      callback: (error: any, response: ContactPointListResponse) => void,
    ) => callback(null, {
      items: contactPoints,
      totalCount: contactPoints.length,
      operationStatus,
    })
  },
  address: {
    read: (
      call: any,
      callback: (error: any, response: AddressListResponse) => void,
    ) => callback(null, {
      items: [
        ...residentialAddresses,
        ...businessAddresses,
      ].map(item => ({
        payload: item.address,
        status: {
          id: item.address?.id,
          code: 200,
          message: 'OK',
        }
      })),
      totalCount: residentialAddresses.length + businessAddresses.length,
      operationStatus,
    })
  },
  country: {
    read: (
      call: any,
      callback: (error: any, response: CountryListResponse) => void,
    ) => callback(null, {
      items: countries,
      totalCount: countries.length,
      operationStatus,
    }),
  },
  product: {
    read: (
      call: any,
      callback: (error: any, response: ProductListResponse) => void,
    ) => callback(null, {
      items: products,
      totalCount: products.length,
      operationStatus,
    }),
  },
  tax: {
    read: (
      call: any,
      callback: (error: any, response: TaxListResponse) => void,
    )=> callback(null, {
      items: taxes,
      totalCount: 1,
      operationStatus
    }),
  },
  tax_type: {
    read: (
      call: any,
      callback: (error: any, response: TaxTypeListResponse) => void,
    ) => callback(null, {
      items: [
        {
          payload: {
            id: 'taxType_1',
            type: 'MwSt.',
            description: 'Standard Mehrwert Steuer',
          },
          status: {
            id: 'taxType_1',
            code: 200,
            message: 'OK',
          }
        }
      ],
      totalCount: 1,
      operationStatus
    }),
  },
  fulfillment_product: {
    read: (
      call: any,
      callback: (error: any, response: FulfillmentListResponse) => void,
    ) => callback(null, fulfillmentProducts),
  },
};