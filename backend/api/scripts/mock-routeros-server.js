'use strict';

/**
 * A RouterOS API protocol server used to verify the live MikroTik code path.
 *
 * Speaks the real RouterOS wire protocol (standard variable-length binary
 * framing and legacy 4-byte LE framing over TCP) and answers the commands
 * the billing and subscriber provisioning engines issue for both PPPoE and
 * Static IP subscriber queues and firewall address-lists.
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

/**
 * Encode a list of words into a RouterOS sentence buffer.
 * Supports both standard variable-length framing and 4-byte LE framing.
 */
function encode(words, format = 'standard') {
  if (format === 'le') {
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
  // Standard RouterOS API terminator is empty word (single 0x00 byte)
  chunks.push(Buffer.from([0x00]));
  return Buffer.concat(chunks);
}

/**
 * Decode next word length from buffer. Returns null if not enough bytes yet.
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
    // Sentence terminator (empty word)
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
  addressLists: new Map(),
  authenticated: false,
};

/**
 * Build the attribute words for a record.
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

  // Login (RouterOS v6 & v7 plaintext or challenge).
  if (command === '/login') {
    if (attributes.name === EXPECTED_USER && (attributes.password === EXPECTED_PASSWORD || attributes.response)) {
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

    let filtered = rows;
    for (const [key, value] of Object.entries(attributes)) {
      if (!key.startsWith('?')) continue;
      const field = key.slice(1);
      filtered = filtered.filter((row) => String(row[field] ?? '') === String(value));
    }

    return { words: filtered.flatMap((row) => toWords(row)) };
  }
  if (command === '/ppp/secret/set') {
    const targetId = attributes['.id'];
    const target = Array.from(state.secrets.values()).find((secret, index) => {
      if (targetId) return `*${index + 1}` === targetId;
      return secret.name === attributes.name;
    });
    if (target) {
      if (attributes.disabled !== undefined) target.disabled = attributes.disabled;
      if (attributes.profile !== undefined) target.profile = attributes.profile;
      if (attributes.password !== undefined) target.password = attributes.password;
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
  if (command === '/ppp/secret/remove') {
    const targetId = attributes['.id'];
    for (const [name, secret] of state.secrets.entries()) {
      const idx = Array.from(state.secrets.values()).indexOf(secret);
      if (`*${idx + 1}` === targetId || attributes.name === name) {
        state.secrets.delete(name);
        break;
      }
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
    let filtered = rows;
    for (const [key, value] of Object.entries(attributes)) {
      if (!key.startsWith('?')) continue;
      const field = key.slice(1);
      filtered = filtered.filter((row) => String(row[field] ?? '') === String(value));
    }
    return { words: filtered.flatMap((row) => toWords(row)) };
  }
  if (command === '/queue/simple/set') {
    const targetId = attributes['.id'];
    const target = Array.from(state.queues.values()).find((q, index) => {
      if (targetId) return `*${index + 1}` === targetId;
      return q.name === attributes.name;
    });
    if (target) {
      if (attributes['max-limit'] !== undefined) target['max-limit'] = attributes['max-limit'];
      if (attributes.disabled !== undefined) target.disabled = attributes.disabled;
      if (attributes.target !== undefined) target.target = attributes.target;
    }
    return { words: [] };
  }
  if (command === '/queue/simple/add') {
    const name = attributes.name;
    if (name && !state.queues.has(name)) {
      state.queues.set(name, {
        name,
        target: attributes.target || '0.0.0.0/0',
        'max-limit': attributes['max-limit'] || '10M/10M',
        disabled: attributes.disabled || 'no',
        comment: attributes.comment || '',
      });
    }
    return { words: [] };
  }
  if (command === '/queue/simple/remove') {
    const targetId = attributes['.id'];
    for (const [name, q] of state.queues.entries()) {
      const idx = Array.from(state.queues.values()).indexOf(q);
      if (`*${idx + 1}` === targetId || attributes.name === name) {
        state.queues.delete(name);
        break;
      }
    }
    return { words: [] };
  }
  if (command === '/ip/firewall/address-list/print') {
    const rows = Array.from(state.addressLists.values()).map((item, index) => ({
      ...item,
      '.id': `*${index + 1}`,
    }));
    let filtered = rows;
    for (const [key, value] of Object.entries(attributes)) {
      if (!key.startsWith('?')) continue;
      const field = key.slice(1);
      filtered = filtered.filter((row) => String(row[field] ?? '') === String(value));
    }
    return { words: filtered.flatMap((row) => toWords(row)) };
  }
  if (command === '/ip/firewall/address-list/add') {
    const list = attributes.list;
    const address = attributes.address;
    if (list && address) {
      const key = `${list}:${address}`;
      if (!state.addressLists.has(key)) {
        state.addressLists.set(key, {
          list,
          address,
          comment: attributes.comment || '',
          disabled: attributes.disabled || 'no',
        });
      }
    }
    return { words: [] };
  }
  if (command === '/ip/firewall/address-list/set') {
    const targetId = attributes['.id'];
    const target = Array.from(state.addressLists.values()).find((item, index) => {
      if (targetId) return `*${index + 1}` === targetId;
      return item.list === attributes.list && item.address === attributes.address;
    });
    if (target) {
      if (attributes.disabled !== undefined) target.disabled = attributes.disabled;
      if (attributes.comment !== undefined) target.comment = attributes.comment;
    }
    return { words: [] };
  }
  if (command === '/ip/firewall/address-list/remove') {
    const targetId = attributes['.id'];
    for (const [key, item] of state.addressLists.entries()) {
      const idx = Array.from(state.addressLists.values()).indexOf(item);
      if (`*${idx + 1}` === targetId || (attributes.list === item.list && attributes.address === item.address)) {
        state.addressLists.delete(key);
        break;
      }
    }
    return { words: [] };
  }

  return { trap: `unknown command ${command}` };
}

const server = net.createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let words = [];
  let clientFormat = 'standard';

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    for (;;) {
      const decoded = decodeWord(buffer);
      if (!decoded) return;

      buffer = buffer.subarray(decoded.bytesConsumed);
      clientFormat = decoded.format;

      if (decoded.isTerminator) {
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
          socket.write(encode([`!trap=${result.trap}`], clientFormat));
        } else {
          socket.write(encode([...result.words, '!done'], clientFormat));
        }
        continue;
      }
      words.push(decoded.payload);
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
