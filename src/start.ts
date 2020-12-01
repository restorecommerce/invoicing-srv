import {createServiceConfig} from '@restorecommerce/service-config';

const Cluster = require('@restorecommerce/cluster-service');
const cfg = createServiceConfig(process.cwd());
const server = new Cluster(cfg);

server.run('./lib/service.js');
process.on('SIGINT', () => {
  server.stop();
});
