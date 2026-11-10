'use strict';

/**
 * MikroTik RouterOS API client (v6 / v7 compatible).
 *
 * Implements the RouterOS "API" protocol (port 8728) directly over TCP, so it
 * works against both RouterOS 6.x and 7.x without any native dependency.
 * Protocol reference: sentence = length-prefixed words.
 *
 *   word length (4 bytes, big endian, includes the length field itself)
 *   followed by the word payload.
 *
 * A command sentence ends with an empty word (length 0).
 * Reply words:
 *   !re  -> error reply
 *   !fat -> fatal error
 *   !done-> end of reply
 *   =key -> attribute
 *   .tag -> tag marker
 */

const net = require('net');
const tls = require('tls');

class RouterOsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RouterOsError';
    this.code = code || 'ROUTEROS_ERROR';
  }
}

class RouterOsClient {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port=8728]
   * @param {string} options.user
   * @param {string} options.password
   * @param {boolean} [options.tls=false]
   * @param {number} [options.timeoutMs=8000]
   */
  constructor(options = {}) {
    this.host = options.host;
    this.port = options.port || 8728;
    this.user = options.user || 'admin';
    this.password = options.password || '';
    this.useTls = Boolean(options.tls);
    this.timeoutMs = options.timeoutMs || 8000;

    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
  }

  /** Open the TCP/TLS connection to the router. */
  connect() {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this);

    return new Promise((resolve, reject) => {
      const onError = (err) => {
        cleanup();
        reject(new RouterOsError(`Cannot reach router ${this.host}:${this.port} — ${err.message}`, 'CONNECT_FAILED'));
      };
      const onTimeout = () => {
        cleanup();
        this.socket && this.socket.destroy();
        reject(new RouterOsError(`Connection to ${this.host}:${this.port} timed out`, 'CONNECT_TIMEOUT'));
      };
      const cleanup = () => {
        this.socket && this.socket.removeListener('error', onError);
        this.socket && this.socket.removeListener('timeout', onTimeout);
      };

      const socket = this.useTls
        ? tls.connect({ host: this.host, port: this.port, rejectUnauthorized: false })
        : net.createConnection({ host: this.host, port: this.port });

      this.socket = socket;
      socket.setTimeout(this.timeoutMs);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
      socket.once(this.useTls ? 'secureConnect' : 'connect', () => {
        cleanup();
        socket.setKeepAlive(true, 30000);
        resolve(this);
      });

      socket.on('data', (chunk) => this._onData(chunk));
      socket.on('error', (err) => {
        this._rejectAll(new RouterOsError(err.message, 'SOCKET_ERROR'));
      });
      socket.on('close', () => {
        this._rejectAll(new RouterOsError('Router closed the connection', 'CONNECTION_CLOSED'));
      });
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    // A word is >= 4 bytes (length prefix). Parse as many as are available.
    for (;;) {
      if (this.buffer.length < 4) return;
      const length = this.buffer.readUInt32LE(0);
      if (length < 4) {
        this._rejectAll(new RouterOsError('Invalid word length from router', 'BAD_LENGTH'));
        return;
      }
      if (this.buffer.length < length) return;

      const payload = this.buffer.subarray(4, length).toString('utf8');
      this.buffer = this.buffer.subarray(length);

      if (payload === '') {
        // End of sentence -> resolve the current pending request.
        const request = this.pending.shift();
        if (request) request.resolve({ done: true, sentences: request.sentences });
        continue;
      }

      const request = this.pending[0];
      if (!request) continue;

      if (payload.startsWith('!')) {
        request.error = payload;
        continue;
      }
      if (payload === '!done') {
        const done = this.pending.shift();
        if (done) done.resolve({ done: true, sentences: done.sentences });
        continue;
      }
      if (payload.startsWith('!')) {
        request.error = payload;
        continue;
      }
      if (payload.startsWith('=')) {
        const eq = payload.indexOf('=');
        const key = payload.slice(1, eq);
        const value = payload.slice(eq + 1);
        request.sentences.push({ [key]: value });
        continue;
      }
      if (payload.startsWith('.')) {
        request.tag = payload.slice(1);
        continue;
      }
      // Plain word (e.g. command echo) — ignore.
    }
  }

  _rejectAll(error) {
    const pending = this.pending.splice(0, this.pending.length);
    pending.forEach((request) => request.reject(error));
  }

  /** Encode a list of words into a RouterOS sentence buffer. */
  _encode(words) {
    const chunks = [];
    for (const word of words) {
      const data = Buffer.from(word, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32LE(data.length + 4, 0);
      chunks.push(length, data);
    }
    chunks.push(Buffer.alloc(4)); // empty word terminates the sentence
    return Buffer.concat(chunks);
  }

  /**
   * Send a command and collect the reply attributes.
   * @param {string} command e.g. '/ip/ppp/active/print'
   * @param {Record<string,string|number>} [attrs]
   * @returns {Promise<Array<Record<string,string>>>}
   */
  async send(command, attrs = {}) {
    await this.connect();

    const words = [command];
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null) continue;
      words.push(`=${key}`);
      words.push(`=${String(value)}`);
    }

    return new Promise((resolve, reject) => {
      const request = { sentences: [], resolve: null, reject: null };
      const timer = setTimeout(() => {
        const index = this.pending.indexOf(request);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new RouterOsError(`Router command timed out: ${command}`, 'COMMAND_TIMEOUT'));
      }, this.timeoutMs);

      request.resolve = (result) => {
        clearTimeout(timer);
        if (request.error) {
          reject(new RouterOsError(request.error.replace(/^!/, ''), 'ROUTEROS_REPLY_ERROR'));
          return;
        }
        resolve(result.sentences);
      };
      request.reject = (err) => {
        clearTimeout(timer);
        reject(err);
      };

      this.pending.push(request);
      try {
        this.socket.write(this._encode(words));
      } catch (err) {
        request.reject(new RouterOsError(err.message, 'WRITE_FAILED'));
      }
    });
  }

  /** Log in to the router. RouterOS 6+ accepts plaintext login over the API port. */
  async login() {
    const result = await this.send('/login', { name: this.user, password: this.password });
    return result.length > 0;
  }

  /** Close the connection. */
  async close() {
    if (this.socket && !this.socket.destroyed) {
      try {
        this.socket.end();
        this.socket.destroy();
      } catch {
        /* ignore */
      }
    }
    this.socket = null;
    this.buffer = Buffer.alloc(0);
  }

  // -------------------------------------------------------------------------
  // High level operations used by the billing / provisioning engine
  // -------------------------------------------------------------------------

  /** Fetch router identity + resource info. */
  async getSystemInfo() {
    const [identity, resource] = await Promise.all([
      this.send('/system/identity/print').catch(() => []),
      this.send('/system/resource/print').catch(() => []),
    ]);
    return {
      identity: identity[0]?.name || 'MikroTik',
      version: resource[0]?.version || 'unknown',
      boardName: resource[0]?.['board-name'] || '',
      uptime: resource[0]?.uptime || '',
      cpu: resource[0]?.['cpu-load'] || '',
      freeMemory: resource[0]?.['free-memory'] || '',
    };
  }

  /** List PPPoE secrets (v6: /ppp/secret, v7: /ppp/secret). */
  async listPppoeSecrets() {
    const rows = await this.send('/ppp/secret/print');
    return rows.map((row) => ({
      name: row.name,
      service: row.service || 'pppoe',
      profile: row.profile || 'default',
      remoteAddress: row['remote-address'] || '',
      address: row.address || '',
      disabled: row.disabled === 'true',
      comment: row.comment || '',
      lastLoggedIn: row['last-logged-in'] || '',
    }));
  }

  /** Enable or disable a PPPoE secret (suspend / restore service). */
  async setPppoeSecretDisabled(name, disabled) {
    await this.send('/ppp/secret/set', {
      '.id': this._findSecretId(name),
      disabled: disabled ? 'yes' : 'no',
    });
    return { name, disabled };
  }

  /** Update the profile (rate limits) of a PPPoE secret. */
  async setPppoeSecretProfile(name, profile) {
    await this.send('/ppp/secret/set', { '.id': this._findSecretId(name), profile });
    return { name, profile };
  }

  /** List active PPPoE sessions. */
  async listActiveSessions() {
    const rows = await this.send('/ppp/active/print');
    return rows.map((row) => ({
      id: row['.id'] || '',
      name: row.name || '',
      address: row.address || '',
      callerId: row['caller-id'] || '',
      uptime: row.uptime || '',
      bytes: row.bytes || '',
      rxBytes: row['rx-byte'] || '',
      txBytes: row['tx-byte'] || '',
    }));
  }

  /** Kick a live PPPoE session (force reconnect). */
  async removeActiveSession(id) {
    await this.send('/ppp/active/remove', { '.id': id });
    return { id };
  }

  /** List simple queues. */
  async listQueues() {
    const rows = await this.send('/queue/simple/print');
    return rows.map((row) => ({
      id: row['.id'] || '',
      name: row.name || '',
      target: row.target || '',
      maxLimit: row['max-limit'] || '',
      disabled: row.disabled === 'true',
    }));
  }

  /** Update the max-limit of a simple queue. */
  async setQueueLimit(name, maxLimit) {
    await this.send('/queue/simple/set', { name, 'max-limit': maxLimit });
    return { name, maxLimit };
  }

  async _findSecretId(name) {
    const rows = await this.send('/ppp/secret/print', { '?name': name });
    if (!rows || rows.length === 0) {
      throw new RouterOsError(`PPPoE secret not found: ${name}`, 'SECRET_NOT_FOUND');
    }
    return rows[0]['.id'];
  }
}

module.exports = { RouterOsClient, RouterOsError };
