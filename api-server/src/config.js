'use strict';

/**
 * Centralised environment configuration.
 *
 * Every value is read exactly once, validated, and exposed with a safe
 * default so that the API can boot in "mock/simulator" mode without any
 * third-party credentials being present.
 */

const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true' || String(value).trim() === '1';
};

const int = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const rootDir = path.resolve(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3001),
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',

  db: {
    connectionString:
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/nextlink_db',
    max: int(process.env.PGPOOL_MAX, 10),
  },

  redis: {
    enabled: bool(process.env.REDIS_ENABLED, false),
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'nextlink-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  mikrotik: {
    mode: process.env.MIKROTIK_MODE === 'live' ? 'live' : 'simulator',
    host: process.env.MIKROTIK_HOST || '192.168.88.1',
    port: int(process.env.MIKROTIK_PORT, 8728),
    tlsPort: int(process.env.MIKROTIK_TLS_PORT, 8729),
    user: process.env.MIKROTIK_USER || 'admin',
    password: process.env.MIKROTIK_PASSWORD || '',
    timeoutMs: int(process.env.MIKROTIK_TIMEOUT_MS, 8000),
    // RouterOS API path used for PPPoE secrets (v6 = /ppp, v7 = /ppp)
    pppoePath: process.env.MIKROTIK_PPPOE_PATH || 'ppp',
  },

  payments: {
    mode: process.env.PAYMENT_MODE === 'live' ? 'live' : 'mock',
    bkash: {
      baseUrl: process.env.BKASH_BASE_URL || 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
      appKey: process.env.BKASH_APP_KEY || '',
      appSecret: process.env.BKASH_APP_SECRET || '',
      username: process.env.BKASH_USERNAME || '',
      password: process.env.BKASH_PASSWORD || '',
    },
    nagad: {
      baseUrl: process.env.NAGAD_BASE_URL || 'https://api.sandbox.nagad.com',
      merchantId: process.env.NAGAD_MERCHANT_ID || '',
      apiKey: process.env.NAGAD_API_KEY || '',
    },
    sslcommerz: {
      baseUrl: process.env.SSLCOMMERZ_BASE_URL || 'https://sandbox.sslcommerz.com',
      storeId: process.env.SSLCOMMERZ_STORE_ID || '',
      storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD || '',
    },
    rocket: {
      baseUrl: process.env.ROCKET_BASE_URL || 'https://sandbox.rocket.com/api/v1',
      merchantId: process.env.ROCKET_MERCHANT_ID || '',
      apiKey: process.env.ROCKET_API_KEY || '',
    },
  },

  sms: {
    mode: process.env.SMS_MODE === 'live' ? 'live' : 'mock',
    providerUrl: process.env.SMS_PROVIDER_URL || '',
    apiKey: process.env.SMS_PROVIDER_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || 'NextLink',
  },

  billing: {
    timezone: process.env.BILLING_TIMEZONE || 'Asia/Dhaka',
    dueDay: int(process.env.BILLING_DUE_DAY, 10),
    lateGraceDays: int(process.env.BILLING_LATE_GRACE_DAYS, 5),
    suspendAfterDays: int(process.env.BILLING_SUSPEND_AFTER_DAYS, 10),
    // Currency used for generated invoices. The existing `packages.price`
    // values are kept untouched, so this only labels the amount.
    currency: process.env.BILLING_CURRENCY || 'BDT',
    currencySymbol: process.env.BILLING_CURRENCY_SYMBOL || '৳',
    pdfDir: process.env.BILLING_PDF_DIR
      ? path.resolve(rootDir, process.env.BILLING_PDF_DIR)
      : path.resolve(rootDir, 'storage', 'invoices'),
  },

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  rootDir,
};

if (!fs.existsSync(config.billing.pdfDir)) {
  fs.mkdirSync(config.billing.pdfDir, { recursive: true });
}

module.exports = config;
