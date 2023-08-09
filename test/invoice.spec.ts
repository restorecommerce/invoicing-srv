import should from 'should';
import { GrpcMockServer, ProtoUtils } from '@alenon/grpc-mock-server';
import { bucketPolicySetRQ, permitCreateObjRule } from './utils';
import * as proto_loader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';


import { InvoiceService } from '../src/InvoiceResourceService';
// import { RedisClient } from 'redis';
import { billingService } from '../src/service';

// let logger;

// interface MethodWithOutput {
//   method: string,
//   output: any
// };

// const PROTO_PATH: string = 'node_modules/@restorecommerce/protos/io/restorecommerce/invoice.proto';
// const PKG_NAME: string = 'io.restorecommerce.invoice';
// const SERVICE_NAME: string = 'Service';

// const pkgDef: grpc.GrpcObject = grpc.loadPackageDefinition(
//   proto_loader.loadSync(PROTO_PATH, {
//     includeDirs: ['node_modules/@restorecommerce/protos'],
//     keepCase: true,
//     longs: String,
//     enums: String,
//     defaults: true,
//     oneofs: true
//   })
// );

// const proto: any = ProtoUtils.getProtoFromPkgDefinition(
//   PKG_NAME,
//   pkgDef
// );


// const mockServer = new GrpcMockServer('localhost:50061');

// const startGrpcMockServer = async (methodWithOutput: MethodWithOutput[]) => {
//   // create mock implementation based on the method name and output
//   const implementations = {
//     isAllowed: (call: any, callback: any) => {
//       if (call?.request?.context?.resources[0]?.value) {
//         let ctxResources = JSON.parse(call.request.context.resources[0].value.toString());
//         if (ctxResources?.id === 'config_invalid_scope' || call?.request?.target?.subject[0]?.value.startsWith('invalid_subject_id')) {
//           callback(null, { decision: 'DENY' });
//         } else {
//           const isAllowedResponse = methodWithOutput.filter(e => e.method === 'IsAllowed');
//           const response: any = new proto.Response.constructor(isAllowedResponse[0].output);
//           callback(null, response);
//         }
//       }
//     },
//     whatIsAllowed: (call: any, callback: any) => {
//       // check the request object and provide UserPolicies / RolePolicies
//       const whatIsAllowedResponse = methodWithOutput.filter(e => e.method === 'WhatIsAllowed');
//       const response: any = new proto.ReverseQuery.constructor(whatIsAllowedResponse[0].output);
//       callback(null, response);
//     }
//   };
//   try {
//     mockServer.addService(PROTO_PATH, PKG_NAME, SERVICE_NAME, implementations, {
//       includeDirs: ['node_modules/@restorecommerce/protos/'],
//       keepCase: true,
//       longs: String,
//       enums: String,
//       defaults: true,
//       oneofs: true
//     });
//     await mockServer.start();
//     logger.info('Mock ACS Server started on port 50061');
//   } catch (err) {
//     logger.error('Error starting mock ACS server', err);
//   }
// };

// const stopGrpcMockServer = async () => {
//   await mockServer.stop();
//   logger.info('Mock ACS Server closed successfully');
// };

// it('init test case', async () => {
//   let mockServer: any;

//   mockServer = await startGrpcMockServer([{ method: 'WhatIsAllowed', output: bucketPolicySetRQ },
//   { method: 'IsAllowed', output: { decision: 'PERMIT' } }]);
//   let test = "1";

//   should.exist(test);
//   test.should.equal("1");
// });




// describe('InvoiceService', () => {
//   let invoiceService: InvoiceService;
//   let redisClientMock: RedisClient;

//   beforeEach(() => {
//     // Create a mock RedisClient instance
//     redisClientMock = {
//       get: jest.fn(),
//       set: jest.fn(),
//       incr: jest.fn(),
//     } as any;

//     // Create an instance of the InvoiceService class
//     invoiceService = new InvoiceService(redisClientMock);
//   });

//   describe('async withdraw', () => {
//     it('should mark invoices as withdrawn and return the invoice list response', async () => {
//       // Mock the RedisClient's get method
//       redisClientMock.get.mockResolvedValue('10');

