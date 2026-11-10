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
