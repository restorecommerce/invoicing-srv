const { Events } = require('@restorecommerce/kafka-client');
const {createServiceConfig} = require('@restorecommerce/service-config');
const {createLogger} = require('@restorecommerce/logger');

const cfg = createServiceConfig(process.cwd());
const logger = createLogger(cfg.get('logger'));

async function trigger() {
  const events = new Events(cfg.get('events:kafka'), logger);
  await events.start();
  const invoicesTopic = events.topic('io.restorecommerce.invoices.resource');

  logger.info('Triggering command...');
  await invoicesTopic.emit('triggerInvoices', {
    ids: ["8bc2e92b96674cefa2d611b49c123456###3275fcd9c84f4831aeba986e328b43ce", "8bc2e92b96674cefa2d611b49c456789###4701b0f574e24c61af8391b5c28b1d08s"]
  })

  await events.stop();
  return 'Done';
}

trigger().then(done => logger.info(done));
