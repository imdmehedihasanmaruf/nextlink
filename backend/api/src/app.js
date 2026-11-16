'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const db = require('./lib/db');
const logger = require('./lib/logger');
const queue = require('./lib/queue');
const { notFound, errorHandler } = require('./middleware/error');
const { globalLimiter } = require('./middleware/rateLimit');

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const billingRoutes = require('./routes/billing.routes');
const paymentRoutes = require('./routes/payments.routes');
const mikrotikRoutes = require('./routes/mikrotik.routes');
const authRoutes = require('./routes/auth.routes');
const smsRoutes = require('./routes/sms.routes');
const auditRoutes = require('./routes/audit.routes');
const portalRoutes = require('./routes/portal.routes');
const applicationRoutes = require('./routes/applications.routes');
const coverageRoutes = require('./routes/coverage.routes');
const ticketRoutes = require('./routes/tickets.routes');
const settingsRoutes = require('./routes/settings.routes');
const customerRoutes = require('./routes/customer.routes');
const adminFeatureRoutes = require('./routes/adminFeatures.routes');
const notificationRoutes = require('./routes/notifications.routes');

function createApp() {
  const app = express();

  // Only the first proxy hop is trusted. Trusting every peer would let a
  // caller spoof the X-Forwarded-For header and corrupt the audit trail.
  app.set('trust proxy', int(process.env.TRUST_PROXY_HOPS, 1));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests (tools, curl) carry no Origin header.
        if (!origin) return callback(null, true);
        // Only the configured frontends are allowed. A wildcard would let
        // any website read the API responses.
        if (config.cors.origins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '12mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Switch active PostgreSQL connection to isolated `nextlink_test_db` when requested in non-production
  app.use((req, res, next) => {
    const isProd =
      config.env === 'production' ||
      process.env.NODE_ENV === 'production' ||
      String(req.headers['x-simulate-production'] || '').toLowerCase() === 'true';
    const wantTestDb = !isProd && req.headers['x-use-test-db'] === 'nextlink_test_db';
    return db.runWithTestDb(wantTestDb, () => {
      if (!isProd) {
        res.setHeader('X-Database-Target', db.getActiveDatabaseName());
      }
      next();
    });
  });

  // A general limiter protects every route. The routes that create a side
  // effect add their own, tighter limit on top of this one.
  app.use(globalLimiter);
  if (config.env !== 'test') {
    app.use(morgan('tiny'));
  }

  /**
   * Health / readiness probe.
   */
  const handleHealth = async (req, res) => {
    const database = await db.healthCheck();
    await queue.refreshPendingCount();
    res.status(database.ok ? 200 : 503).json({
      success: database.ok,
      service: 'nextlink-api',
      version: '1.0.0',
      env: config.env,
      database: database.ok ? 'connected' : 'unavailable',
      queue: queue.stats(),
      mikrotikMode: config.mikrotik.mode,
      paymentMode: config.payments.mode,
      smsMode: config.sms.mode,
      timestamp: new Date().toISOString(),
    });
  };
  app.get('/health', handleHealth);
  app.get('/api/health', handleHealth);
  app.get('/api/v1/health', handleHealth);

  app.use('/api/billing', billingRoutes);
  app.use('/api/billing', portalRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/mikrotik', mikrotikRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/sms', smsRoutes);
  app.use('/api/audit', auditRoutes);
  app.use('/api/applications', applicationRoutes);
  app.use('/api/coverage', coverageRoutes);
  app.use('/api/tickets', ticketRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/customer', customerRoutes);
  app.use('/api/packages', customerRoutes);
  app.use('/api/admin', adminFeatureRoutes);
  app.use('/api/staff', adminFeatureRoutes);
  app.use('/api', adminFeatureRoutes);
  app.use('/api/notifications', notificationRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * Boot the API: verify the database, initialise the queue and start the
 * scheduled jobs.
 */
async function bootstrap() {
  const database = await db.healthCheck();
  if (!database.ok) {
    logger.error('database connection failed — API will start but data routes will fail', {
      message: database.error,
    });
  } else {
    logger.info('database connected');
  }

  const queueMode = await queue.init();

  // Wire the queue worker to the job handlers.
  await queue.process(async (name, payload) => {
    logger.info('queue: executing job', { name });
    switch (name) {
      case 'billing.cycle.run':
        await require('./services/billing/engine').runMonthlyCycle({
          period: payload.period,
          dryRun: Boolean(payload.dryRun),
        });
        break;
      case 'billing.suspend_overdue':
        await require('./services/billing/engine').autoSuspendOverdue();
        break;
      default:
        logger.warn('queue: unknown job ignored', { name });
    }
  });

  require('./jobs/scheduler').start();

  logger.info('API ready', {
    port: config.port,
    queue: queueMode.mode,
    mikrotik: config.mikrotik.mode,
    payments: config.payments.mode,
    sms: config.sms.mode,
  });
}

module.exports = { createApp, bootstrap };
