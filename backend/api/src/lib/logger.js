'use strict';

const config = require('../config');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = process.env.LOG_LEVEL ? LEVELS[process.env.LOG_LEVEL] ?? 2 : 2;

function emit(level, message, meta) {
  if (LEVELS[level] > currentLevel) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta && typeof meta === 'object' ? { meta } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
  env: config.env,
};
