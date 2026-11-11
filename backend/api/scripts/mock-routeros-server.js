'use strict';

/**
 * A RouterOS API protocol server used to verify the live MikroTik code path.
 *
 * It speaks the real RouterOS wire protocol (length-prefixed words over TCP)
 * and answers the commands the billing engine issues. This proves the
 * `RouterOsClient` works against a genuine protocol implementation rather than
 * only against the in-memory simulator.
 *
 * Usage:
 *   node scripts/mock-routeros-server.js [port]
 *
 * Environment:
 *   MOCK_ROUTEROS_USER     expected username (default: admin)
 *   MOCK_ROUTEROS_PASSWORD expected password (default: nextlink)
 */

const net = require('net');

const PORT = Number(process.argv[2] || process.env.MOCK_ROUTEROS_PORT || 18728);
const EXPECTED_USER = process.env.MOCK_ROUTEROS_USER || 'admin';
const EXPECTED_PASSWORD = process.env.MOCK_ROUTEROS_PASSWORD || 'nextlink';

/**
 * Encode a list of words into a RouterOS sentence.
 */
function encode(words) {
  const chunks = [];
  for (const word of words) {
    const data = Buffer.from(word, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(data.length + 4, 0);
    chunks.push(length, data);
  }
  // Empty word terminator: the length field still counts its own 4 bytes.
  const terminator = Buffer.alloc(4);
  terminator.writeUInt32LE(4, 0);
  chunks.push(terminator);
  return Buffer.concat(chunks);
}

/**
 * The virtual router state.
 */
const state = {
  secrets: new Map([
    ['demo', { name: 'demo', profile: 'default-10m', 'remote-address': '10.10.10.2', address: '10.10.10.1', disabled: 'no', comment: 'Demo subscriber' }],
    ['demo2', { name: 'demo2', profile: 'default-10m', 'remote-address': '10.10.10.3', address: '10.10.10.1', disabled: 'no', comment: 'Second demo subscriber' }],
    ['guest', { name: 'guest', profile: 'guest-profile', 'remote-address': '10.10.10.9', address: '10.10.10.1', disabled: 'yes', comment: 'Suspended guest' }],
  ]),
  queues: new Map([
    ['default-10m', { name: 'default-10m', target: '10.10.10.0/24', 'max-limit': '10M/10M', disabled: 'no' }],
    ['guest-profile', { name: 'guest-profile', target: '10.10.10.0/24', 'max-limit': '2M/2M', disabled: 'yes' }],
  ]),
  sessions: new Map(),
  authenticated: false,
};

/**
 * Build the attribute words for a record.
 *
 * RouterOS sends every attribute of a record as a "=key" word followed by a
 * "=value" word. The ".id" attribute comes first so the client can tell the
 * records apart.
 */
function toWords(record) {
  const words = [];
  const entries = Object.entries(record).sort(([key]) => (key === '.id' ? -1 : 1));
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    words.push(`=${key}`, `=${String(value)}`);
  }
  return words;
}

/**
 * Handle one command sentence.
 */
