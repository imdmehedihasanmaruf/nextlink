'use strict';

const cron = require('node-cron');
const config = require('../config');
const logger = require('../lib/logger');
const queue = require('../lib/queue');
const billing = require('../services/billing/engine');
const utils = require('../lib/utils');

/**
 * Scheduled jobs.
 *
 *  - `billing.cycle.run`       monthly recurring invoice generation
 *  - `billing.suspend_overdue` auto-disconnect for unpaid bills
 *
 * Jobs are pushed onto the queue so the work happens in the worker loop
 * (Redis-backed in production, in-process in development).
 */

let scheduled = [];

function start() {
  if (scheduled.length) return scheduled;

  // Run the monthly cycle on the 1st of every month at 02:00.
  const monthly = cron.schedule(
    '0 2 1 * *',
    async () => {
      const period = utils.periodKey(new Date(Date.now() + 30 * 24 * 3600 * 1000));
      logger.info('scheduler: monthly billing cycle triggered', { period });
      await queue.enqueue('billing.cycle.run', { period });
    },
    { timezone: config.billing.timezone },
  );

  // Sweep for overdue invoices every day at 03:00.
  const overdue = cron.schedule(
    '0 3 * * *',
    async () => {
      logger.info('scheduler: overdue sweep triggered');
      await queue.enqueue('billing.suspend_overdue', {});
    },
    { timezone: config.billing.timezone },
  );

  scheduled = [monthly, overdue];
  logger.info('scheduler started', { jobs: scheduled.length, timezone: config.billing.timezone });

  return scheduled;
}

function stop() {
  scheduled.forEach((task) => task.stop());
  scheduled = [];
}

module.exports = { start, stop, runCycleNow: billing.runMonthlyCycle };
