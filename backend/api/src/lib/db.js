'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { Pool } = require('pg');
const config = require('../config');

const dbContext = new AsyncLocalStorage();

let pool = null;
let testPool = null;

function getTestConnectionString() {
  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }
  const url = new URL(config.db.connectionString);
  url.pathname = '/' + (process.env.DB_TEST_DATABASE || 'nextlink_test_db');
  return url.toString();
}

function getProdPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.db.connectionString,
      max: config.db.max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
}

function getTestPool() {
  if (!testPool) {
    testPool = new Pool({
      connectionString: getTestConnectionString(),
      max: config.db.max,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    testPool.on('error', (err) => {
      console.error('[db:test] idle client error:', err.message);
    });
  }
  return testPool;
}

function getActiveDatabaseName() {
  const store = dbContext.getStore();
  if (store && store.database) {
    return store.database;
  }
  if (process.env.DB_ACTIVE_DATABASE) {
    return process.env.DB_ACTIVE_DATABASE;
  }
  if (process.env.NODE_ENV === 'test') {
    return 'nextlink_test_db';
  }
  return 'nextlink_db';
}

function getPool() {
  const activeDb = getActiveDatabaseName();
  if (activeDb === 'nextlink_test_db') {
    return getTestPool();
  }
  if (process.env.NODE_ENV === 'test' || process.env.STRICT_TEST_DB === 'true') {
    throw new Error(
      `CRITICAL ISOLATION HALT: Cannot access production database 'nextlink_db' when test isolation is active!`
    );
  }
  return getProdPool();
}

function runWithDatabase(database, fn) {
  return dbContext.run({ database }, fn);
}

function runWithTestDb(enabled, fn) {
  return runWithDatabase(enabled ? 'nextlink_test_db' : 'nextlink_db', fn);
}

/** Run a single query with parameterised values. */
async function query(text, params) {
  const result = await getPool().query(text, params);
  return result;
}

/** Run a query and return the first row (or null). */
async function queryOne(text, params) {
  const result = await getPool().query(text, params);
  return result.rows[0] || null;
}

/** Run a query and return all rows as an array. */
async function queryAll(text, params) {
  const result = await getPool().query(text, params);
  return result.rows || [];
}

/**
 * Execute `fn` inside a transaction. Rolls back on any thrown error.
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function healthCheck() {
  try {
    await query('SELECT 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

module.exports = {
  getPool,
  getProdPool,
  getTestPool,
  getActiveDatabaseName,
  runWithDatabase,
  runWithTestDb,
  query,
  queryOne,
  queryAll,
  transaction,
  healthCheck,
  close,
};
