import { Logger } from 'winston';
import { RedisClientType as RedisClient } from 'redis';
import {
  Server,
  CommandInterface,
} from '@restorecommerce/chassis-srv';
import { ServiceConfig } from '@restorecommerce/service-config';
import { Events } from '@restorecommerce/kafka-client';

export class InvoicingCommandInterface extends CommandInterface {
  constructor(
    server: Server,
    cfg: ServiceConfig,
    logger: Logger,
    events: Events,
    redisClient: RedisClient
  ) {
    super(server, cfg, logger, events, redisClient);
  }
}