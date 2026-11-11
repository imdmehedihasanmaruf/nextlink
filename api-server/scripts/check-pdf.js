'use strict';

/**
 * Verify that the generated invoice PDF is structurally valid.
 *
 * The amount header embeds the currency symbol. When that symbol is outside
 * the WinAnsi encoding range, PDFKit writes it as a multi-byte hex run inside
 * a single-byte hex string, which produces an odd number of hex digits and a
 * corrupt content stream.
 *
 * Run with:  node scripts/check-pdf.js
 */

const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const { renderInvoicePdf, CURRENCY_LABEL } = require('../src/services/billing/pdf');

async function main() {
  const invoice = {
    id: 'INV-CHECK-001',
    subscriberId: 'SUB-001',
    subscriberName: 'PDF Verification',
    subscriberPhone: '+8801700000000',
    subscriberAddress: 'Dhaka, Bangladesh',
    packageName: 'Premium',
    period: '2026-11',
    amount: 1499,
    dueDate: '2026-11-10',
    status: 'unpaid',
    issuedAt: '2026-11-01',
  };

  console.log(`Currency label: ${JSON.stringify(CURRENCY_LABEL)}`);

  const buffer = await renderInvoicePdf(invoice);
  const text = buffer.toString('latin1');

  // Every hex string inside a content stream must have an even length.
  const hexStrings = text.match(/\[[0-9A-Fa-f]*\]/g) || [];
  const odd = hexStrings.filter((entry) => {
    const inner = entry.slice(1, -1);
    return inner.length % 2 !== 0;
  });

  console.log(`PDF size: ${buffer.length} bytes`);
  console.log(`Hex strings in the content stream: ${hexStrings.length}`);
  console.log(`Odd-length hex strings (corrupt): ${odd.length}`);

  if (odd.length > 0) {
    console.log('');
    console.log('  CORRUPT ENTRY:');
    for (const entry of odd.slice(0, 5)) console.log(`    ${entry}`);
  }

  // The header must be a valid PDF.
  const isPdf = text.startsWith('%PDF-');
  console.log(`Valid PDF header: ${isPdf}`);

  // The trailer must contain the startxref and %%EOF markers.
  const hasEof = text.trimEnd().endsWith('%%EOF');
  console.log(`Valid EOF marker: ${hasEof}`);

  const ok = isPdf && hasEof && odd.length === 0;
  console.log('');
  console.log(ok ? 'RESULT: the PDF is structurally valid.' : 'RESULT: the PDF is CORRUPT.');

  const outPath = path.join(config.billing.pdfDir, 'verification-sample.pdf');
  fs.writeFileSync(outPath, buffer);
  console.log(`Sample written to ${outPath}`);

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