function handleCommand(words) {
  const command = words.find((word) => word.startsWith('/'));
  const attributes = {};
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].startsWith('=')) {
      const key = words[i].slice(1);
      const value = words[i + 1] && words[i + 1].startsWith('=') ? words[i + 1].slice(1) : '';
      attributes[key] = value;
      i += 1;
    }
  }

  if (!command) return { error: 'no command' };

  // Login.
  if (command === '/login') {
    if (attributes.name === EXPECTED_USER && attributes.password === EXPECTED_PASSWORD) {
      state.authenticated = true;
      return { words: ['=ret=challenge'] };
    }
    return { trap: 'invalid user name or password (6)' };
  }

  if (!state.authenticated && command !== '/logout') {
    return { trap: 'not logged in' };
  }

  if (command === '/system/identity/print') {
    return { words: toWords({ name: 'NextLink-Core-Mock', '.id': '*1' }) };
  }
  if (command === '/system/resource/print') {
    return {
      words: toWords({
        'board-name': 'CHR',
        version: '7.14.3 (stable)',
        uptime: '2w3d4h5m6s',
        'cpu-load': '7',
        'free-memory': '213500000',
        '.id': '*1',
      }),
    };
  }
  if (command === '/ppp/secret/print') {
    const rows = Array.from(state.secrets.values()).map((secret, index) => ({
      ...secret,
      '.id': `*${index + 1}`,
    }));

    // RouterOS supports "?key=value" query attributes to filter the reply.
    let filtered = rows;
    for (const [key, value] of Object.entries(attributes)) {
      if (!key.startsWith('?')) continue;
      const field = key.slice(1);
      filtered = filtered.filter((row) => String(row[field] ?? '') === String(value));
    }

    return { words: filtered.flatMap((row) => toWords(row)) };
  }
  if (command === '/ppp/secret/set') {
    // RouterOS addresses a record by its internal ".id".
    const targetId = attributes['.id'];
    const target = Array.from(state.secrets.values()).find((secret, index) => {
      if (targetId) return `*${index + 1}` === targetId;
      return secret.name === attributes.name;
    });
    if (target) {
      if (attributes.disabled !== undefined) target.disabled = attributes.disabled;
      if (attributes.profile !== undefined) target.profile = attributes.profile;
    }
    return { words: [] };
  }
  if (command === '/ppp/secret/add') {
    const name = attributes.name;
    if (!state.secrets.has(name)) {
      state.secrets.set(name, {
        name,
        profile: attributes.profile || 'default-10m',
        'remote-address': attributes['remote-address'] || '',
        address: attributes.address || '',
        disabled: attributes.disabled || 'false',
        comment: attributes.comment || '',
      });
    }
    return { words: [] };
  }
  if (command === '/ppp/active/print') {
    const rows = Array.from(state.sessions.entries()).map(([id, session]) => ({ ...session, '.id': id }));
    return { words: rows.flatMap((row) => toWords(row)) };
  }
  if (command === '/ppp/active/remove') {
    const id = attributes['.id'];
    if (id) state.sessions.delete(id);
    return { words: [] };
  }
  if (command === '/queue/simple/print') {
    const rows = Array.from(state.queues.values()).map((queue, index) => ({ ...queue, '.id': `*${index + 1}` }));
    return { words: rows.flatMap((row) => toWords(row)) };
  }
  if (command === '/queue/simple/set') {
    const target = state.queues.get(attributes.name);
    if (target && attributes['max-limit'] !== undefined) {
      target['max-limit'] = attributes['max-limit'];
    }
    return { words: [] };
  }

  return { trap: `unknown command ${command}` };
}

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let words = [];

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (length < 4) {
        console.error('bad word length from client');
        socket.destroy();
        return;
      }
      if (buffer.length < length) return;

      const payload = buffer.subarray(4, length).toString('utf8');
      buffer = buffer.subarray(length);

      if (payload === '') {
        const sentence = words;
        words = [];
        let result;
        try {
          result = handleCommand(sentence);
        } catch (error) {
          console.error('command handler threw:', error);
          result = { trap: 'internal error' };
        }
        if (process.env.MOCK_ROUTEROS_VERBOSE) {
          console.log('<-', sentence.join(' '));
        }
        if (result.trap) {
          socket.write(encode([`!trap=${result.trap}`]));
        } else {
          socket.write(encode([...result.words, '!done']));
        }
        continue;
      }
      words.push(payload);
    }
  });

  socket.on('error', (error) => {
    console.error('socket error:', error.message);
  });
  socket.on('close', () => {
    console.log('client disconnected');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock RouterOS API server listening on 127.0.0.1:${PORT}`);
  console.log(`  login: ${EXPECTED_USER} / ${EXPECTED_PASSWORD}`);
});

module.exports = { server, state, encode, handleCommand };
