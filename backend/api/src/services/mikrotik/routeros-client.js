'use strict';

/**
 * MikroTik RouterOS API client (v6 / v7 compatible).
 *
 * Implements the standard RouterOS API wire protocol over TCP/TLS (port 8728 / 8729),
 * supporting both RouterOS 6.x and 7.x:
 *   - Plaintext authentication (RouterOS 6.43+ and 7.x)
 *   - Challenge/response MD5 fallback (RouterOS 6.x legacy)
 *   - Standard variable-length binary word encoding (1–5 byte prefix)
 *   - Backward-compatible detection of 4-byte LE framed mock protocol
 *   - Complete PPPoE secrets, active sessions, simple queues, and firewall address-lists.
 */

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

class RouterOsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RouterOsError';
    this.code = code || 'ROUTEROS_ERROR';
  }
}

/**
 * Decode next word length and payload from buffer.
 * Returns null if buffer does not contain a full word yet.
 */
function decodeWord(buf) {
  if (buf.length < 1) return null;
  const b0 = buf[0];

  // Detect 4-byte LE framing (bytes 1..3 are 0x00 and length >= 4)
  if (buf.length >= 4 && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
    const leLen = buf.readUInt32LE(0);
    if (leLen >= 4) {
      const payloadLen = leLen - 4;
      if (buf.length < 4 + payloadLen) return null;
      const payload = buf.subarray(4, 4 + payloadLen).toString('utf8');
      return { payload, bytesConsumed: 4 + payloadLen, isTerminator: payload === '', format: 'le' };
    }
  }

  // Standard variable length framing:
  if (b0 === 0x00) {
    return { payload: '', bytesConsumed: 1, isTerminator: true, format: 'standard' };
  }

  let len = 0;
  let prefixLen = 0;

  if (b0 < 0x80) {
    len = b0;
    prefixLen = 1;
  } else if (b0 < 0xc0) {
    if (buf.length < 2) return null;
    len = ((b0 & 0x3f) << 8) | buf[1];
    prefixLen = 2;
  } else if (b0 < 0xe0) {
    if (buf.length < 3) return null;
    len = ((b0 & 0x1f) << 16) | (buf[1] << 8) | buf[2];
    prefixLen = 3;
  } else if (b0 < 0xf0) {
    if (buf.length < 4) return null;
    len = ((b0 & 0x0f) << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
    prefixLen = 4;
  } else if (b0 === 0xf0) {
    if (buf.length < 5) return null;
    len = buf.readUInt32BE(1);
    prefixLen = 5;
  }

  if (buf.length < prefixLen + len) return null;
  const payload = buf.subarray(prefixLen, prefixLen + len).toString('utf8');
  return { payload, bytesConsumed: prefixLen + len, isTerminator: false, format: 'standard' };
}

/**
 * Encode word length in standard RouterOS API variable length.
 */
function encodeLength(len) {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  if (len < 0x4000) {
    return Buffer.from([(len >> 8) | 0x80, len & 0xff]);
  }
  if (len < 0x200000) {
    return Buffer.from([(len >> 16) | 0xc0, (len >> 8) & 0xff, len & 0xff]);
  }
  if (len < 0x10000000) {
    return Buffer.from([(len >> 24) | 0xe0, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xf0;
  buf.writeUInt32BE(len, 1);
  return buf;
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
    this.wireFormat = 'standard';
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

    for (;;) {
      const decoded = decodeWord(this.buffer);
      if (!decoded) return;

      this.buffer = this.buffer.subarray(decoded.bytesConsumed);
      this.wireFormat = decoded.format;

      const payload = decoded.payload;

      if (decoded.isTerminator) {
        // End of sentence -> resolve the current pending request.
        const request = this.pending.shift();
        if (request) {
          if (Object.keys(request.current || {}).length > 0) {
            request.sentences.push(request.current);
            request.current = {};
          }
          request.resolve({ done: true, sentences: request.sentences });
        }
        continue;
      }

      const request = this.pending[0];
      if (!request) continue;
      if (request.pendingKey === undefined) request.pendingKey = null;
      if (request.current === undefined) request.current = {};

      if (payload === '!done') {
        const done = this.pending.shift();
        if (done) {
          if (Object.keys(done.current || {}).length > 0) {
            done.sentences.push(done.current);
            done.current = {};
          }
          done.resolve({ done: true, sentences: done.sentences });
        }
        continue;
      }

      if (payload.startsWith('!')) {
        request.error = payload;
        if (payload === '!fatal') {
          this._rejectAll(new RouterOsError('Router reported a fatal error', 'ROUTEROS_FATAL'));
        } else {
          const trapped = this.pending.shift();
          if (trapped) trapped.reject(new RouterOsError(payload.replace(/^!/, ''), 'ROUTEROS_REPLY_ERROR'));
        }
        continue;
      }

      if (payload.startsWith('=')) {
        const rest = payload.slice(1);
        const eq = rest.indexOf('=');

        if (eq >= 0) {
          const key = rest.slice(0, eq);
          const value = rest.slice(eq + 1);
          if (Object.prototype.hasOwnProperty.call(request.current, key)) {
            request.sentences.push(request.current);
            request.current = {};
          }
          request.current[key] = value;
          request.pendingKey = null;
        } else if (request.pendingKey !== null) {
          request.current[request.pendingKey] = rest;
          request.pendingKey = null;
        } else {
          if (rest === '.id' && Object.keys(request.current).length > 0) {
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
    }
  }

  _rejectAll(error) {
    const pending = this.pending.splice(0, this.pending.length);
    pending.forEach((request) => request.reject(error));
  }

  /** Encode a list of words into a RouterOS sentence buffer. */
  _encode(words) {
    if (this.wireFormat === 'le') {
      const chunks = [];
      for (const word of words) {
        const data = Buffer.from(word, 'utf8');
        const length = Buffer.alloc(4);
        length.writeUInt32LE(data.length + 4, 0);
        chunks.push(length, data);
      }
      const terminator = Buffer.alloc(4);
      terminator.writeUInt32LE(4, 0);
      chunks.push(terminator);
      return Buffer.concat(chunks);
    }

    const chunks = [];
    for (const word of words) {
      const data = Buffer.from(word, 'utf8');
      chunks.push(encodeLength(data.length));
      chunks.push(data);
    }
    chunks.push(Buffer.from([0x00]));
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

  /**
   * Log in to the router.
   * Supports both plaintext login (RouterOS 6.43+ & 7.x) and challenge-response (legacy RouterOS 6.x).
   */
  async login() {
    if (this.loggedIn) return true;

    const result = await this.send('/login', { name: this.user, password: this.password });

    // Legacy RouterOS v6 (< 6.43) returns a challenge that requires an MD5 response
    const challenge = result[0]?.ret;
    if (challenge && typeof challenge === 'string' && challenge.length >= 16) {
      const md5 = crypto.createHash('md5');
      md5.update(Buffer.from([0]));
      md5.update(Buffer.from(this.password, 'utf8'));
      md5.update(Buffer.from(challenge, 'hex'));
      const response = '00' + md5.digest('hex');
      await this.send('/login', { name: this.user, response });
    }

    this.loggedIn = true;
    return true;
  }

  async ensureLoggedIn() {
    if (this.loggedIn) return;
    await this.login();
  }

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
    this.loggedIn = false;
  }

  // -------------------------------------------------------------------------
  // High level operations
  // -------------------------------------------------------------------------

  /** Fetch router identity + resource info (v6 & v7 compatible). */
  async getSystemInfo() {
    const identity = await this.send('/system/identity/print');
    const resource = await this.send('/system/resource/print');
    if (!identity.length && !resource.length) {
      throw new RouterOsError('The router did not return its identity or resource information.');
    }
    return {
      identity: identity[0]?.name || '',
      version: resource[0]?.version || '',
      boardName: resource[0]?.['board-name'] || '',
      uptime: resource[0]?.uptime || '',
      cpu: resource[0]?.['cpu-load'] || '',
      freeMemory: resource[0]?.['free-memory'] || '',
    };
  }

  /** List PPPoE secrets (v6 & v7). */
  async listPppoeSecrets() {
    const rows = await this.send('/ppp/secret/print');
    return rows.map((row) => ({
      name: row.name,
      service: row.service || 'pppoe',
      profile: row.profile || 'default',
      remoteAddress: row['remote-address'] || '',
      address: row.address || '',
      disabled: row.disabled === 'true' || row.disabled === 'yes',
      comment: row.comment || '',
      lastLoggedIn: row['last-logged-in'] || '',
      id: row['.id'] || '',
    }));
  }

  /** Enable or disable a PPPoE secret. */
  async setPppoeSecretDisabled(name, disabled) {
    const id = await this._findSecretId(name);
    await this.send('/ppp/secret/set', {
      '.id': id,
      disabled: disabled ? 'yes' : 'no',
    });
    return { name, disabled: Boolean(disabled) };
  }

  /** Update the profile of a PPPoE secret. */
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

  /** Kick a live PPPoE session by session id. */
  async removeActiveSession(id) {
    await this.send('/ppp/active/remove', { '.id': id });
    return { id };
  }

  /** Kick all live PPPoE sessions for a given username. */
  async removeActiveSessionsByName(username) {
    const sessions = await this.listActiveSessions();
    let count = 0;
    for (const session of sessions) {
      if (!username || session.name === username) {
        await this.removeActiveSession(session.id);
        count += 1;
      }
    }
    return { username, kickedCount: count };
  }

  /** List simple queues. */
  async listQueues() {
    const rows = await this.send('/queue/simple/print');
    return rows.map((row) => ({
      id: row['.id'] || '',
      name: row.name || '',
      target: row.target || '',
      maxLimit: row['max-limit'] || '',
      disabled: row.disabled === 'true' || row.disabled === 'yes',
    }));
  }

  /** Update the max-limit of a simple queue. */
  async setQueueLimit(name, maxLimit) {
    const rows = await this.send('/queue/simple/print', { '?name': name });
    if (!rows || rows.length === 0) {
      throw new RouterOsError(`Queue not found: ${name}`, 'QUEUE_NOT_FOUND');
    }
    await this.send('/queue/simple/set', { '.id': rows[0]['.id'], 'max-limit': maxLimit });
    return { name, maxLimit };
  }

  /** Enable or disable a simple queue. */
  async setQueueDisabled(name, disabled) {
    const rows = await this.send('/queue/simple/print', { '?name': name });
    if (!rows || rows.length === 0) {
      return { name, disabled, found: false };
    }
    await this.send('/queue/simple/set', { '.id': rows[0]['.id'], disabled: disabled ? 'yes' : 'no' });
    return { name, disabled, found: true };
  }

  /** Ensure a simple queue exists with the given limits and target IP. */
  async ensureQueue({ name, target, maxLimit, comment, disabled = false }) {
    const rows = await this.send('/queue/simple/print', { '?name': name });
    if (rows && rows.length > 0) {
      const existing = rows[0];
      const attrs = { '.id': existing['.id'] };
      if (maxLimit) attrs['max-limit'] = maxLimit;
      if (target) attrs.target = target;
      if (disabled !== undefined) attrs.disabled = disabled ? 'yes' : 'no';
      if (comment) attrs.comment = comment;
      await this.send('/queue/simple/set', attrs);
      return { name, created: false, maxLimit, disabled };
    }
    await this.send('/queue/simple/add', {
      name,
      target: target || '0.0.0.0/0',
      'max-limit': maxLimit || '10M/10M',
      disabled: disabled ? 'yes' : 'no',
      comment: comment || '',
    });
    return { name, created: true, maxLimit, disabled };
  }

  /** Remove a simple queue by name. */
  async removeQueue(name) {
    const rows = await this.send('/queue/simple/print', { '?name': name });
    if (rows && rows.length > 0) {
      await this.send('/queue/simple/remove', { '.id': rows[0]['.id'] });
      return { name, removed: true };
    }
    return { name, removed: false };
  }

  /** List firewall address-list entries (e.g. for suspended subscribers). */
  async listAddressList(listName) {
    const attrs = listName ? { '?list': listName } : {};
    const rows = await this.send('/ip/firewall/address-list/print', attrs);
    return rows.map((row) => ({
      id: row['.id'] || '',
      list: row.list || '',
      address: row.address || '',
      disabled: row.disabled === 'true' || row.disabled === 'yes',
      comment: row.comment || '',
    }));
  }

  /** Add or ensure an entry in a firewall address-list. */
  async addAddressList({ list, address, comment, disabled = false }) {
    const rows = await this.send('/ip/firewall/address-list/print', { '?list': list, '?address': address });
    if (rows && rows.length > 0) {
      await this.send('/ip/firewall/address-list/set', {
        '.id': rows[0]['.id'],
        disabled: disabled ? 'yes' : 'no',
        comment: comment || rows[0].comment || '',
      });
      return { list, address, created: false };
    }
    await this.send('/ip/firewall/address-list/add', {
      list,
      address,
      comment: comment || '',
      disabled: disabled ? 'yes' : 'no',
    });
    return { list, address, created: true };
  }

  /** Remove an entry from a firewall address-list. */
  async removeAddressList(list, address) {
    const rows = await this.send('/ip/firewall/address-list/print', { '?list': list, '?address': address });
    let removed = 0;
    for (const row of rows || []) {
      await this.send('/ip/firewall/address-list/remove', { '.id': row['.id'] });
      removed += 1;
    }
    return { list, address, removedCount: removed };
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
