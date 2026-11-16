'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../../config');
const utils = require('../../lib/utils');

/**
 * Auto-generated PDF invoice & Unsubscriber Cancel Invoice.
 *
 * Produces a branded A4 invoice that is written to `storage/invoices` and
 * served from the API. The file name is deterministic per invoice.
 */

const BRAND = {
  name: 'NextLink Global',
  tagline: 'NextLink Global ISP — Tier-1 Optical Infrastructure',
  address: 'Head Office, Optical IXP Center, Dhaka, Bangladesh',
  email: 'billing@nextlink.global',
  phone: '+880 1700 000000',
};

const CURRENCY_LABEL = `${config.billing.currency} ${config.billing.currencySymbol}`;

function applyBrand(overrides = {}) {
  return { ...BRAND, ...overrides };
}

/**
 * Draw the header band.
 */
function drawHeader(doc, invoice) {
  const inv = invoice || {};
  const brand = applyBrand(inv.brand);
  const isCancel =
    String(inv.invoiceType || inv.invoice_type || inv.raw_data?.invoiceType || '').toLowerCase() === 'cancel' ||
    String(inv.invoiceType || inv.invoice_type || inv.raw_data?.invoiceType || '').toLowerCase() === 'cancellation' ||
    String(inv.id).includes('CANCEL');

  const title = isCancel ? 'UNSUBSCRIBER CANCEL INVOICE' : 'OFFICIAL TAX INVOICE';
  const headerBg = isCancel ? '#7f1d1d' : '#0f2f6b'; // Deep rose-red for cancel, navy for normal

  doc.rect(0, 0, doc.page.width, 102).fill(headerBg);
  doc.fillColor('#ffffff').fontSize(20).font('Helvetica-Bold').text(brand.name, 50, 24);
  doc.fontSize(8.5).font('Helvetica').text(brand.tagline, 50, 50);
  doc.fontSize(8).text(brand.address, 50, 64);
  doc.text(`${brand.email}  |  ${brand.phone}`, 50, 77);

  doc.fontSize(isCancel ? 12 : 14).font('Helvetica-Bold').text(title, 0, 24, {
    align: 'right',
    width: doc.page.width - 50,
  });
  doc.fontSize(8.5).font('Helvetica').text(`Invoice #${invoice.id}`, 0, 48, {
    align: 'right',
    width: doc.page.width - 50,
  });
  doc.text(
    `${isCancel ? 'Cancelled' : 'Issued'}: ${invoice.issuedAt || invoice.created_at ? String(invoice.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10)}`,
    0,
    62,
    { align: 'right', width: doc.page.width - 50 },
  );
  doc.text(
    `${isCancel ? 'Effective' : 'Due'}: ${invoice.dueDate || invoice.effectiveDate || 'Immediate'}`,
    0,
    76,
    { align: 'right', width: doc.page.width - 50 },
  );
}

/**
 * Draw the 4-box Purchase or Cancel Session Info block (Part 1 / Part 2).
 */
