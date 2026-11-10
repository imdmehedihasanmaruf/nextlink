'use strict';

const config = require('../config');
const logger = require('../lib/logger');

/**
 * Background job queue.
 *
 * The SRS asks for "Redis for session & active queues". When Redis is
 * available (REDIS_ENABLED=true + reachable REDIS_URL) jobs are pushed onto a
 * Redis list and drained by this process. When Redis is unavailable the same
 * API falls back to an in-process queue, so the system keeps working in
 * single-node development environments without a Redis install.
 *
 * Public API:
 *   enqueue(name, payload)      -> job id
 *   process(handler)            -> start draining
 *   stats()                     -> queue statistics
 *   mode                        -> 'redis' | 'memory'
 */

let redisClient = null;
let redisListKey = 'nextlink:jobs';
let useRedis = false;
let memoryQueue = [];
let processing = false;
let handler = null;
let processed = 0;
let failed = 0;

/**
 * Try to connect to Redis. Failure is not fatal — we fall back to memory.
 */
async function init() {
  if (!config.redis.enabled) {
    logger.info('queue: using in-process queue (REDIS_ENABLED=false)');
    return { mode: 'memory' };
  }

  try {
    // ioredis is required lazily so the app runs even when Redis is off.
    // eslint-disable-next-line global-require
    const Redis = require('ioredis');
    redisClient = new Redis(config.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });

    redisClient.on('error', (err) => {
      if (useRedis) {
        logger.warn('queue: redis error, falling back to memory queue', { message: err.message });
        useRedis = false;
      }
    });

    await redisClient.connect();
    await redisClient.ping();
    useRedis = true;
    logger.info('queue: connected to redis', { url: config.redis.url });
    return { mode: 'redis' };
  } catch (error) {
    logger.warn('queue: redis unavailable, using in-process queue', { message: error.message });
    if (redisClient) {
      redisClient.disconnect();
      redisClient = null;
    }
    useRedis = false;
    return { mode: 'memory' };
  }
}

/**
 * Push a job onto the queue.
 */
async function enqueue(name, payload = {}) {
  const job = {
    id: `${name}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name,
    payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  };

  if (useRedis && redisClient) {
    await redisClient.rpush(redisListKey, JSON.stringify(job));
  } else {
    memoryQueue.push(job);
  }

  logger.debug('queue: job enqueued', { id: job.id, name });
  return job.id;
}

/**
 * Pull the next job (Redis BRPOP with a short timeout, or memory shift).
 */
async function dequeue() {
  if (useRedis && redisClient) {
    const result = await redisClient.blpop(redisListKey, 2);
    if (!result) return null;
    return JSON.parse(result[1]);
  }
  return memoryQueue.shift() || null;
}

/**
 * Start the worker loop.
 * @param {(name: string, payload: object, job: object) => Promise<void>} jobHandler
 */
async function process(jobHandler) {
  handler = jobHandler;
  if (processing) return;
  processing = true;

  logger.info('queue: worker started', { mode: useRedis ? 'redis' : 'memory' });

  const loop = async () => {
    while (processing) {
      let job = null;
      try {
        job = await dequeue();
      } catch (error) {
        logger.warn('queue: dequeue failed', { message: error.message });
      }

      if (!job) {
        // Idle — yield the event loop.
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }

      job.attempts += 1;
      try {
        await handler(job.name, job.payload, job);
        processed += 1;
        logger.info('queue: job completed', { id: job.id, name: job.name });
      } catch (error) {
        failed += 1;
        logger.error('queue: job failed', { id: job.id, name: job.name, message: error.message });
      }
    }
  };

  loop().catch((error) => logger.error('queue: worker crashed', { message: error.message }));
}

/**
 * Queue statistics.
 */
function stats() {
  return {
    mode: useRedis ? 'redis' : 'memory',
    pending: memoryQueue.length,
    processed,
    failed,
  };
}

/**
 * Stop the worker and close the Redis connection.
 */
async function close() {
  processing = false;
  if (redisClient) {
    await redisClient.quit().catch(() => redisClient.disconnect());
    redisClient = null;
  }
}

module.exports = { init, enqueue, process, stats, close, get mode() { return useRedis ? 'redis' : 'memory'; } };
