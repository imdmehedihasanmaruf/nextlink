'use strict';

/**
 * Referral program — real, tracked, database-backed.
 *
 * Rules implemented here:
 *   * Every eligible subscriber can own one referral code.
 *   * Codes are unique and unguessable enough for business use (random base36).
 *   * A referred application is attributed to the referrer who owns the code.
 *   * Self-referral and duplicate attribution are rejected at validation time
 *     and enforced again by unique constraints in the schema.
 *   * Rewards are computed from the configured bonus amount and are only
 *     credited once the referred subscriber's payment settles in full.
 *   * Every credit posts a row to `referral_rewards` — an auditable ledger.
 *
 * The reward is a bill credit: it is applied to the referrer's `raw_data
 * .credit_balance` (a running total), which the billing engine subtracts from
 * the next monthly invoice. `credit_balance` is never manufactured here —
 * it only moves through this module.
 */

const crypto = require('crypto');
const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');
const { audit } = require('../../middleware/auth');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(length = 8) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

async function ensureCode(subscriberId) {
  const existing = await db.queryOne(
    'SELECT * FROM referral_codes WHERE subscriber_id = $1',
    [subscriberId],
  );
  if (existing) return existing;

  // Retry a few times on the (astronomically unlikely) collision.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `NL-${randomCode(8)}`;
    try {
      return await db.queryOne(
        `INSERT INTO referral_codes (subscriber_id, code) VALUES ($1, $2)
         ON CONFLICT (subscriber_id) DO NOTHING
         RETURNING *`,
        [subscriberId, code],
      );
    } catch (error) {
      if (String(error.message).includes('unique')) continue;
      throw error;
    }
  }
  throw new Error('Could not allocate a referral code');
}

async function getSettings() {
  const stored = await db.queryOne(
    "SELECT value FROM system_settings WHERE key = 'referral'",
  );
  const value = stored && stored.value ? stored.value : {};
  return {
    enabled: value.enabled !== false,
    bonusAmount: Number(value.bonusAmount ?? 25),
    title: value.title || 'Refer a friend',
    description:
      value.description ||
      'Share your invite link — once your friend activates and pays, you both receive billing credit.',
  };
}

