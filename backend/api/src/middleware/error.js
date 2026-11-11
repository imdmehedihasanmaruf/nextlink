'use strict';

const logger = require('../lib/logger');

/**
 * Central error handler.
 * Converts thrown errors into a consistent JSON envelope.
 */
function notFound(req, res) {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    logger.error('unhandled request error', {
      method: req.method,
      url: req.originalUrl,
      message: err.message,
      stack: err.stack,
    });
  } else {
    logger.warn('request rejected', {
      method: req.method,
      url: req.originalUrl,
      status,
      message: err.message,
    });
  }

  res.status(status).json({
    success: false,
    error: err.message || 'Internal server error',
    code: err.code || undefined,
    details: err.details || undefined,
  });
}

/**
 * Wrap an async route handler so rejections reach the error handler.
 */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { notFound, errorHandler, asyncHandler };