function drawSessionInfoBlock(doc, invoice, y) {
  const isCancel =
    String(invoice.invoiceType || invoice.raw_data?.invoiceType || '').toLowerCase() === 'cancel' ||
    String(invoice.id).includes('CANCEL');

  const raw = invoice.raw_data || {};
  const session = isCancel ? (raw.cancelSession || invoice.cancelSession || {}) : (raw.purchaseSession || invoice.purchaseSession || {});

  const dateVal = session.cancelDate || session.purchaseDate || session.date || (isCancel ? '12/11/2026' : '12/11/2026');
  const timeVal = session.cancelTime || session.purchaseTime || session.time || (isCancel ? '08:30PM' : '07:15PM');
  const city = session.city || 'Unknown';
  const postal = session.postalCode || 'Unknown';
  const state = session.state || 'Unknown';
  const country = session.country || 'Unknown';

  const titlePrefix = isCancel ? 'Cancel' : 'Purchase';
  const sectionTitle = isCancel ? 'REAL-TIME CANCELLATION SESSION & GEOLOCATION' : 'REAL-TIME PURCHASE SESSION & GEOLOCATION';

  doc.fillColor('#0f2f6b').fontSize(8.5).font('Helvetica-Bold').text(sectionTitle, 50, y);

  const boxY = y + 14;
  const boxHeight = 52;
  const gap = 8;
  const boxWidth = (doc.page.width - 100 - gap * 3) / 4;

  const boxes = [
    {
      title: `${titlePrefix} Date`,
      value: dateVal,
      caption: 'Format: (DD/MM/YYYY)',
    },
    {
      title: `${titlePrefix} Time`,
      value: timeVal,
      caption: 'Format: (00:00AM/PM)',
    },
    {
      title: 'City & Postal Code',
      value: `${city}, ${postal}`,
      caption: `Postal: ${postal}`,
    },
    {
      title: 'State & Country',
      value: `${state}, ${country}`,
      caption: `Country: ${country}`,
    },
  ];

  boxes.forEach((box, i) => {
    const x = 50 + i * (boxWidth + gap);
    doc.rect(x, boxY, boxWidth, boxHeight).lineWidth(0.8).strokeColor('#d1d5db').fillAndStroke('#f9fafb', '#d1d5db');

    doc.fillColor('#6b7280').fontSize(7.5).font('Helvetica-Bold').text(box.title, x + 6, boxY + 6, {
      width: boxWidth - 12,
      ellipsis: true,
    });
    doc.fillColor('#111827').fontSize(8.5).font('Helvetica-Bold').text(box.value, x + 6, boxY + 18, {
      width: boxWidth - 12,
      height: 20,
      ellipsis: true,
    });
    doc.fillColor('#9ca3af').fontSize(6.5).font('Helvetica').text(box.caption, x + 6, boxY + 38, {
      width: boxWidth - 12,
      ellipsis: true,
    });
  });

  return boxY + boxHeight + 14;
}

/**
 * Draw Subscriber Details & Cancellation Details (if cancel invoice).
 */
function drawBillTo(doc, invoice, y) {
  const isCancel =
    String(invoice.invoiceType || invoice.raw_data?.invoiceType || '').toLowerCase() === 'cancel' ||
    String(invoice.id).includes('CANCEL');
  const raw = invoice.raw_data || {};
  const canc = raw.cancellation || invoice.cancellation || {};

  doc.fillColor('#0f2f6b').fontSize(8.5).font('Helvetica-Bold').text(isCancel ? 'SUBSCRIBER ACCOUNT & CANCELLATION DETAILS' : 'BILLED TO', 50, y);

  const startY = y + 14;
  doc.rect(50, startY, doc.page.width - 100, isCancel ? 88 : 64).lineWidth(0.8).strokeColor('#e5e7eb').fillAndStroke('#ffffff', '#e5e7eb');

  const halfWidth = (doc.page.width - 100) / 2;

  // Left column
  doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text(invoice.subscriberName || raw.subscriberName || 'Subscriber', 60, startY + 8);
  doc.fontSize(8.5).font('Helvetica').fillColor('#4b5563');
  doc.text(`Subscriber ID: ${invoice.subscriberId || invoice.subscriber_id || '—'}`, 60, startY + 24);
  doc.text(`Package: ${invoice.packageName || raw.packageName || 'Internet Fiber'}`, 60, startY + 38);
  if (invoice.subscriberPhone || raw.subscriberPhone) {
    doc.text(`Phone: ${invoice.subscriberPhone || raw.subscriberPhone}`, 60, startY + 52);
  }

  // Right column
  if (isCancel) {
    doc.fillColor('#7f1d1d').fontSize(8.5).font('Helvetica-Bold').text(`Cancel Reason: ${canc.reason || 'Requested by Subscriber'}`, 60 + halfWidth, startY + 8);
    doc.fillColor('#4b5563').fontSize(8).font('Helvetica');
    const descText = canc.description ? `Notes: ${canc.description.slice(0, 120)}${canc.description.length > 120 ? '...' : ''}` : 'Status: Service Terminated';
    doc.text(descText, 60 + halfWidth, startY + 24, { width: halfWidth - 20 });
    const buyAgain = canc.notSureBuyAgain ? 'Not sure yet' : canc.buyAgainDate || 'To be decided';
    doc.text(`Buy-Again Date: ${buyAgain}`, 60 + halfWidth, startY + 48);
    const orig = canc.originalPurchaseDate ? `${canc.originalPurchaseDate} (${canc.originalPurchaseLocation || ''})` : '—';
    doc.text(`Original Purchase: ${orig}`, 60 + halfWidth, startY + 62, { width: halfWidth - 20, ellipsis: true });
  } else {
    doc.fillColor('#4b5563').fontSize(8.5).font('Helvetica');
    if (invoice.subscriberAddress || raw.address) {
      doc.text(`Installation Address: ${invoice.subscriberAddress || raw.address}`, 60 + halfWidth, startY + 8, { width: halfWidth - 20 });
    }
    doc.text(`Status: ${(invoice.status || 'Active').toUpperCase()}`, 60 + halfWidth, startY + 38);
  }

  return startY + (isCancel ? 88 : 64) + 14;
}

