import { createServiceConfig } from '@restorecommerce/service-config';
import { createLogger } from '@restorecommerce/logger';
import { BillingService } from './service.js';

const cfg = createServiceConfig(process.cwd());
const loggerCfg = cfg.get('logger');
loggerCfg.esTransformer = (msg) => {
  msg.fields = JSON.stringify(msg.fields);
  return msg;
};
const logger = createLogger(loggerCfg);
const service = new BillingService(cfg, logger);
service.start().catch((err) => {
  console.error('client error', err.stack);
  process.exit(1);
});

process.on('SIGINT', () => {
  service.stop().catch((err) => {
    console.error('shutdown error', err);
    process.exit(1);
  });
});
