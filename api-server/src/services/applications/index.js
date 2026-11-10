'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');

/**
 * Online connection request service (SRS 3.1 — Online Connection Request).
 *
 * Captures the prospective customer's details, NID document and installation
 * location, then persists the request so the admin panel can act on it.
 *
 * Uploaded ID documents are written to `storage/applications` and referenced
 * by path — they are never inlined into the database.
 */

const UPLOAD_DIR = path.join(config.rootDir, 'storage', 'applications');
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

/**
 * Decode a base64 data URL (as produced by the browser FileReader) and store
 * the file. Returns the stored file name.
 *
 * @param {string} dataUrl  e.g. "data:image/png;base64,...."
 * @param {string} requestId
 */
async function storeIdDocument(dataUrl, requestId) {
  const match = /^data:([^;]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!match) {
    throw Object.assign(new Error('The uploaded document is not a valid base64 data URL'), { status: 400 });
  }

  const [, mimeType, base64] = match;
  if (!ALLOWED_MIME.includes(mimeType)) {
    throw Object.assign(
      new Error(`Unsupported document type: ${mimeType}. Allowed: JPG, PNG, WEBP, PDF.`),
      { status: 400 },
    );
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) {
    throw Object.assign(new Error('The uploaded document is empty'), { status: 400 });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw Object.assign(new Error('The uploaded document exceeds the 10 MB limit'), { status: 400 });
  }

  const extension = mimeType === 'application/pdf' ? 'pdf' : mimeType.split('/')[1];
  const safeId = String(requestId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${safeId}-id.${extension}`;
  const filePath = path.join(UPLOAD_DIR, fileName);

  await fs.promises.writeFile(filePath, buffer);
  logger.info('connection request: ID document stored', { requestId, fileName, bytes: buffer.length });

  return path.join('storage', 'applications', fileName);
}

/**
 * Create a connection request.
 */
async function createRequest(payload) {
  const id = `REQ-${new Date().getFullYear()}-${utils.randomToken(4).toUpperCase()}`;

  let idDocumentPath = null;
  if (payload.idDocumentDataUrl) {
    idDocumentPath = await storeIdDocument(payload.idDocumentDataUrl, id);
  }

  const result = await db.queryOne(
    `INSERT INTO connection_requests
       (id, full_name, phone, email, id_number, id_document_path, address,
        package_id, package_name, ont_config, referral, status, raw_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
     RETURNING *`,
    [
      id,
      payload.fullName,
      payload.phone || null,
      payload.email || null,
      payload.idNumber || null,
      idDocumentPath,
      payload.address || null,
      payload.packageId || null,
      payload.packageName || null,
      payload.ontConfig || null,
      payload.referral || null,
      JSON.stringify({
        source: 'public-website',
        idDocumentDataUrl: undefined,
        createdAt: utils.nowIso(),
      }),
    ],
  );

  logger.info('connection request created', { id, package: payload.packageName });
  return result;
}

/**
 * List connection requests (admin).
 */
async function listRequests({ status = null, limit = 100 } = {}) {
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    params.push(status);
    where = `WHERE status = $${params.length}`;
  }
  params.push(Math.min(Number(limit) || 100, 500));

  const result = await db.query(
    `SELECT * FROM connection_requests ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return result.rows;
}

/**
 * Update the status of a connection request.
 */
async function updateStatus(id, status, subscriberId = null) {
  const result = await db.queryOne(
    `UPDATE connection_requests
        SET status = $2,
            subscriber_id = COALESCE($3, subscriber_id),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, status, subscriberId],
  );
  return result;
}

/**
 * Resolve the absolute path of a stored ID document.
 */
function idDocumentAbsolutePath(relativePath) {
  if (!relativePath) return null;
  // Guard against path traversal — only files inside the upload directory.
  const resolved = path.resolve(config.rootDir, relativePath);
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR))) return null;
  return resolved;
}

module.exports = {
  createRequest,
  listRequests,
  updateStatus,
  storeIdDocument,
  idDocumentAbsolutePath,
  UPLOAD_DIR,
};