/**
 * Draw the line-item table.
 */
function drawTable(doc, invoice, y) {
  const isCancel =
    String(invoice.invoiceType || invoice.raw_data?.invoiceType || '').toLowerCase() === 'cancel' ||
    String(invoice.id).includes('CANCEL');

  const rowHeight = 22;
  const columns = [
    { label: 'Item Description', x: 50, width: 320 },
    { label: `Amount (${CURRENCY_LABEL})`, x: 370, width: 175, align: 'right' },
  ];
  const tableWidth = doc.page.width - 100;

  doc.rect(50, y, tableWidth, rowHeight).fill('#eef2fb');
  doc.fillColor('#0f2f6b').fontSize(8.5).font('Helvetica-Bold');
  columns.forEach((column) => {
    doc.text(column.label, column.x + 8, y + 7, { width: column.width - 16, align: column.align || 'left' });
  });

  const raw = invoice.raw_data || {};
  let lines = Array.isArray(invoice.lines) && invoice.lines.length ? invoice.lines : (Array.isArray(raw.lines) && raw.lines.length ? raw.lines : null);

  if (!lines || lines.length === 0) {
    lines = [];
    if (isCancel) {
      const amt = Number(invoice.amount || 0);
      if (amt > 0) {
        lines.push({
          description: `Unpaid Carried-Over Dues Upon Cancellation (${invoice.packageName || 'Fiber Plan'})`,
          amount: amt,
        });
      } else {
        lines.push({
          description: `Final Account Settlement Balance (${invoice.packageName || 'Fiber Plan'}) — SUT Cleared`,
          amount: 0,
        });
      }
    } else {
      const baseAmt = Number(invoice.baseAmount || 0);
      const installFee = Number(invoice.installationFee || 0);
      const taxFee = Number(invoice.taxFee || 0);
      const carryOver = Number(invoice.carriedOverAmount || 0);
      const lateFee = Number(invoice.lateFee || 0);
      if (baseAmt > 0 || installFee > 0 || taxFee > 0 || carryOver > 0 || lateFee > 0) {
        const planTotal = baseAmt || Math.max(0, Number(invoice.amount || 0) - installFee - taxFee - carryOver - lateFee);
        if (planTotal > 0) {
          lines.push({
            description: `${invoice.packageName || 'Monthly Fiber Subscription'} (${invoice.period || 'Monthly'})`,
            amount: planTotal,
          });
        }
        if (installFee > 0) lines.push({ description: 'One-Time Installation Fee', amount: installFee });
        if (taxFee > 0) lines.push({ description: 'Tax Fee', amount: taxFee });
        if (carryOver > 0) lines.push({ description: 'Carried-Over Unpaid Balance', amount: carryOver });
        if (lateFee > 0) lines.push({ description: 'Late Payment Fee', amount: lateFee });
      } else {
        lines.push({
          description: `${invoice.packageName || 'Monthly Fiber Subscription'} (${invoice.period || 'Monthly'})`,
          amount: Number(invoice.amount || 0),
        });
      }
    }
  }

  let currentY = y + rowHeight;
  doc.font('Helvetica').fontSize(9);
  lines.forEach((line, index) => {
    if (index % 2 === 1) {
      doc.rect(50, currentY, tableWidth, rowHeight).fill('#f9fafb');
    }
    doc.fillColor('#111827');
    const label = line.label || line.description || 'Service charge';
    doc.text(label, 58, currentY + 6, { width: columns[0].width - 16, ellipsis: true });
    const lineAmt = line.formattedAmount || utils.formatAmount(line.amount);
    doc.text(lineAmt, columns[1].x + 8, currentY + 6, {
      width: columns[1].width - 16,
      align: 'right',
    });
    currentY += rowHeight;
  });

  doc.rect(50, currentY, tableWidth, rowHeight + 2).fill(isCancel ? '#fee2e2' : '#eef2fb');
  doc.fillColor(isCancel ? '#991b1b' : '#0f2f6b').fontSize(10).font('Helvetica-Bold');
  doc.text(isCancel ? 'TOTAL PAYABLE / SETTLEMENT AMOUNT' : 'TOTAL PAYABLE AMOUNT NOW', 58, currentY + 7, {
    width: columns[0].width - 16,
  });
  doc.text(utils.formatAmount(invoice.amount), columns[1].x + 8, currentY + 7, {
    width: columns[1].width - 16,
    align: 'right',
  });

  return currentY + rowHeight + 24;
}

