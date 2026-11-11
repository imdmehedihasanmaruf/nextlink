'use strict';

const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function getPool() {
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
}

module.exports = { getPool, query, queryOne, transaction, healthCheck, close };
