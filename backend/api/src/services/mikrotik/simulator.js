'use strict';

/**
 * In-memory MikroTik simulator.
 *
 * Behaves like a RouterOS core router for the operations the billing engine
 * needs (PPPoE secret enable/disable, profile changes, session kicks, queues).
 * Used when MIKROTIK_MODE=simulator so the whole automation pipeline can be
 * exercised without physical hardware.
 *
 * The simulator intentionally mirrors the RouterOsClient public API so the
 * service layer can switch between real and simulated routers transparently.
 */

const crypto = require('crypto');

class RouterOsSimulator {
  constructor(options = {}) {
    this.identity = options.identity || 'NextLink-Core-Sim';
    this.version = options.version || '7.14.3 (stable)';
    this.boardName = options.boardName || 'CHR';
    this.user = options.user || 'admin';

    this.secrets = new Map();
    this.queues = new Map();
    this.sessions = new Map();
    this._seedDefaults();
  }

  _seedDefaults() {
    const defaults = [
      { name: 'demo', profile: 'default-10m', remoteAddress: '10.10.10.2', address: '10.10.10.1', disabled: false, comment: 'Demo subscriber' },
      { name: 'demo2', profile: 'default-10m', remoteAddress: '10.10.10.3', address: '10.10.10.1', disabled: false, comment: 'Second demo subscriber' },
      { name: 'guest', profile: 'guest-profile', remoteAddress: '10.10.10.9', address: '10.10.10.1', disabled: true, comment: 'Suspended guest' },
    ];
    defaults.forEach((entry) => {
      this.secrets.set(entry.name, { ...entry });
    });

    this.queues.set('default-10m', {
      name: 'default-10m',
      target: '10.10.10.0/24',
      maxLimit: '10M/10M',
      disabled: false,
    });
    this.queues.set('guest-profile', {
      name: 'guest-profile',
      target: '10.10.10.0/24',
      maxLimit: '2M/2M',
      disabled: true,
    });
  }

  async connect() {
    return this;
  }

  async login() {
    return true;
  }

  async close() {
    return true;
  }

  async getSystemInfo() {
    return {
      identity: this.identity,
      version: this.version,
      boardName: this.boardName,
      uptime: '1w2d3h4m',
      cpu: Number((Math.random() * 20).toFixed(1)),
      freeMemory: 213_500_000,
      simulated: true,
    };
  }

  /**
   * Ensure a PPPoE secret exists for a subscriber.
   * Mirrors a real router where the secret is created at activation time.
   */
  ensureSecret(name, { profile = 'default-10m', comment = '' } = {}) {
    if (!this.secrets.has(name)) {
      this.secrets.set(name, {
        name,
        profile,
        service: 'pppoe',
        remoteAddress: `10.10.10.${(this.secrets.size % 200) + 10}`,
        address: '10.10.10.1',
        disabled: false,
        comment,
      });
      return { created: true };
    }
    return { created: false };
  }

  async listPppoeSecrets() {
    return Array.from(this.secrets.values()).map((entry) => ({ ...entry }));
  }

  async setPppoeSecretDisabled(name, disabled) {
    const secret = this.secrets.get(name);
    if (!secret) {
      const error = new Error(`PPPoE secret not found: ${name}`);
      error.code = 'SECRET_NOT_FOUND';
      throw error;
    }
    secret.disabled = Boolean(disabled);
    if (disabled) {
      // A disabled secret drops any live session for that user.
      for (const [id, session] of this.sessions.entries()) {
        if (session.name === name) this.sessions.delete(id);
      }
    }
    return { name, disabled: secret.disabled };
  }

  async setPppoeSecretProfile(name, profile) {
    const secret = this.secrets.get(name);
    if (!secret) {
      const error = new Error(`PPPoE secret not found: ${name}`);
      error.code = 'SECRET_NOT_FOUND';
      throw error;
    }
    secret.profile = profile;
    return { name, profile };
  }

  async listActiveSessions() {
    return Array.from(this.sessions.entries()).map(([id, session]) => ({ id, ...session }));
  }

  async removeActiveSession(id) {
    const existed = this.sessions.delete(id);
    return { id, removed: existed };
  }

  async listQueues() {
    return Array.from(this.queues.values()).map((queue) => ({ ...queue }));
  }

  async setQueueLimit(name, maxLimit) {
    const queue = this.queues.get(name);
    if (!queue) {
      const error = new Error(`Queue not found: ${name}`);
      error.code = 'QUEUE_NOT_FOUND';
      throw error;
    }
    queue.maxLimit = maxLimit;
    return { name, maxLimit };
  }

