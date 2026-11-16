'use strict';

/**
 * In-memory MikroTik simulator.
 *
 * Behaves like a RouterOS core router for the operations the billing and
 * provisioning engines need:
 *   - PPPoE secret enable/disable/create/profile update
 *   - Static IP simple queue rate limiting and bandwidth shaping
 *   - Firewall address-list manipulation (e.g. suspended_subscribers)
 *   - Active session drop / reconnection kicks
 *
 * Used when MIKROTIK_MODE=simulator or as a safe fallback when router
 * hardware is unreachable, ensuring zero crashes and full audit logging.
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
    this.addressLists = new Map();
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
      comment: 'Default 10M plan queue',
    });
    this.queues.set('guest-profile', {
      name: 'guest-profile',
      target: '10.10.10.0/24',
      maxLimit: '2M/2M',
      disabled: true,
      comment: 'Guest queue',
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
   */
  ensureSecret(name, { profile = 'default-10m', comment = '', remoteAddress = '', address = '10.10.10.1' } = {}) {
    if (!this.secrets.has(name)) {
      this.secrets.set(name, {
        name,
        profile,
        service: 'pppoe',
        remoteAddress: remoteAddress || `10.10.10.${(this.secrets.size % 200) + 10}`,
        address,
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

  async setQueueDisabled(name, disabled) {
    const queue = this.queues.get(name);
    if (queue) {
      queue.disabled = Boolean(disabled);
      return { name, disabled: queue.disabled };
    }
    return { name, disabled: Boolean(disabled) };
  }

  async ensureQueue(name, { target = '0.0.0.0/0', maxLimit = '10M/10M', comment = '', disabled = false } = {}) {
    const existing = this.queues.get(name);
    if (existing) {
      if (maxLimit) existing.maxLimit = maxLimit;
      if (target) existing.target = target;
      if (disabled !== undefined) existing.disabled = Boolean(disabled);
      if (comment) existing.comment = comment;
      return { name, created: false, ...existing };
    }
    const newQueue = { name, target, maxLimit, comment, disabled: Boolean(disabled) };
    this.queues.set(name, newQueue);
    return { name, created: true, ...newQueue };
  }

  async removeQueue(name) {
    const existed = this.queues.delete(name);
    return { name, removed: existed };
  }

  async addAddressList(list, address, { comment = '', disabled = false } = {}) {
    const key = `${list}:${address}`;
    this.addressLists.set(key, {
      list,
      address,
      comment,
      disabled: Boolean(disabled),
    });
    return { list, address, added: true };
  }

  async removeAddressList(list, address) {
    const key = `${list}:${address}`;
    const existed = this.addressLists.delete(key);
    return { list, address, removed: existed };
  }

  async listAddressList(listName) {
    const all = Array.from(this.addressLists.values());
    if (!listName) return all;
    return all.filter((entry) => entry.list === listName);
  }

  /**
   * The generic RouterOS command API, matching RouterOsClient.send().
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
      if (attrs.target) target.target = attrs.target;
      return { ret: id };
    }

    if (path === '/queue/simple/add') {
      const name = attrs.name;
      if (name && !this.queues.has(name)) {
        this.queues.set(name, {
          name,
          target: attrs.target || '0.0.0.0/0',
          maxLimit: attrs['max-limit'] || '10M/10M',
          disabled: attrs.disabled === 'yes' || attrs.disabled === true,
          comment: attrs.comment || '',
        });
      }
      return { ret: `*${this.queues.size}` };
    }

    if (path === '/queue/simple/remove') {
      const id = attrs['.id'];
      for (const [name, queue] of this.queues.entries()) {
        const idx = Array.from(this.queues.values()).indexOf(queue);
        if (`*${idx}` === id || name === id) {
          this.queues.delete(name);
          break;
        }
      }
      return { ret: id };
    }

    if (path === '/ip/firewall/address-list/print') {
      const list = attrs['?list'];
      const address = attrs['?address'];
      return Array.from(this.addressLists.values())
        .filter((item) => (!list || item.list === list) && (!address || item.address === address))
        .map((item, index) => ({ '.id': `*${index}`, ...item }));
    }

    if (path === '/ip/firewall/address-list/add') {
      const list = attrs.list;
      const address = attrs.address;
      if (list && address) {
        const key = `${list}:${address}`;
        this.addressLists.set(key, {
          list,
          address,
          comment: attrs.comment || '',
          disabled: attrs.disabled === 'yes' || attrs.disabled === true,
        });
      }
      return { ret: `*${this.addressLists.size}` };
    }

    if (path === '/ip/firewall/address-list/set') {
      const id = attrs['.id'];
      const list = attrs.list;
      const address = attrs.address;
      for (const item of this.addressLists.values()) {
        if ((list && address && item.list === list && item.address === address) || id) {
          if (attrs.disabled !== undefined) item.disabled = attrs.disabled === 'yes' || attrs.disabled === true;
          if (attrs.comment !== undefined) item.comment = attrs.comment;
          break;
        }
      }
      return { ret: id || `${list}:${address}` };
    }

    if (path === '/ip/firewall/address-list/remove') {
      const id = attrs['.id'];
      for (const [key, item] of this.addressLists.entries()) {
        const idx = Array.from(this.addressLists.values()).indexOf(item);
        if (`*${idx}` === id || (attrs.list === item.list && attrs.address === item.address)) {
          this.addressLists.delete(key);
          break;
        }
      }
      return { ret: id };
    }

    if (path === '/system/identity/print') {
      return [{ name: this.identity }];
    }

    if (path === '/system/resource/print') {
      return [{ version: this.version, 'board-name': this.boardName, uptime: '1w2d3h4m', 'cpu-load': '5', 'free-memory': '213500000' }];
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
