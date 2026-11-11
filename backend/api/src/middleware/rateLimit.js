'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Rate limiters.
 *
 * The endpoints that create a side effect — a login attempt, a ticket with an
 * SMS, a connection request with a file upload, a payment session — are
 * limited so they cannot be used to lock an account out, flood the SMS
 * gateway or fill the disk.
 */

const json = (message) => ({ success: false, error: message });

/** Shared key: the authenticated subject when there is one, the IP otherwise. */
function keyGenerator(req) {
  if (req.user && req.user.id) return `user:${req.user.id}`;
  return `ip:${req.ip}`;
}

/**
 * A limiter that answers with a JSON envelope.
 */
function limiter({ windowMs, max, message, skipSuccessful = false }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: skipSuccessful,
    keyGenerator,
    message: json(message),
  });
}

/**
 * The limiter windows and budgets.
 *
 * The values can be overridden through the environment, which is what the
 * test suite uses so a test run does not lock itself out.
 */
const WINDOWS = {
  auth: Number(process.env.RATE_LIMIT_AUTH_WINDOW_MS || 15 * 60 * 1000),
  authMax: Number(process.env.RATE_LIMIT_AUTH_MAX || 10),
  ticket: Number(process.env.RATE_LIMIT_TICKET_WINDOW_MS || 60 * 60 * 1000),
  ticketMax: Number(process.env.RATE_LIMIT_TICKET_MAX || 10),
  application: Number(process.env.RATE_LIMIT_APPLICATION_WINDOW_MS || 60 * 60 * 1000),
  applicationMax: Number(process.env.RATE_LIMIT_APPLICATION_MAX || 10),
  payment: Number(process.env.RATE_LIMIT_PAYMENT_WINDOW_MS || 15 * 60 * 1000),
  paymentMax: Number(process.env.RATE_LIMIT_PAYMENT_MAX || 30),
  sms: Number(process.env.RATE_LIMIT_SMS_WINDOW_MS || 60 * 60 * 1000),
  smsMax: Number(process.env.RATE_LIMIT_SMS_MAX || 100),
  global: Number(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS || 60 * 1000),
  globalMax: Number(process.env.RATE_LIMIT_GLOBAL_MAX || 300),
  portal: Number(process.env.RATE_LIMIT_PORTAL_WINDOW_MS || 15 * 60 * 1000),
  portalMax: Number(process.env.RATE_LIMIT_PORTAL_MAX || 60),
};

/** Sign in attempts — strict, so a password cannot be brute forced. */
const authLimiter = limiter({
  windowMs: WINDOWS.auth,
  max: WINDOWS.authMax,
  message: 'Too many sign in attempts. Please try again in a few minutes.',
});

/** The subscriber login is a separate budget from the staff login. */
const subscriberAuthLimiter = limiter({
  windowMs: WINDOWS.auth,
  max: WINDOWS.authMax,
  message: 'Too many sign in attempts. Please try again in a few minutes.',
});

/** Ticket creation sends an SMS, so it is limited more tightly. */
const ticketLimiter = limiter({
  windowMs: WINDOWS.ticket,
  max: WINDOWS.ticketMax,
  message: 'Too many support tickets were submitted. Please try again later.',
});

/** A connection request writes a file to disk. */
const applicationLimiter = limiter({
  windowMs: WINDOWS.application,
  max: WINDOWS.applicationMax,
  message: 'Too many connection requests were submitted. Please try again later.',
});

/** Payment sessions reach the gateway, which has its own quota. */
const paymentLimiter = limiter({
  windowMs: WINDOWS.payment,
  max: WINDOWS.paymentMax,
  message: 'Too many payment attempts. Please try again in a few minutes.',
});

/** Portal reads and customer actions — generous but enumeration-proof. */
const portalLimiter = limiter({
  windowMs: WINDOWS.portal,
  max: WINDOWS.portalMax,
  message: 'Too many requests. Please slow down.',
});

/** The outbound SMS is charged per message. */
const smsLimiter = limiter({
  windowMs: WINDOWS.sms,
  max: WINDOWS.smsMax,
  message: 'Too many messages were requested. Please try again later.',
});

/** The general limiter for the whole API. */
const globalLimiter = limiter({
  windowMs: WINDOWS.global,
  max: WINDOWS.globalMax,
  message: 'Too many requests. Please slow down.',
});

module.exports = {
  authLimiter,
  subscriberAuthLimiter,
  ticketLimiter,
  applicationLimiter,
  paymentLimiter,
  smsLimiter,
  portalLimiter,
  globalLimiter,
  WINDOWS,
};
