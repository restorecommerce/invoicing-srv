import { createServiceConfig } from '@restorecommerce/service-config';
import { createLogger } from '@restorecommerce/logger';
import { Worker } from './worker.js';

// cfg and logger
const cfg = createServiceConfig(process.cwd());
const logger = createLogger(cfg.get('logger') ?? {});

const worker = new Worker();
worker.start(cfg, logger).then().catch((err) => {
  logger?.error('startup error', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  worker.stop().then().catch((err) => {
    logger?.error('shutdown error', err);
    process.exit(1);
  });
});