//       // Call the withdraw method
//       const result = await invoiceService.withdraw({ request: { context: 'context' } });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.set).toHaveBeenCalledWith('invoices:withdrawn', 'true');
//       expect(result).toEqual({ items: 'context', total_count: 10 });
//     });
//   });

//   describe('async render', () => {
//     it('should render the invoice as a PDF, save it to storage, and return the invoice list response', async () => {
//       // Mock the RedisClient's get and incr methods
//       redisClientMock.get.mockResolvedValue('10');
//       redisClientMock.incr.mockResolvedValue('11');

//       // Mock the billingService's renderPDF method
//       const renderPDFMock = jest.fn().mockResolvedValue('invoicePdf');
//       billingService.renderPDF = renderPDFMock;

//       // Mock the createPdfInStorage method
//       const createPdfInStorageMock = jest.fn().mockResolvedValue('newStorageId');
//       invoiceService.createPdfInStorage = createPdfInStorageMock;

//       // Call the render method
//       const result = await invoiceService.render({
//         request: {
//           context: 'context',
//           htmlInvoice: '<html></html>',
//           requestID: '123',
//           fileName: 'invoice.pdf',
//         },
//       });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.incr).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(renderPDFMock).toHaveBeenCalledWith('<html></html>');
//       expect(createPdfInStorageMock).toHaveBeenCalledWith('123', 'invoicePdf', 'invoice.pdf');
//       expect(result).toEqual({ items: 'context', total_count: 10 });
//     });
//   });

//   describe('async render', () => {
//     it('should render the invoice as a PDF, save it to storage, and return the invoice list response', async () => {
//       // Mock the RedisClient's get and incr methods
//       redisClientMock.get.mockResolvedValue('10');
//       redisClientMock.incr.mockResolvedValue('11');

//       // Mock the billingService's renderPDF method
//       const renderPDFMock = jest.fn().mockResolvedValue('invoicePdf');
//       billingService.renderPDF = renderPDFMock;

//       // Mock the createPdfInStorage method
//       const createPdfInStorageMock = jest.fn().mockResolvedValue('newStorageId');
//       invoiceService.createPdfInStorage = createPdfInStorageMock;

//       // Call the render method
//       const result = await invoiceService.render({
//         request: {
//           context: 'context',
//           htmlInvoice: '<html></html>',
//           requestID: '123',
//           fileName: 'invoice.pdf',
//         },
//       });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.incr).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(renderPDFMock).toHaveBeenCalledWith('<html></html>');
//       expect(createPdfInStorageMock).toHaveBeenCalledWith('123', 'invoicePdf', 'invoice.pdf');
//       expect(result).toEqual({ items: 'context', total_count: 10 });
//     });
//   });

let invoiceService: InvoiceService;

  describe('async create', () => {
    it('should create an invoice, save it to the database and storage, and return the invoice list response', async () => {
      // Mock the RedisClient's get method
      // redisClientMock.get.mockResolvedValue('10');

      // Mock the super.create and saveInvoice methods
      const superCreateMock = jest.fn();
      // invoiceService.saveInvoice = jest.fn();
      // invoiceService.saveInvoice.mockResolvedValue();


      let requestTest = {items:[]}


      // request: {
      //   // context: 'context',
      //   // requestID: '123',
      //   // document: 'invoiceDoc',
      //   // filename: 'invoice.pdf',
      //   items: [],
      // },

      // Call the create method
      const result = await invoiceService.create(
        requestTest
      );

      // Assertions
      // expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
      // expect(superCreateMock).toHaveBeenCalledWith('invoiceItems', 'context');
      // expect(invoiceService.saveInvoice).toHaveBeenCalledWith('123', 'invoiceDoc', 'invoice.pdf');
      expect(result).toEqual({ items: []});
    });
  });

//   describe('async upsert', () => {
//     it('should upsert an invoice, update the invoice number, and return the invoice list response', async () => {
//       // Mock the RedisClient's get and incr methods
//       redisClientMock.get.mockResolvedValue('10');
//       redisClientMock.incr.mockResolvedValue('11');

//       // Mock the super.upsert method
//       const superUpsertMock = jest.fn();

