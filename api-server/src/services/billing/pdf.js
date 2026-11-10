'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('../../config');
const utils = require('../../lib/utils');

/**
 * Auto-generated PDF invoice.
 *
 * Produces a branded A4 invoice that is written to `storage/invoices` and
 * served from the API. The file name is deterministic per invoice so repeated
 * downloads overwrite rather than accumulate.
 */

const BRAND = {
  name: 'NextLink',
  tagline: 'NextLink Communications — ISP Services',
  address: 'Head Office, Dhaka, Bangladesh',
  email: 'billing@nextlink.com',
  phone: '+880 1700 000000',
};

const CURRENCY_LABEL = `${config.billing.currency} ${config.billing.currencySymbol}`;

/**
 * Draw the header band.
 */
function drawHeader(doc, invoice) {
  doc.rect(0, 0, doc.page.width, 96).fill('#0f2f6b');
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text(BRAND.name, 50, 28);
  doc.fontSize(9).font('Helvetica').text(BRAND.tagline, 50, 56);
  doc.fontSize(9).text(`${BRAND.address}`, 50, 70);
  doc.text(`${BRAND.email}  |  ${BRAND.phone}`, 50, 83);

  doc.fontSize(16).font('Helvetica-Bold').text('INVOICE', 0, 32, { align: 'right', width: doc.page.width - 50 });
  doc.fontSize(9).font('Helvetica').text(`Invoice #${invoice.id}`, 0, 56, { align: 'right', width: doc.page.width - 50 });
  doc.text(`Issued: ${invoice.issuedAt || new Date().toISOString().slice(0, 10)}`, 0, 70, {
    align: 'right',
    width: doc.page.width - 50,
  });
  doc.text(`Due: ${invoice.dueDate || '—'}`, 0, 83, { align: 'right', width: doc.page.width - 50 });
}

/**
 * Draw the bill-to block.
 */
function drawBillTo(doc, invoice, y) {
  doc.fillColor('#0f2f6b').fontSize(9).font('Helvetica-Bold').text('BILL TO', 50, y);
  doc.fillColor('#111111').fontSize(12).font('Helvetica-Bold').text(invoice.subscriberName || 'Subscriber', 50, y + 16);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Subscriber ID: ${invoice.subscriberId || '—'}`, 50, y + 34);
  if (invoice.subscriberPhone) doc.text(`Phone: ${invoice.subscriberPhone}`, 50, y + 48);
  if (invoice.subscriberAddress) doc.text(`Address: ${invoice.subscriberAddress}`, 50, y + 62);
  if (invoice.packageName) doc.text(`Package: ${invoice.packageName}`, 50, y + 76);
  return y + 104;
}

/**
 * Draw the line-item table.
 */
function drawTable(doc, invoice, y) {
  const rowHeight = 24;
  const columns = [
    { label: 'Description', x: 50, width: 250 },
    { label: `Amount (${CURRENCY_LABEL})`, x: 300, width: 200, align: 'right' },
  ];
  const tableWidth = doc.page.width - 100;

  doc.rect(50, y, tableWidth, rowHeight).fill('#eef2fb');
  doc.fillColor('#0f2f6b').fontSize(9).font('Helvetica-Bold');
  columns.forEach((column) => {
    doc.text(column.label, column.x + 8, y + 8, { width: column.width - 16, align: column.align || 'left' });
  });

  const lines = invoice.lines && invoice.lines.length ? invoice.lines : [
    {
      description: `Monthly subscription — ${invoice.packageName || 'ISP Service'} (${invoice.period || 'Current cycle'})`,
      amount: Number(invoice.amount || 0),
    },
  ];

  let currentY = y + rowHeight;
  doc.font('Helvetica').fontSize(10);
  lines.forEach((line, index) => {
    if (index % 2 === 1) {
      doc.rect(50, currentY, tableWidth, rowHeight).fill('#f7f9fd');
    }
    doc.fillColor('#111111');
    doc.text(line.description, 58, currentY + 7, { width: columns[0].width - 16 });
    doc.text(utils.formatAmount(line.amount), columns[1].x + 8, currentY + 7, {
      width: columns[1].width - 16,
      align: 'right',
    });
    currentY += rowHeight;
  });

  doc.rect(50, currentY, tableWidth, rowHeight).fill('#eef2fb');
  doc.fillColor('#0f2f6b').fontSize(11).font('Helvetica-Bold');
  doc.text('TOTAL DUE', 58, currentY + 7, { width: columns[0].width - 16 });
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
  const status = String(invoice.status || 'unpaid').toUpperCase();
  const statusColor = status === 'PAID' ? '#137a3a' : status === 'OVERDUE' ? '#b3261e' : '#8a6d00';

  doc.rect(50, y, 3, 42).fill(statusColor);
  doc.fillColor(statusColor).fontSize(13).font('Helvetica-Bold').text(`STATUS: ${status}`, 66, y + 2);
  doc.fillColor('#555555').fontSize(9).font('Helvetica');
  doc.text(`Payment via: ${invoice.paidVia || '—'}`, 66, y + 22);
  if (invoice.transactionId) doc.text(`Transaction: ${invoice.transactionId}`, 66, y + 34);

  const footerY = doc.page.height - 90;
  doc.rect(50, footerY, doc.page.width - 100, 1).fill('#dddddd');
  doc.fillColor('#777777').fontSize(8).font('Helvetica');
  doc.text(
    'This is a computer generated invoice. Please quote the invoice number on all payments. Late payments may result in service suspension.',
    50,
    footerY + 12,
    { width: doc.page.width - 100, align: 'center' },
  );
  doc.text(`${BRAND.name} — ${BRAND.email} — ${BRAND.phone}`, 50, footerY + 32, {
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
    const afterBillTo = drawBillTo(doc, invoice, 130);
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
  await fs.promises.writeFile(filePath, buffer);
  return { filePath, size: buffer.length };
}

/**
 * Resolve the absolute path of an already generated invoice PDF.
 */
function invoicePdfPath(invoiceId) {
  const safeId = String(invoiceId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(config.billing.pdfDir, `${safeId}.pdf`);
}

module.exports = { renderInvoicePdf, generateInvoicePdf, invoicePdfPath, BRAND, CURRENCY_LABEL };
