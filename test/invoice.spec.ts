import should from 'should';
import { GrpcMockServer, ProtoUtils } from '@alenon/grpc-mock-server';
import { bucketPolicySetRQ, permitCreateObjRule } from './utils';
import * as proto_loader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';

let logger;

interface MethodWithOutput {
  method: string,
  output: any
};

const PROTO_PATH: string = 'node_modules/@restorecommerce/protos/io/restorecommerce/invoice.proto';
const PKG_NAME: string = 'io.restorecommerce.invoice';
const SERVICE_NAME: string = 'Service';

const pkgDef: grpc.GrpcObject = grpc.loadPackageDefinition(
  proto_loader.loadSync(PROTO_PATH, {
    includeDirs: ['node_modules/@restorecommerce/protos'],
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  })
);

const proto: any = ProtoUtils.getProtoFromPkgDefinition(
  PKG_NAME,
  pkgDef
);


const mockServer = new GrpcMockServer('localhost:50061');

const startGrpcMockServer = async (methodWithOutput: MethodWithOutput[]) => {
  // create mock implementation based on the method name and output
  const implementations = {
    isAllowed: (call: any, callback: any) => {
      if (call?.request?.context?.resources[0]?.value) {
        let ctxResources = JSON.parse(call.request.context.resources[0].value.toString());
        if (ctxResources?.id === 'config_invalid_scope' || call?.request?.target?.subject[0]?.value.startsWith('invalid_subject_id')) {
          callback(null, { decision: 'DENY' });
        } else {
          const isAllowedResponse = methodWithOutput.filter(e => e.method === 'IsAllowed');
          const response: any = new proto.Response.constructor(isAllowedResponse[0].output);
          callback(null, response);
        }
      }
    },
    whatIsAllowed: (call: any, callback: any) => {
      // check the request object and provide UserPolicies / RolePolicies
      const whatIsAllowedResponse = methodWithOutput.filter(e => e.method === 'WhatIsAllowed');
      const response: any = new proto.ReverseQuery.constructor(whatIsAllowedResponse[0].output);
      callback(null, response);
    }
  };
  try {
    mockServer.addService(PROTO_PATH, PKG_NAME, SERVICE_NAME, implementations, {
      includeDirs: ['node_modules/@restorecommerce/protos/'],
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    await mockServer.start();
    logger.info('Mock ACS Server started on port 50061');
  } catch (err) {
    logger.error('Error starting mock ACS server', err);
  }
};

const stopGrpcMockServer = async () => {
  await mockServer.stop();
  logger.info('Mock ACS Server closed successfully');
};

it('init test case', async () => {
  let mockServer: any;

  mockServer = await startGrpcMockServer([{ method: 'WhatIsAllowed', output: bucketPolicySetRQ },
  { method: 'IsAllowed', output: { decision: 'PERMIT' } }]);
  let test = "1";

  should.exist(test);
  test.should.equal("1");
});