//       // Call the upsert method
//       const result = await invoiceService.upsert({
//         request: {
//           context: 'context',
//           items: 'invoiceItems',
//         },
//       });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.incr).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(superUpsertMock).toHaveBeenCalledWith('invoiceItems', 'context');
//       expect(result).toEqual({ items: 'invoiceItems', total_count: 10 });
//     });
//   });

//   describe('async update', () => {
//     it('should update an invoice, update the invoice number, and return the invoice list response', async () => {
//       // Mock the RedisClient's get and incr methods
//       redisClientMock.get.mockResolvedValue('10');
//       redisClientMock.incr.mockResolvedValue('11');

//       // Mock the super.update method
//       const superUpdateMock = jest.fn();

//       // Call the update method
//       const result = await invoiceService.update({
//         request: {
//           context: 'context',
//           items: 'invoiceItems',
//         },
//       });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.incr).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(superUpdateMock).toHaveBeenCalledWith('invoiceItems', 'context');
//       expect(result).toEqual({ items: 'invoiceItems', total_count: 10 });
//     });
//   });

//   describe('async delete', () => {
//     it('should delete an invoice, update the invoice number, and return the invoice list response', async () => {
//       // Mock the RedisClient's get and incr methods
//       redisClientMock.get.mockResolvedValue('10');
//       redisClientMock.incr.mockResolvedValue('11');

//       // Mock the super.delete method
//       const superDeleteMock = jest.fn();

//       // Call the delete method
//       const result = await invoiceService.delete({
//         request: {
//           context: 'context',
//           items: 'invoiceItems',
//         },
//       });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.incr).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(superDeleteMock).toHaveBeenCalledWith('invoiceItems', 'context');
//       expect(result).toEqual({ items: 'invoiceItems', total_count: 10 });
//     });
//   });

//   describe('async send', () => {
//     it('should send an invoice via email, update the invoice number, and return the invoice list response', async () => {
//       // Mock the RedisClient's get method
//       redisClientMock.get.mockResolvedValue('10');

//       // Mock the billingService's sendInvoiceEmail method
//       const sendInvoiceEmailMock = jest.fn().mockResolvedValue();
//       billingService.sendInvoiceEmail = sendInvoiceEmailMock;

//       // Call the send method
//       const result = await invoiceService.send({
//         request: {
//           context: 'context',
//           items: 'invoiceItems',
//           billingAddress: { contact: { email: 'test@example.com' } },
//           subject: 'Invoice Subject',
//           body: 'Invoice Body',
//           invoice: 'invoiceData',
//           invoice_number: '123',
//           org_userID: 'user123',
//         },
//       });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(sendInvoiceEmailMock).toHaveBeenCalledWith(
//         'Invoice Subject',
//         'Invoice Body',
//         'invoiceData',
//         'test@example.com',
//         '123',
//         'user123'
//       );
//       expect(result).toEqual({ items: 'invoiceItems', total_count: 10 });
//     });
//   });

//   describe('async generateInvoiceNumber', () => {
//     it('should retrieve the invoice number from Redis and return it in the response', async () => {
//       // Mock the RedisClient's get and incr methods
//       redisClientMock.get.mockResolvedValue('10');
//       redisClientMock.incr.mockResolvedValue('11');

//       // Call the generateInvoiceNumber method
//       const result = await invoiceService.generateInvoiceNumber({ request: { context: 'context' } });

//       // Assertions
//       expect(redisClientMock.get).toHaveBeenCalledWith('invoices:invoice_number');
//       expect(redisClientMock.incr).not.toHaveBeenCalled();
//       expect(result).toEqual({ invoice_no: 10 });
//     });
//   });

//   describe('async holdInvoice', () => {
//     it('should store the invoice in Redis with a temporary expiration and return the response', async () => {
//       // Mock the RedisClient's set method
//       redisClientMock.set.mockResolvedValue();

//       // Call the holdInvoice method
//       const result = await invoiceService.holdInvoice({ invoiceData: 'data' }, '123');

//       // Assertions
//       expect(redisClientMock.set).toHaveBeenCalledWith(
//         'tmp_invoices:123',
//         JSON.stringify({ invoiceData: 'data' }),
//         { EX: 60 * 60 * 24 }
//       );
//       expect(result).toBeUndefined();
//     });
//   });

// });