async function updateSettings(patch, actor) {
  const current = await getSettings();
  const bonusVal =
    patch.bonusAmount !== undefined
      ? Number(patch.bonusAmount)
      : patch.rewardAmount !== undefined
      ? Number(patch.rewardAmount)
      : current.bonusAmount;
  const merged = {
    enabled: patch.enabled === undefined ? current.enabled : Boolean(patch.enabled),
    bonusAmount: bonusVal,
    rewardAmount: bonusVal,
    title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.title,
    description:
      typeof patch.description === 'string' && patch.description.trim()
        ? patch.description.trim()
        : current.description,
  };
  if (!Number.isFinite(merged.bonusAmount) || merged.bonusAmount <= 0) {
    throw new Error('The referral bonus must be a positive amount');
  }
  await db.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('referral', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
  await db.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('referralRewards', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
  await audit({
    actorId: actor?.id || null,
    actorRole: actor?.role || 'staff',
    action: 'referral.settings_updated',
    entityType: 'system_settings',
    entityId: 'referral',
    details: merged,
    ip: actor?.ip || null,
  });
  return merged;
}

async function getInfo(subscriberId) {
  const code = await ensureCode(subscriberId);
  const settings = await getSettings();
  const rows = await db.query(
    `SELECT r.*, rc.code AS code_text
       FROM referrals r
       JOIN referral_codes rc ON rc.subscriber_id = r.referrer_id
      WHERE r.referrer_id = $1
      ORDER BY r.created_at DESC
      LIMIT 100`,
    [subscriberId],
  );
  const totals = await db.queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE r.status = 'pending')  AS pending_count,
       COUNT(*) FILTER (WHERE r.status = 'qualified') AS qualified_count,
       COUNT(*) FILTER (WHERE r.status = 'credited') AS credited_count,
       COUNT(*) FILTER (WHERE r.status = 'void')     AS void_count,
       COALESCE(SUM(rw.amount) FILTER (WHERE rw.status = 'credited'), 0) AS total_credited
     FROM referrals r
     LEFT JOIN referral_rewards rw ON rw.referral_id = r.id
     WHERE r.referrer_id = $1`,
    [subscriberId],
  );
  const pendingCount = Number(totals?.pending_count || 0);
  const qualifiedCount = Number(totals?.qualified_count || 0);
  const creditedCount = Number(totals?.credited_count || 0);
  const voidCount = Number(totals?.void_count || 0);
  const totalCredited = Number(totals?.total_credited || 0);
  const pendingAmount = Number(((pendingCount + qualifiedCount) * Number(settings.bonusAmount || 25)).toFixed(2));
  const config = require('../../config');
  const basePortalUrl = String(config.portalPublicUrl || 'http://localhost:3000').replace(/\/+$/, '');

  return {
    code: code.code,
    link: `${basePortalUrl}/register?ref=${encodeURIComponent(code.code)}`,
    enabled: settings.enabled,
    title: settings.title,
    description: settings.description,
    bonusAmount: settings.bonusAmount,
    stats: {
      totalReferrals: pendingCount + qualifiedCount + creditedCount,
      pending: pendingCount,
      qualified: qualifiedCount,
      credited: creditedCount,
      void: voidCount,
      totalCredited,
      pendingAmount,
    },
    referrals: rows.rows.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      rewardAmount: Number(r.reward_amount || 0),
      qualifiedAt: r.qualified_at,
      creditedAt: r.credited_at,
      createdAt: r.created_at,
      referredSubscriberId: r.referred_subscriber_id,
    })),
  };
}

/**
 * Validate a referral code for a new applicant. Throws a descriptive error on
 * every failure mode — self-referral, unknown code, disabled program.
 */
async function validateCode(code, applicantPhone) {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new Error('The referral program is currently disabled.');
  }
  const row = await db.queryOne(
    'SELECT * FROM referral_codes WHERE code = $1 AND is_active = TRUE',
    [String(code || '').trim().toUpperCase()],
  );
  if (!row) {
    throw new Error('That referral code does not exist or is no longer active.');
  }
  if (applicantPhone) {
    const referrer = await db.queryOne(
      'SELECT id, phone FROM subscribers WHERE id = $1',
      [row.subscriber_id],
    );
    const rPhone = String(referrer?.phone || '').replace(/\D/g, '');
    const aPhone = String(applicantPhone).replace(/\D/g, '');
    if (rPhone && aPhone && rPhone === aPhone) {
      throw new Error('You cannot use your own referral code.');
    }
  }
  return { referrerId: row.subscriber_id, code: row.code };
}

async function createReferralForApplication({ referrerId, code, applicationId, raw }) {
  const already = await db.queryOne('SELECT * FROM referrals WHERE application_id = $1', [applicationId]);
  if (already) return already;
  const id = utils.generateId('REF');
  const settings = await getSettings();
  return db.queryOne(
    `INSERT INTO referrals
       (id, referrer_id, application_id, code, status, reward_amount, raw_data)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING *`,
    [id, referrerId, applicationId, code, settings.bonusAmount, raw ? JSON.stringify(raw) : null],
  );
}

/**
 * Called when a payment settles in full for a subscriber. If that subscriber
 * joined through a referral and the referral is pending, we qualify it and
 * post the reward credit to the referrer's balance.
 */
async function onPaymentSettled({ subscriberId, invoiceId }) {
  if (!subscriberId) return null;
  const pending = await db.query(
    `SELECT * FROM referrals
      WHERE referred_subscriber_id = $1 AND status = 'pending'
      LIMIT 1`,
    [subscriberId],
  );
  if (pending.rowCount === 0) return null;
  const referral = pending.rows[0];
  const reward = await _creditReward(referral, invoiceId);
  return reward;
}

/**
 * Link a pending referral (created at application time) to the subscriber once
 * the account is created — e.g. when an application is approved. Idempotent.
 */
async function attachToSubscriberByApplication(applicationId, subscriberId) {
  if (!applicationId || !subscriberId) return null;
  const updated = await db.queryOne(
    `UPDATE referrals
        SET referred_subscriber_id = $2, updated_at = NOW()
      WHERE application_id = $1 AND status = 'pending' AND referred_subscriber_id IS NULL
      RETURNING *`,
    [String(applicationId), String(subscriberId)],
  );
  return updated;
}

async function listReferrals({ status, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) {
    params.push(String(status));
    where.push(`r.status = $${params.length}`);
  }
  params.push(limit, offset);
  const sql = `
    SELECT r.*, rc.subscriber_id AS code_owner, rw.status AS reward_status, rw.amount AS reward_amount
      FROM referrals r
      LEFT JOIN referral_codes rc ON rc.code = r.code
      LEFT JOIN referral_rewards rw ON rw.referral_id = r.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const result = await db.query(sql, params);
  return result.rows;
}

/**
 * Apply the reward: add to referrer's credit_balance, mark referral credited,
 * and journal the ledger row. Uses a transaction so a partial failure never
 * double-credits.
 */
async function _creditReward(referral, invoiceId) {
  const client = await db.getPool().connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      'SELECT * FROM referrals WHERE id = $1 FOR UPDATE',
      [referral.id],
    );
    const current = locked.rows[0];
    if (!current || current.status !== 'pending') {
      await client.query('ROLLBACK');
      return null;
    }
    const rewardId = utils.generateId('RWRD');
    await client.query(
      `INSERT INTO referral_rewards (id, referral_id, subscriber_id, amount, status, credited_at)
       VALUES ($1, $2, $3, $4, 'credited', NOW())`,
      [rewardId, referral.id, referral.referrer_id, referral.reward_amount],
    );
    await client.query(
      `UPDATE subscribers
          SET raw_data = COALESCE(raw_data, '{}'::jsonb)
             || jsonb_build_object('credit_balance',
                 COALESCE((raw_data->>'credit_balance')::numeric, 0) + $2),
              updated_at = NOW()
        WHERE id = $1`,
      [referral.referrer_id, referral.reward_amount],
    );
    await client.query(
      "UPDATE referrals SET status = 'credited', referred_subscriber_id = COALESCE(referred_subscriber_id, $2), qualified_at = NOW(), credited_at = NOW(), updated_at = NOW() WHERE id = $1",
      [referral.id, referral.referred_subscriber_id || null],
    );
    await client.query(
      `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
       VALUES ($1, $2, 'referral_reward_credited', $3, $4)`,
      [referral.referrer_id, invoiceId || null, referral.reward_amount, 'Referral reward credited to account balance'],
    );
    await client.query('COMMIT');
    try {
      const notifications = require('../notifications');
      await notifications.notifySubscriber(referral.referrer_id, {
        type: 'referral_credited',
        title: 'Referral Reward Credited!',
        message: `You earned $${utils.formatAmount(referral.reward_amount)} billing credit from referral code ${referral.code}.`,
        link: '/dashboard',
        meta: { rewardId, referralId: referral.id, amount: Number(referral.reward_amount) },
      });
    } catch (notifErr) {
      logger.warn('referral notification failed', { error: notifErr.message });
    }
    return { rewardId, amount: Number(referral.reward_amount) };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    client.release();
  }
}

async function voidReferral(id, reason, actor) {
  const updated = await db.queryOne(
    `UPDATE referrals
        SET status = 'void', notes = COALESCE(notes, '') || $2, updated_at = NOW()
      WHERE id = $1 AND status NOT IN ('credited')
      RETURNING *`,
    [id, ` [void ${new Date().toISOString()}] ${reason || 'staff action'}`],
  );
  if (updated) {
    await audit({
      actorId: actor?.id || null,
      actorRole: actor?.role || 'staff',
      action: 'referral.voided',
      entityType: 'referral',
      entityId: id,
      details: { reason: reason || null },
      ip: actor?.ip || null,
    });
  }
  return updated;
}

module.exports = {
  ensureCode,
  getInfo,
  getSettings,
  updateSettings,
  validateCode,
  createReferralForApplication,
  attachToSubscriberByApplication,
  onPaymentSettled,
  listReferrals,
  voidReferral,
  creditReward: _creditReward,
};
