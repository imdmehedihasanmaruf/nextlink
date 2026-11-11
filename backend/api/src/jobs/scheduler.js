'use strict';

const cron = require('node-cron');
const config = require('../config');
const logger = require('../lib/logger');
const queue = require('../lib/queue');
const billing = require('../services/billing/engine');
const dates = require('../lib/dates');

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
      // The period is the month that is being billed. It has to be computed
      // in the billing timezone, without any offset — the previous code
      // added 30 days and therefore billed the wrong month for most of the
      // year.
      const period = dates.currentPeriodKey();
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

  // Catch up on a cycle that was missed because the API was down when the
  // cron fired. Without this the month would simply never be invoiced.
  catchUpMissedCycle().catch((error) => {
    logger.warn('scheduler: catch-up check failed', { message: error.message });
  });

  return scheduled;
}

/**
 * Compare the last completed cycle with the current period and enqueue the
 * difference.
 *
 * Every month between the last completed cycle and the current one is billed —
 * the previous version only queued the current period, so a period that
 * became due while the API was down was skipped forever.
 */
async function catchUpMissedCycle() {
  const db = require('../lib/db');
  const currentPeriod = dates.currentPeriodKey();

  const last = await db.queryOne(
    `SELECT period FROM billing_cycles WHERE status = 'completed' ORDER BY period DESC LIMIT 1`,
  );
  const lastPeriod = last?.period || null;

  if (lastPeriod === currentPeriod) return;

  if (!lastPeriod) {
    // No cycle has ever run — bill only the current period, not the whole
    // history.
    logger.info('scheduler: no completed cycle found, billing the current period', {
      currentPeriod,
    });
    await queue.enqueue('billing.cycle.run', { period: currentPeriod });
    return;
  }

  // The next period after the last completed one.
  const [lastYear, lastMonth] = lastPeriod.split('-').map(Number);
  let nextYear = lastYear;
  let nextMonth = lastMonth + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const fromPeriod = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

  const periods = dates.periodRange(fromPeriod, currentPeriod);
  if (periods.length === 0) return;

  logger.info('scheduler: billing the missed periods', { periods });
  for (const period of periods) {
    await queue.enqueue('billing.cycle.run', { period });
  }
}

function stop() {
  scheduled.forEach((task) => task.stop());
  scheduled = [];
}

module.exports = { start, stop, runCycleNow: billing.runMonthlyCycle };
