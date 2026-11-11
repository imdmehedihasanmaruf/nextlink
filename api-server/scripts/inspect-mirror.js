'use strict';

/**
 * Inspect the shape of a mirror invoice record.
 */

const fs = require('fs');
const path = require('path');

const MIRROR = path.resolve(__dirname, '..', '..', 'backend', 'data', 'adminStore.json');

const mirror = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
const invoices = Array.isArray(mirror.invoices) ? mirror.invoices : [];

console.log('mirror invoices:', invoices.length);

const ids = new Set();
let withoutId = 0;
const periods = new Map();

for (const entry of invoices) {
  const record = entry.raw_data && typeof entry.raw_data === 'object' ? entry.raw_data : entry;
  const id = entry.id || record.id || record.invoiceNumber || '';
  if (!id || id === 'undefined') withoutId += 1;
  ids.add(id);

  const period = record.period || entry.period || '';
  const key = `${record.subscriberId || record.subscriber_id || '?'}|${period}`;
  periods.set(key, (periods.get(key) || 0) + 1);
}

console.log('unique ids:', ids.size, '| records without a usable id:', withoutId);
console.log('unique (subscriber, period) keys:', periods.size);

const duplicated = [...periods.entries()].filter(([, count]) => count > 1);
console.log('keys that appear more than once:', duplicated.length);
duplicated.slice(0, 5).forEach(([key, count]) => console.log(`  ${key} x${count}`));

console.log('');
console.log('sample record:', JSON.stringify(invoices[0]).slice(0, 400));
