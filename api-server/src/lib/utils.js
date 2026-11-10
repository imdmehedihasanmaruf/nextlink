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
 */
function periodKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Add a number of days to a date, returning a YYYY-MM-DD string.
 */
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Format a numeric amount as BDT string, e.g. 1500 -> '1,500'. */
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

module.exports = {
  nowIso,
  generateId,
  randomToken,
  safeEqual,
  hmacSha256,
  periodKey,
  addDays,
  formatAmount,
  maskPhone,
};
