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
 * Redis delivery uses the standard reliable-queue pattern:
 *   enqueue  -> RPUSH  queue:list
 *   dequeue  -> BRPOPLPUSH queue:list queue:processing (atomic)
 *   ack      -> LREM   queue:processing <job>
 *   failure  -> job goes back to queue:list or to queue:failed after N attempts
 *   restart  -> stranded entries in queue:processing are re-queued on init
 *
 * With this pattern a crash of the worker loop no longer loses the job: the
 * entry stays in `queue:processing` until it is acknowledged, and a job that
 * keeps failing lands in `queue:failed` for inspection instead of being
 * dropped silently.
 *
 * Public API:
 *   enqueue(name, payload)      -> job id
 *   process(handler)            -> start draining
 *   stats()                     -> queue statistics
 *   refreshPendingCount()       -> read the real Redis queue length
 *   listFailed(limit)           -> failed jobs for inspection
 *   mode                        -> 'redis' | 'memory'
 */

const LIST_KEY = 'nextlink:jobs';
const PROCESSING_KEY = 'nextlink:jobs:processing';
const FAILED_KEY = 'nextlink:jobs:failed';
const MAX_ATTEMPTS = 3;
const POLL_MS = 250;

let redisClient = null;
let useRedis = false;
let memoryQueue = [];
let memoryProcessing = [];
let processing = false;
let handler = null;
let processed = 0;
let failed = 0;

/**
 * Hide the password in a Redis URL before it is logged.
 *
 * The previous pattern only handled `redis://user:password@host`. A URL of the
 * form `redis://:password@host` (no username) did not match the regex, so the
 * full credential was written to the log. This strips any userinfo section
 * between the scheme and the host.
 */
function redactUrl(url) {
  return String(url || '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1***@');
}

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

    // Recover jobs that were in flight when the process stopped. Anything in
    // the processing list was never acknowledged, so it may not have run.
    try {
      const stranded = await redisClient.lrange(PROCESSING_KEY, 0, -1);
      if (stranded.length) {
        for (const raw of stranded) {
          await redisClient.lpush(LIST_KEY, raw);
        }
        await redisClient.del(PROCESSING_KEY);
        logger.warn('queue: recovered in-flight jobs on startup', { count: stranded.length });
      }
    } catch (error) {
      logger.warn('queue: could not recover in-flight jobs', { message: error.message });
    }

    logger.info('queue: connected to redis', { url: redactUrl(config.redis.url) });
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
    await redisClient.rpush(LIST_KEY, JSON.stringify(job));
  } else {
    memoryQueue.push(job);
  }

  logger.debug('queue: job enqueued', { id: job.id, name });
  return job.id;
}

/**
 * Pull the next job atomically into the processing list.
 *
 * Uses BRPOPLPUSH, which is available on every Redis version the project
 * supports (the bundled Windows build is 5.0.14). BLMOVE would be the generic
 * form, but it only exists in Redis 6.2+.
 *
 * The original raw string is kept on the returned object because the LREM
 * operations that acknowledge or re-queue the entry compare exact strings.
 */
async function dequeue() {
  if (useRedis && redisClient) {
    // BRPOPLPUSH is atomic, so a job is never both queued and processing.
    const raw = await redisClient.brpoplpush(LIST_KEY, PROCESSING_KEY, 2);
    if (!raw) return null;
    const job = JSON.parse(raw);
    job.__raw = raw;
    return job;
  }
  const job = memoryQueue.shift() || null;
  if (job) memoryProcessing.push(job);
  return job;
}

/**
 * Acknowledge a finished job — remove it from the processing list.
 */
async function ack(job) {
  if (useRedis && redisClient) {
    const removed = await redisClient.lrem(
      PROCESSING_KEY,
      1,
      job.__raw || JSON.stringify({ ...job, __raw: undefined }),
    );
    return removed > 0;
  }
  const index = memoryProcessing.findIndex((item) => item.id === job.id);
  if (index >= 0) memoryProcessing.splice(index, 1);
  return index >= 0;
}

