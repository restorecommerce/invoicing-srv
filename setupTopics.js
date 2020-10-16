const { Events } = require('@restorecommerce/kafka-client');
const { createLogger } = require('@restorecommerce/logger');
const { createServiceConfig } = require('@restorecommerce/service-config');

const cfg = createServiceConfig(process.cwd());
const logger = createLogger(cfg.get('logger'));
const events = new Events(cfg.get('events:kafka'), logger);

async function createTopics() {
  await events.start();

  process.argv.forEach((value, index, array) => {
    if (index >= 2) {
      events.topic(value);
    }
  });

  await events.stop();
  // Give a delay of 3 seconds and exit the process
  // this delay is for the creation of topic via zookeeper
  setTimeout(() => {
    logger.info('Exiting after topic creation');
    process.exit();
  }, 3000);
}

createTopics().then((result) => {
  events.stop();
}).then(() => {
  logger.info('Done!');
}).catch((err) => {
  logger.error(err);
});