  /**
   * The generic RouterOS command API, exactly like the real client.
   *
   * The service layer talks to the router through `send()`, so the simulator
   * has to implement the same contract — otherwise provisioning a new secret
   * fails in simulator mode with "client.send is not a function".
   */
  async send(command, attrs = {}) {
    const path = String(command || '');

    if (path === '/login') {
      return { status: 'success' };
    }

    if (path === '/ppp/secret/print') {
      const name = attrs['?name'];
      const rows = Array.from(this.secrets.values()).filter(
        (entry) => !name || entry.name === name,
      );
      return rows.map((entry, index) => ({ '.id': `*${index}`, ...entry }));
    }

    if (path === '/ppp/secret/add') {
      const name = attrs.name;
      if (!name) {
        const error = new Error('name is required');
        error.code = 'SIMULATOR_ERROR';
        throw error;
      }
      if (!this.secrets.has(name)) {
        this.secrets.set(name, {
          name,
          profile: attrs.profile || 'default-10m',
          service: attrs.service || 'pppoe',
          'remote-address': attrs['remote-address'] || '',
          address: attrs.address || '',
          disabled: attrs.disabled === 'yes' || attrs.disabled === true,
          comment: attrs.comment || '',
        });
      }
      return { ret: `*${Array.from(this.secrets.keys()).indexOf(name)}` };
    }

    if (path === '/ppp/secret/set') {
      const target = attrs['.id'];
      const name = attrs['?name'];
      const entry = this._findSecret(target, name);
      if (!entry) {
        const error = new Error(`no such item (${target || name})`);
        error.code = 'SIMULATOR_ERROR';
        throw error;
      }
      if (attrs.disabled !== undefined) {
        entry.disabled = attrs.disabled === 'yes' || attrs.disabled === true;
      }
      if (attrs.profile) entry.profile = attrs.profile;
      if (attrs.password) entry.password = attrs.password;
      if (attrs.comment !== undefined) entry.comment = attrs.comment;
      return { ret: target || entry.name };
    }

    if (path === '/ppp/secret/remove') {
      const target = attrs['.id'];
      const name = attrs['?name'];
      const entry = this._findSecret(target, name);
      if (entry) this.secrets.delete(entry.name);
      return { ret: target || name };
    }

    if (path === '/ppp/active/print') {
      return Array.from(this.sessions.entries()).map(([id, session]) => ({ '.id': id, ...session }));
    }

    if (path === '/ppp/active/remove') {
      const id = attrs['.id'];
      this.sessions.delete(id);
      return { ret: id };
    }

    if (path === '/queue/simple/print') {
      const name = attrs['?name'];
      return Array.from(this.queues.values())
        .filter((queue) => !name || queue.name === name)
        .map((queue, index) => ({ '.id': `*${index}`, ...queue }));
    }

    if (path === '/queue/simple/set') {
      const id = attrs['.id'];
      const target = Array.from(this.queues.values()).find(
        (queue, index) => `*${index}` === id || queue.name === id,
      );
      if (!target) {
        const error = new Error(`no such item (${id})`);
        error.code = 'SIMULATOR_ERROR';
        throw error;
      }
      if (attrs['max-limit']) target.maxLimit = attrs['max-limit'];
      if (attrs.disabled !== undefined) target.disabled = attrs.disabled === 'yes' || attrs.disabled === true;
      return { ret: id };
    }

    if (path === '/system/identity/print') {
      return { name: this.identity };
    }

    if (path === '/system/resource/print') {
      return { version: this.version, boardName: this.boardName, uptime: '1w2d3h4m' };
    }

    const error = new Error(`Simulator does not implement: ${path}`);
    error.code = 'SIMULATOR_ERROR';
    throw error;
  }

  _findSecret(id, name) {
    if (name) return this.secrets.get(name) || null;
    if (!id) return null;
    const match = /^\*(\d+)$/.exec(String(id));
    if (match) {
      const index = Number(match[1]);
      return Array.from(this.secrets.values())[index] || null;
    }
    return this.secrets.get(String(id)) || null;
  }

  /**
   * Simulate a subscriber logging in (used by tests and the "connect" demo).
   */
  simulateLogin(name) {
    const secret = this.secrets.get(name);
    if (!secret || secret.disabled) {
      const error = new Error(`Cannot log in: ${name} is unknown or disabled`);
      error.code = 'LOGIN_REJECTED';
      throw error;
    }
    const id = crypto.randomBytes(4).toString('hex');
    const session = {
      name,
      address: secret.address,
      callerId: `pppoe-${name}`,
      uptime: '00:00:01',
      bytes: '0',
      rxBytes: '0',
      txBytes: '0',
    };
    this.sessions.set(id, session);
    return { id, ...session };
  }
}

module.exports = { RouterOsSimulator };