/**
 * Re-queue a failed job, or park it in the failed list when it is out of
 * attempts.
 */
async function requeueOrFail(job, errorMessage) {
  const raw = job.__raw || JSON.stringify({ ...job, __raw: undefined });
  const attempts = Number(job.attempts || 0);

  if (attempts >= MAX_ATTEMPTS) {
    if (useRedis && redisClient) {
      await redisClient.lpush(
        FAILED_KEY,
        JSON.stringify({ ...job, __raw: undefined, failedAt: new Date().toISOString(), error: errorMessage }),
      );
      await redisClient.lrem(PROCESSING_KEY, 1, raw);
    } else {
      const index = memoryProcessing.findIndex((item) => item.id === job.id);
      if (index >= 0) memoryProcessing.splice(index, 1);
    }
    logger.error('queue: job exhausted its attempts and was parked in the failed list', {
      id: job.id,
      name: job.name,
      error: errorMessage,
    });
    return 'failed';
  }

  // Put the job back so it is retried. The stored raw string is used for the
  // LREM so the attempt counter is the only thing that changes.
  const { __raw, ...retryJob } = job;
  retryJob.attempts = attempts;
  if (useRedis && redisClient) {
    await redisClient.rpush(LIST_KEY, JSON.stringify(retryJob));
    await redisClient.lrem(PROCESSING_KEY, 1, raw);
  } else {
    const index = memoryProcessing.findIndex((item) => item.id === job.id);
    if (index >= 0) memoryProcessing.splice(index, 1);
    memoryQueue.push(retryJob);
  }
  return 'requeued';
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
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }

      job.attempts += 1;
      try {
        await handler(job.name, job.payload, job);
        await ack(job);
        processed += 1;
        logger.info('queue: job completed', { id: job.id, name: job.name });
      } catch (error) {
        failed += 1;
        const outcome = await requeueOrFail(job, error.message);
        logger.error('queue: job failed', {
          id: job.id,
          name: job.name,
          message: error.message,
          outcome,
        });
      }
    }
  };

  loop().catch((error) => logger.error('queue: worker crashed', { message: error.message }));
}

/**
 * Queue statistics.
 */
function stats() {
  if (useRedis && redisClient) {
    return {
      mode: 'redis',
      // The pending count is read from Redis on demand by refreshPendingCount.
      // The previous version always reported the in-process array, which was
      // empty in Redis mode — the "pending" number was meaningless.
      pending: Number(stats.pendingCount || 0),
      processing: Number(stats.processingCount || 0),
      failed: Number(stats.failedCount || 0),
      processed,
      failedJobs: failed,
    };
  }
  return {
    mode: 'memory',
    pending: memoryQueue.length,
    processing: memoryProcessing.length,
    failed: 0,
    processed,
    failedJobs: failed,
  };
}

// Refresh the pending count on demand.
async function refreshPendingCount() {
  if (useRedis && redisClient) {
    try {
      stats.pendingCount = await redisClient.llen(LIST_KEY);
      stats.processingCount = await redisClient.llen(PROCESSING_KEY);
      stats.failedCount = await redisClient.llen(FAILED_KEY);
    } catch (error) {
      logger.warn('queue: could not read the pending count', { message: error.message });
    }
    return stats.pendingCount;
  }
  stats.pendingCount = memoryQueue.length;
  stats.processingCount = memoryProcessing.length;
  stats.failedCount = 0;
  return stats.pendingCount;
}

/**
 * Read the failed jobs (for the ops/diagnostic view).
 */
async function listFailed(limit = 20) {
  if (useRedis && redisClient) {
    const raw = await redisClient.lrange(FAILED_KEY, 0, Math.max(0, limit - 1));
    return raw.map((entry) => JSON.parse(entry));
  }
  return [];
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

module.exports = {
  init,
  enqueue,
  process,
  stats,
  refreshPendingCount,
  listFailed,
  close,
  get mode() {
    return useRedis ? 'redis' : 'memory';
  },
};
