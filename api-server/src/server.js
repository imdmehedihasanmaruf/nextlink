'use strict';

const config = require('./config');
const logger = require('./lib/logger');
const db = require('./lib/db');
const queue = require('./lib/queue');
const { createApp, bootstrap } = require('./app');

async function main() {
  const app = createApp();

  await bootstrap();

  const server = app.listen(config.port, () => {
    logger.info(`NextLink API listening on ${config.apiBaseUrl}`);
  });

  const shutdown = async (signal) => {
    logger.info(`received ${signal}, shutting down`);
    server.close(async () => {
      await queue.close();
      await db.close();
      logger.info('shutdown complete');
      process.exit(0);
    });
    // Force exit if connections hang.
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled promise rejection', { reason: String(reason) });
  });
}

main().catch((error) => {
  logger.error('failed to start API', { message: error.message, stack: error.stack });
  process.exit(1);
});
