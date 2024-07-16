const { Events } = require('@restorecommerce/kafka-client');
const { createServiceConfig } = require('@restorecommerce/service-config');
const { createLogger } = require('@restorecommerce/logger');

const cfg = createServiceConfig(process.cwd());
const logger = createLogger(cfg.get('logger'));

async function trigger() {
  const events = new Events(cfg.get('events:kafka'), logger);
  await events.start();
  const commandTopic = events.topic('io.restorecommerce.jobs');

  logger.info('Triggering command...');
  await commandTopic.emit('queuedJob', {
    type: 'invoicingServiceNotificationJob'
  });

  await events.stop();
  return 'Done';
}

trigger().then(done => logger.info(done));