/**
 * Draw the status / footer block.
 */
function drawFooter(doc, invoice, y) {
  const inv = invoice || {};
  const brand = applyBrand(inv.brand);
  const isCancel =
    String(inv.invoiceType || inv.invoice_type || inv.raw_data?.invoiceType || '').toLowerCase() === 'cancel' ||
    String(inv.invoiceType || inv.invoice_type || inv.raw_data?.invoiceType || '').toLowerCase() === 'cancellation' ||
    String(inv.id).includes('CANCEL');

  const status = isCancel ? 'CANCELLED' : String(invoice.status || 'unpaid').toUpperCase();
  const statusColor = isCancel ? '#991b1b' : status === 'PAID' ? '#137a3a' : status === 'OVERDUE' ? '#b3261e' : '#8a6d00';

  doc.rect(50, y, 3, 38).fill(statusColor);
  doc.fillColor(statusColor).fontSize(11).font('Helvetica-Bold').text(`STATUS: ${status}`, 66, y + 2);
  doc.fillColor('#555555').fontSize(8.5).font('Helvetica');
  if (isCancel) {
    doc.text('This subscription is decommissioned. No further recurring charges will be generated.', 66, y + 20);
  } else {
    doc.text(`Payment Gateway: ${invoice.paidVia || 'bKash / Nagad / SSLCommerz / Rocket'}`, 66, y + 20);
  }

  const footerY = doc.page.height - 65;
  doc.rect(50, footerY, doc.page.width - 100, 1).fill('#dddddd');
  doc.fillColor('#6b7280').fontSize(7.5).font('Helvetica');
  doc.text(
    '© 2026 NextLink Global. All rights reserved. Tier-1 Optical Infrastructure. This is a tamper-evident system-generated record.',
    50,
    footerY + 10,
    { width: doc.page.width - 100, align: 'center' },
  );
  doc.text(`${brand.name} — ${brand.email} — ${brand.phone}`, 50, footerY + 24, {
    width: doc.page.width - 100,
    align: 'center',
  });
}

/**
 * Render the invoice PDF to a Buffer.
 */
function renderInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawHeader(doc, invoice);
    const afterSession = drawSessionInfoBlock(doc, invoice, 112);
    const afterBillTo = drawBillTo(doc, invoice, afterSession);
    const afterTable = drawTable(doc, invoice, afterBillTo);
    drawFooter(doc, invoice, afterTable);

    doc.end();
  });
}

/**
 * Render and persist the invoice PDF, returning the file path.
 */
async function generateInvoicePdf(invoice) {
  const buffer = await renderInvoicePdf(invoice);
  const safeId = String(invoice.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(config.billing.pdfDir, `${safeId}.pdf`);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, size: buffer.length };
}

function invoicePdfPath(invoiceId) {
  const safeId = String(invoiceId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.billing.pdfDir, `${safeId}.pdf`);
}

module.exports = {
  renderInvoicePdf,
  generateInvoicePdf,
  invoicePdfPath,
  BRAND,
  CURRENCY_LABEL,
  applyBrand,
};
