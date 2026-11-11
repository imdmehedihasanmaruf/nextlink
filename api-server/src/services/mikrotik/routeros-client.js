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
    this.loggedIn = false;
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
      if (request.pendingKey === undefined) request.pendingKey = null;
      if (request.current === undefined) request.current = {};

      // `!done` ends the reply successfully and must be checked before the
      // generic `!` error prefix, otherwise every command reports "done" as
      // a failure.
      if (payload === '!done') {
        const done = this.pending.shift();
        if (done) {
          // Flush the record that is still being built.
          if (Object.keys(done.current || {}).length > 0) {
            done.sentences.push(done.current);
            done.current = {};
          }
          done.resolve({ done: true, sentences: done.sentences });
        }
        continue;
      }

      // `!trap` (command error) and `!fatal` (connection error).
      if (payload.startsWith('!')) {
        request.error = payload;
        if (payload === '!fatal') {
          this._rejectAll(new RouterOsError('Router reported a fatal error', 'ROUTEROS_FATAL'));
        } else {
          // `!trap` is the last word before the sentence terminator, so the
          // request is failed right away instead of waiting for the timeout.
          const trapped = this.pending.shift();
          if (trapped) trapped.reject(new RouterOsError(payload.replace(/^!/, ''), 'ROUTEROS_REPLY_ERROR'));
        }
        continue;
      }

      if (payload.startsWith('=')) {
        // A RouterOS reply is a flat list of alternating words: "=key" then
        // "=value". Records are not explicitly delimited — a new ".id" starts
        // the next record, and a repeated key does the same.
        const rest = payload.slice(1);
        const eq = rest.indexOf('=');

        if (eq >= 0) {
          // Self-contained attribute: "=key=value".
          const key = rest.slice(0, eq);
          const value = rest.slice(eq + 1);
          if (Object.prototype.hasOwnProperty.call(request.current, key)) {
            request.sentences.push(request.current);
            request.current = {};
          }
          request.current[key] = value;
          request.pendingKey = null;
        } else if (request.pendingKey !== null) {
          // This word is the value of the key that preceded it.
          request.current[request.pendingKey] = rest;
          request.pendingKey = null;
        } else {
          // A new attribute name.
          if (rest === '.id' && Object.keys(request.current).length > 0) {
            // A new ".id" means the previous record is complete.
            request.sentences.push(request.current);
            request.current = {};
          }
          request.current[rest] = '';
          request.pendingKey = rest;
        }
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
    // The sentence terminator is an empty word. Its length field still counts
    // the 4 length bytes, so it must be 4 and not 0.
    const terminator = Buffer.alloc(4);
    terminator.writeUInt32LE(4, 0);
    chunks.push(terminator);
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

    // Everything except the login itself requires an authenticated session.
    if (command !== '/login') {
      await this.ensureLoggedIn();
    }

    const words = [command];
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null) continue;
      words.push(`=${key}`);
      words.push(`=${String(value)}`);
    }

    return new Promise((resolve, reject) => {
      const request = { sentences: [], current: {}, pendingKey: null, resolve: null, reject: null };
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
    if (this.loggedIn) return true;
    const result = await this.send('/login', { name: this.user, password: this.password });
    this.loggedIn = true;
    return result.length > 0;
  }

  /**
   * Ensure the session is authenticated before running a command.
   * RouterOS closes the connection for unauthenticated commands, so the
   * login has to happen first.
   */
  async ensureLoggedIn() {
    if (this.loggedIn) return;
    await this.login();
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
    // The commands must run one after another: the protocol multiplexes
    // replies over a single socket, so parallel commands can be matched to
    // the wrong request.
    const identity = await this.send('/system/identity/print').catch(() => []);
    const resource = await this.send('/system/resource/print').catch(() => []);
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
      // RouterOS reports booleans as "yes" / "no".
      disabled: row.disabled === 'true' || row.disabled === 'yes',
      comment: row.comment || '',
      lastLoggedIn: row['last-logged-in'] || '',
      id: row['.id'] || '',
    }));
  }

  /** Enable or disable a PPPoE secret (suspend / restore service). */
  async setPppoeSecretDisabled(name, disabled) {
    // The internal id has to be resolved first — RouterOS addresses a record
    // by its ".id", not by its name.
    const id = await this._findSecretId(name);
    await this.send('/ppp/secret/set', {
      '.id': id,
      // RouterOS expects "yes" / "no" for a boolean attribute.
      disabled: disabled ? 'yes' : 'no',
    });
    return { name, disabled };
  }

  /** Update the profile (rate limits) of a PPPoE secret. */
  async setPppoeSecretProfile(name, profile) {
    const id = await this._findSecretId(name);
    await this.send('/ppp/secret/set', { '.id': id, profile });
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
    // RouterOS addresses a record by its internal id, not by its name.
    const rows = await this.send('/queue/simple/print', { '?name': name });
    if (!rows || rows.length === 0) {
      throw new RouterOsError(`Queue not found: ${name}`, 'QUEUE_NOT_FOUND');
    }
    await this.send('/queue/simple/set', { '.id': rows[0]['.id'], 'max-limit': maxLimit });
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
