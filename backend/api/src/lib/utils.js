'use strict';

const crypto = require('crypto');

/** ISO timestamp helper used across the API. */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Generate a prefixed, human readable identifier.
 * e.g. generateId('INV') -> 'INV-8F3A2C91'
 */
function generateId(prefix, length = 8) {
  return `${prefix}-${crypto.randomBytes(length / 2).toString('hex').toUpperCase()}`;
}

/** Cryptographically strong random token (hex). */
function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Constant-time string comparison that tolerates differing lengths.
 * Used for webhook signature verification.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 signature helper (bKash / SSLCommerz style). */
function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Build the billing period key for a given date, e.g. '2026-11'.
 *
 * This is a thin wrapper around `lib/dates.js`, which formats the date in the
 * configured billing timezone. The previous implementation used the server's
 * local timezone and produced a different month for six hours every day —
 * the billing cycle then billed the wrong month.
 */
function periodKey(date = new Date()) {
  // Required lazily to avoid a circular import at module load.
  // eslint-disable-next-line global-require
  return require('./dates').periodKey(date);
}

/**
 * Add a number of days to a date, returning a YYYY-MM-DD string.
 *
 * Thin wrapper around `lib/dates.js` — see the note on `periodKey` above.
 */
function addDays(date, days) {
  // eslint-disable-next-line global-require
  return require('./dates').addDays(date, days);
}

/** Format a numeric amount as USD string, e.g. 1500 -> '1,500'. */
function formatAmount(amount) {
  const value = Number(amount || 0);
  return value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * Mask a phone number for logging: +8801712345678 -> +88017*****678
 */
function maskPhone(phone) {
  const value = String(phone || '');
  if (value.length < 6) return value;
  return `${value.slice(0, value.length - 6)}******`;
}

/**
 * Convert a dollar amount (string or number) to integer cents without
 * floating-point accumulation error.
 */
function toCents(amount) {
  if (amount === null || amount === undefined || amount === '') return 0;
  const cleaned = String(amount).replace(/[^0-9.-]/g, '');
  if (!cleaned) return 0;
  const negative = cleaned.startsWith('-');
  const abs = negative ? cleaned.slice(1) : cleaned;
  const [wholePart = '0', fracPart = ''] = abs.split('.');
  const paddedFrac = (fracPart + '000').slice(0, 3);
  const cents = parseInt(wholePart || '0', 10) * 100 + Math.round(parseInt(paddedFrac, 10) / 10);
  return negative ? -cents : cents;
}

/**
 * Convert integer cents back to a two-decimal dollar number (e.g. 899 -> 8.99)
 * or formatted string (`fromCentsStr(899)` -> '8.99').
 */
function fromCents(cents) {
  const intCents = Math.round(Number(cents || 0));
  return Number((intCents / 100).toFixed(2));
}

function fromCentsStr(cents) {
  const intCents = Math.round(Number(cents || 0));
  const sign = intCents < 0 ? '-' : '';
  const abs = Math.abs(intCents);
  const dollars = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}${dollars}.${rem}`;
}

module.exports = {
  nowIso,
  generateId,
  newId: generateId,
  randomToken,
  safeEqual,
  hmacSha256,
  periodKey,
  addDays,
  formatAmount,
  maskPhone,
  toCents,
  fromCents,
  fromCentsStr,
};
