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
  ManufacturerListResponse,
  ManufacturerResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/manufacturer.js';
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
  TemplateListResponse,
  TemplateUseCase
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/template.js';
import {
  SettingListResponse,
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/setting.js';
import {
  UserListResponse,
  UserResponse,
  UserType
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/user.js';
import {
  ShopListResponse,
  ShopResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/shop.js';
import {
  CustomerListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/customer.js';
import {
  OperationStatus
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/status.js';
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
  FulfillmentCourierListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/fulfillment_courier.js';
import {
  FulfillmentProductListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/fulfillment_product.js';
import {
  CurrencyListResponse
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/currency.js';
import {
  Status
} from '@restorecommerce/rc-grpc-clients/dist/generated/io/restorecommerce/status.js';
import {
  getRedisInstance,
  logger
} from './utils.js';

type Address = ShippingAddress & BillingAddress;

const status: Status = {
  code: 200,
  message: 'OK',
}

const meta = {
  modifiedBy: 'SYSTEM',
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
  'root-tech-user': {
    id: 'root-tech-user',
    token: '1a4c6789-6435-487a-9308-64d06384acf9',
  },
  superadmin: {
    id: 'superadmin',
    //scope: 'main',
    token: 'superadmin',
  },
  admin: {
    id: 'admin',
    //scope: 'sub',
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
    postcode: '789456',
    region: 'Baden Wuettemberg',
    locality: 'Stuttgart',
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
    street: 'Some Where',
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
    meta,
  },
  status: {
    id: 'germany',
    code: 200,
    message: 'OK',
  }
}];

const currencies: CurrencyListResponse = {
  items: [{
    payload: {
      id: 'EUR',
      countryIds: ['germany'],
      name: 'Euro',
      precision: 2,
      symbol: 'EUR',
      meta,
    },
    status,
  }],
  operationStatus,
};

const taxes: TaxResponse[] = [
  {
    payload: {
      id: 'tax_1',
      name: 'MwSt.',
      countryId: 'germany',
      rate: 0.19,
      typeId: 'taxType_1',
      variant: 'MwSt.',
      meta,
    },
    status: {
      id: 'tax_1',
      code: 200,
      message: 'OK'
    }
  }
];

const manufacturers: ManufacturerResponse[] = [
  {
    payload: {
      id: 'manufacturer_1',
      name: 'Manufacturer1',
      description: 'A manufacturer for testing',
      meta,
    },
    status: {
      id: 'manufacturer_1',
      code: 200,
      message: 'OK',
    }
  }
];

const products: ProductResponse[] = [
  {
    payload: {
      id: 'physicalProduct_1',
      meta,
      active: true,
      shopIds: ['shop_1'],
      tags: [],
      associations: [],
      product: {
        name: 'Physical Product 1',
        description: 'This is a physical product',
        manufacturerId: manufacturers[0].payload!.id,
        taxIds: [
          taxes[0].payload!.id!,
        ],
        physical: {
          variants: [
            {
              id: '1',
              name: 'Physical Product 1 Blue',
              description: 'This is a physical product in blue',
              price: {
                currencyId: 'EUR',
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
    status
  },
];

const contactPoints: ContactPointResponse[] = [
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
    status
  }
];

const organizations = [
  {
    payload: {
      id: 'organization_1',
      contactPointIds: [
        contactPoints[0].payload?.id,
      ],
      paymentMethodIds: [],
    },
    status,
  }
] as OrganizationResponse[];

const shops = [
  {
    payload: {
      id: 'shop_1',
      name: 'Shop1',
      description: 'a mocked shop for unit tests',
      domains: ['www.shop.com'],
      organizationId: organizations[0].payload?.id,
      shopNumber: '0000000001',
      meta,
    },
    status,
  }
] as ShopResponse[];

const validInvoices: { [key: string]: InvoiceList } = {
  'as superadmin': {
    items: [
      {
        id: 'validInvoice_1',
        userId: 'user_1',
        customerId: 'customer_1',
        shopId: shops[0].payload!.id,
        sender: businessAddresses[0],
        recipient: residentialAddresses[0],
        references: [
          {
            instanceType: 'urn:restorecommerce:acs:model:order.Order',
            instanceId: 'valideOrder_1',
          },
          {
            instanceType: 'urn:restorecommerce:acs:model:fulfillment.Fulfillment',
            instanceId: 'valideFulfillment_1',
          },
        ],
        documents: [],
        sections: [
          {
            id: '001',
            positions: [
              {
                id: '001',
                productItem: {
                  productId: 'physicalProduct_1',
                  variantId: '1',
                },
                quantity: 1,
                unitPrice: {
                  currencyId: 'EUR',
                  regularPrice: 9.99,
                  salePrice: 8.99,
                  sale: true,
                },
                amount: {
                  currencyId: 'EUR',
                  gross: 8.99,
                  net: 10.70,
                  vats: [
                    {
                      taxId: 'tax_1',
                      vat: 1.71,
                    }
                  ]
                }
              }
            ],
            amounts: [{
              currencyId: 'EUR',
              gross: 8.99,
              net: 10.70,
              vats: [
                {
                  taxId: 'tax_1',
                  vat: 1.71,
                }
              ]
            }]
          }
        ],
        totalAmounts: [{
          currencyId: 'EUR',
          gross: 8.99,
          net: 10.70,
          vats: [
            {
              taxId: 'tax_1',
              vat: 1.71,
            }
          ]
        }],
        meta: {
          modified: new Date()
        },
      }
    ],
    totalCount: 1,
    subject: subjects.superadmin,
  },
};

const users: { [key: string]: UserResponse } = {
  'root-tech-user': {
    payload: {
      id: 'root-tech-user',
      meta,
    },
    status,
  },
  superadmin: {
    payload: {
      id: 'superadmin',
      name: 'manuel.mustersuperadmin',
      firstName: 'Manuel',
      lastName: 'Mustersuperadmin',
      email: 'manuel.mustersuperadmin@restorecommerce.io',
      password: 'A$1rcadminpw',
      defaultScope: 'r-ug',
      roleAssociations: [
        {
          id: 'superadmin-1-administrator-r-id',
          role: 'superadministrator-r-id',
          attributes: [],
        },
      ],
      localeId: 'de-de',
      timezoneId: 'europe-berlin',
      active: true,
      userType: UserType.ORG_USER,
      tokens: [
        {
          token: 'superadmin',
        }
      ],
      meta,
    },
    status,
  },
  admin: {
    payload: {
      id: 'admin',
      name: 'manuel.musteradmin',
      firstName: 'Manuel',
      lastName: 'Musteradmin',
      email: 'manuel.musteradmin@restorecommerce.io',
      password: 'A$1rcadminpw',
      defaultScope: 'sub',
      roleAssociations: [
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
      localeId: 'de-de',
      timezoneId: 'europe-berlin',
      active: true,
      userType: UserType.ORG_USER,
      tokens: [
        {
          token: 'admin',
        }
      ],
      meta,
    },
    status,
  },
  user_1: {
    payload: {
      id: 'user_1',
      name: 'manuel.musteruser',
      firstName: 'Manuel',
      lastName: 'Musteruser',
      email: 'manuel.musteruser@restorecommerce.io',
      password: 'A$1rcadminpw',
      defaultScope: 'sub',
      roleAssociations: [
        {
          id: 'user-1-user-r-id',
          role: 'user-r-id',
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
      localeId: 'de-de',
      timezoneId: 'europe-berlin',
      active: true,
      userType: UserType.ORG_USER,
      tokens: [
        {
          token: 'user_1',
        }
      ],
      meta,
    },
    status,
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
  ],
  user_1: [
    {
      id: 'sub',
      role: 'user-r-id',
    }
  ]
};

const whatIsAllowed: ReverseQuery = {
  policySets: [
    {
      id: 'policy_set',
      combiningAlgorithm: 'urn:oasis:names:tc:xacml:3.0:rule-combining-algorithm:permit-overrides',
      effect: Effect.PERMIT,
      policies: [
        {
          id: 'policy_superadmin_permit_all',
          combiningAlgorithm: 'urn:oasis:names:tc:xacml:3.0:rule-combining-algorithm:permit-overrides',
          effect: Effect.PERMIT,
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
          effect: Effect.PERMIT,
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

const fulfillmentCouriers: FulfillmentCourierListResponse = {
  items: [
    {
      payload: {
        id: 'dhl_1',
        name: 'DHL',
        description: '',
        logo: 'DHL.png',
        website: 'https://www.dhl.com/',
        api: 'DHLSoap',
        shopIds: [
          'shop_1'
        ],
        meta,
      },
      status,
    },
    {
      payload: {
        id: 'dhl_2',
        name: 'DHL',
        description: '',
        logo: 'DHL.png',
        website: 'https://www.dhl.com/',
        api: 'DHLSoap',
        shopIds: [
          'shop_1'
        ],
        meta,
      },
      status,
    }
  ],
  totalCount: 2,
  operationStatus: {
    code: 200,
    message: 'Mocked!',
  }
};

const templates: TemplateListResponse = {
  items: [
    {
      payload: {
        id: 'template_invoice_body_pdf',
        useCase: TemplateUseCase.INVOICE_PDF,
        bodies: [{
          url: 'file://./templates/invoice_body.hbs',
          contentType: 'text/html',
        }],
        layouts: [{
          url: 'file://./templates/invoice_layout.hbs',
          contentType: 'text/html',
        }],
        localizations: [
          {
            locales: ['en'],
            l10n: {
              url: 'file://./templates/l10n.json',
              contentType: 'application/json',
            }
          }
        ],
      },
      status,
    }
  ],
  totalCount: 1,
  operationStatus: {
    code: 200,
    message: 'Mocked!',
  }
};

const settings: SettingListResponse = {
  totalCount: 0,
  operationStatus: {
    code: 200,
    message: 'Mocked!',
  }
} 

export const fulfillmentProducts: FulfillmentProductListResponse = {
  items: [
    {
      payload: {
        id: 'dhl-1-national',
        name: 'DHL National (Germany)',
        description: 'Versendungen innerhalb Deutschland',
        courierId: fulfillmentCouriers.items![0].payload!.id,
        startZones: ['DE'],
        destinationZones: ['DE'],
        taxIds: [taxes[0].payload?.id as string],
        attributes: [{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:productName',
          value: 'V01PAK',
          attributes: [],
        },{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:accountNumber',
          value: '33333333330102',
          attributes: [],
        }],
        variants: [{
          id: 'dhl-1-national-s',
          name: 'Parcel S up to 2kg',
          description: 'For small parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 3.79,
            salePrice: 3.79,
            sale: false,
          },
          maxSize: {
            height: 35,
            width: 25,
            length: 10,
          },
          maxWeight: 2000,
        },{
          id: 'dhl-1-national-m',
          name: 'Parcel M up to 2kg',
          description: 'For medium sized parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 4.49,
            salePrice: 4.49,
            sale: false,
          },
          maxSize: {
            height: 60,
            width: 30,
            length: 15,
          },
          maxWeight: 2000,
        }],
        meta,
      },
      status,
    },{
      payload: {
        id: 'dhl-1-europe',
        name: 'DHL Europe',
        description: 'Versendungen innerhalb Europas',
        courierId: fulfillmentCouriers.items![0].payload!.id,
        taxIds: [taxes[0].payload?.id as string],
        startZones: ['DE'],
        destinationZones: ['DE'],
        attributes: [{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:productName',
          value: 'V01PAK',
          attributes: [],
        },{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:accountNumber',
          value: '33333333330102',
          attributes: [],
        }],
        variants: [{
          id: 'dhl-1-europe-s',
          name: 'Parcel S up to 2kg',
          description: 'For small sized parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 3.79,
            salePrice: 3.79,
            sale: false,
          },
          maxSize: {
            height: 35,
            width: 25,
            length: 10,
          },
          maxWeight: 2000,
        },{
          id: 'dhl-1-europe-m',
          name: 'Parcel M up to 2kg',
          description: 'For medium sized parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 4.49,
            salePrice: 4.49,
            sale: false,
          },
          maxSize: {
            height: 60,
            width: 30,
            length: 15,
          },
          maxWeight: 2000,
        }],
        meta,
      }
    },{
      payload: {
        id: 'dhl-2-national',
        name: 'DHL National (Germany)',
        description: 'Versendungen innerhalb Deutschland',
        courierId: fulfillmentCouriers.items![1].payload!.id,
        startZones: ['DE'],
        destinationZones: ['DE'],
        taxIds: [taxes[0].payload?.id as string],
        attributes: [{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:productName',
          value: 'V01PAK',
          attributes: [],
        },{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:accountNumber',
          value: '33333333330102',
          attributes: [],
        }],
        variants: [{
          id: 'dhl-2-national-s',
          name: 'Parcel S up to 2kg',
          description: 'For small parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 4.79,
            salePrice: 4.79,
            sale: false,
          },
          maxSize: {
            height: 35,
            width: 25,
            length: 10,
          },
          maxWeight: 2000,
        },{
          id: 'dhl-2-national-m',
          name: 'Parcel M up to 2kg',
          description: 'For medium sized parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 5.49,
            salePrice: 5.49,
            sale: false,
          },
          maxSize: {
            height: 60,
            width: 30,
            length: 15,
          },
          maxWeight: 2000,
        }],
        meta,
      }
    },{
      payload: {
        id: 'dhl-2-europe',
        name: 'DHL Europe',
        description: 'Versendungen innerhalb Europas',
        courierId: fulfillmentCouriers.items![1].payload!.id,
        startZones: ['DE', 'FR', 'IT', 'ES'],
        destinationZones: ['DE', 'FR', 'IT', 'ES'],
        taxIds: [taxes[0].payload?.id as string],
        attributes: [{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:productName',
          value: 'V01PAK',
        },{
          id: 'urn:restorecommerce:fulfillment:product:attribute:dhl:accountNumber',
          value: '33333333330102',
        }],
        variants: [{
          id: 'dhl-2-europe-s',
          name: 'Parcel S up to 2kg',
          description: 'For small sized parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 4.79,
            salePrice: 4.79,
            sale: false,
          },
          maxSize: {
            height: 35,
            width: 25,
            length: 10,
          },
          maxWeight: 2000,
        },{
          id: 'dhl-2-europe-m',
          name: 'Parcel M up to 2kg',
          description: 'For medium sized parcels up to 2kg',
          price: {
            currencyId: 'EUR',
            regularPrice: 8.49,
            salePrice: 8.49,
            sale: false,
          },
          maxSize: {
            height: 60,
            width: 30,
            length: 15,
          },
          maxWeight: 2000,
        }],
        meta,
      }
    }
  ],
  totalCount: 4,
  operationStatus: {
    code: 200,
    message: 'Mocked!'
  }
};

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
    ) => callback(null, {
      items: Object.values(users),
      totalCount: Object.values(users).length,
      operationStatus
    }),
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
                'contactPoint_1'
              ],
            },
          },
          status,
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
        status,
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
  manufacturer: {
    read: (
      call: any,
      callback: (error: any, response: ManufacturerListResponse) => void,
    ) => callback(null, {
      items: manufacturers,
      totalCount: manufacturers.length,
      operationStatus,
    }),
  },
  tax: {
    read: (
      call: any,
      callback: (error: any, response: TaxListResponse) => void,
    )=> callback(null, {
      items: taxes,
      totalCount: taxes.length,
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
          status,
        }
      ],
      totalCount: 1,
      operationStatus
    }),
  },
  template: {
    read: (
      call: any,
      callback: (error: any, response: TemplateListResponse) => void,
    ) => callback(null, templates),
  },
  setting: {
    read: (
      call: any,
      callback: (error: any, response: SettingListResponse) => void,
    ) => callback(null, settings),
  },
  fulfillment_courier: {
    read: (
      call: any,
      callback: (error: any, response: FulfillmentCourierListResponse) => void,
    ) => callback(null, fulfillmentCouriers),
  },
  fulfillment_product: {
    read: (
      call: any,
      callback: (error: any, response: FulfillmentProductListResponse) => void,
    ) => callback(null, fulfillmentProducts),
  },
  currency: {
    read: (
      call: any,
      callback: (error: any, response: CurrencyListResponse) => void,
    )=> callback(null, currencies),
  },
};