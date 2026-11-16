'use strict';

/**
 * Payment Operational Alerts Service
 *
 * Monitors real-time payment health and triggers operational alerts for:
 * 1. Repeated webhook failures (status unverified, failed, dead_letter)
 * 2. Gateway verification failures
 * 3. Timeout spikes (pending transactions stuck past expected callback window)
 * 4. Reconciliation mismatches (amount mismatch, duplicate ref, provider paid local pending)
 *
 * Persists alerts through PostgreSQL notifications table and emits real-time events.
 */

const db = require('../../lib/db');
const logger = require('../../lib/logger');
const notifications = require('../notifications');
const reconciliationService = require('./reconciliation.service');

const ALERT_CATEGORIES = {
  WEBHOOK_FAILURES: 'webhook_failures',
  VERIFICATION_FAILURES: 'verification_failures',
  TIMEOUT_SPIKES: 'timeout_spikes',
  RECONCILIATION_MISMATCHES: 'reconciliation_mismatches',
};

const ALERT_SEVERITIES = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
};

/**
 * Scan payment system metrics and generate operational alerts
 *
 * @param {object} [options]
 * @param {boolean} [options.notify=false] Whether to push to notifications table
 * @returns {Promise<object>} Active operational alerts summary
 */
async function getOperationalAlerts(options = {}) {
  const alerts = [];
  const now = new Date();

  // 1. Repeated Webhook Failures
  try {
    const webhookFailuresRes = await db.query(
      `SELECT gateway, status, error, COUNT(*)::int AS count
         FROM payment_webhooks
        WHERE status IN ('failed', 'unverified', 'dead_letter', 'gateway_mismatch', 'amount_mismatch')
          AND created_at >= NOW() - INTERVAL '2 hours'
        GROUP BY gateway, status, error
        HAVING COUNT(*) >= 2
        ORDER BY count DESC`
    );

    for (const row of webhookFailuresRes.rows || []) {
      const isDeadLetter = row.status === 'dead_letter';
      alerts.push({
        id: `ALERT-WH-${row.gateway}-${row.status}`,
        category: ALERT_CATEGORIES.WEBHOOK_FAILURES,
        severity: isDeadLetter ? ALERT_SEVERITIES.CRITICAL : ALERT_SEVERITIES.WARNING,
        title: `Repeated Webhook ${row.status.toUpperCase()} (${row.gateway.toUpperCase()})`,
        message: `${row.count} webhook events marked '${row.status}' on ${row.gateway} in the last 2 hours. Error: ${row.error || 'N/A'}`,
        gateway: row.gateway,
        details: { count: row.count, status: row.status, error: row.error },
        timestamp: now.toISOString(),
        suggestedAction: isDeadLetter
          ? 'Inspect dead-letter queue in Payment Operations and retry or fix webhook signature keys.'
          : 'Check gateway credentials and order validation endpoints.',
      });
    }
  } catch (err) {
    logger.warn('error checking webhook failure alerts', { message: err.message });
  }

  // 2. Verification Failures
  try {
    const verifRes = await db.query(
      `SELECT gateway, COUNT(*)::int AS count
         FROM payment_webhooks
        WHERE status = 'unverified'
          AND created_at >= NOW() - INTERVAL '4 hours'
        GROUP BY gateway
        HAVING COUNT(*) >= 2`
    );

    for (const row of verifRes.rows || []) {
      alerts.push({
        id: `ALERT-VERIF-${row.gateway}`,
        category: ALERT_CATEGORIES.VERIFICATION_FAILURES,
        severity: ALERT_SEVERITIES.HIGH || ALERT_SEVERITIES.CRITICAL,
        title: `Gateway Signature/Verification Rejections (${row.gateway.toUpperCase()})`,
        message: `${row.count} unverified callback signatures rejected on ${row.gateway}. Potential spoofing or key mismatch.`,
        gateway: row.gateway,
        details: { count: row.count },
        timestamp: now.toISOString(),
        suggestedAction: 'Verify gateway secret keys, HMAC settings, and network callback IP whitelist.',
      });
    }
  } catch (err) {
    logger.warn('error checking verification failure alerts', { message: err.message });
  }

  // 3. Timeout Spikes (Pending transactions stuck past 15 minutes)
  try {
    const timeoutRes = await db.query(
      `SELECT gateway, COUNT(*)::int AS count, MIN(created_at) AS oldest_pending
         FROM payment_transactions
        WHERE status = 'pending'
          AND created_at <= NOW() - INTERVAL '15 minutes'
          AND created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY gateway
        HAVING COUNT(*) >= 3`
    );

    for (const row of timeoutRes.rows || []) {
      alerts.push({
        id: `ALERT-TIMEOUT-${row.gateway}`,
        category: ALERT_CATEGORIES.TIMEOUT_SPIKES,
        severity: ALERT_SEVERITIES.WARNING,
        title: `Pending Transaction Timeout Spike (${row.gateway.toUpperCase()})`,
        message: `${row.count} transactions on ${row.gateway} remain pending for over 15 minutes (oldest: ${new Date(row.oldest_pending).toLocaleTimeString()}).`,
        gateway: row.gateway,
        details: { count: row.count, oldestPending: row.oldest_pending },
        timestamp: now.toISOString(),
        suggestedAction: 'Check gateway webhook delivery status or trigger manual status verification.',
      });
    }
  } catch (err) {
    logger.warn('error checking timeout alerts', { message: err.message });
  }

  // 4. Reconciliation Mismatches
  try {
    const reconReport = await reconciliationService.runReconciliation({ limit: 50 });
    const criticalDiscrepancies = (reconReport.discrepancies || []).filter(
      (d) => d.severity === 'critical' || d.severity === 'high'
    );

    if (criticalDiscrepancies.length > 0) {
      alerts.push({
        id: `ALERT-RECON-DISCREPANCIES`,
        category: ALERT_CATEGORIES.RECONCILIATION_MISMATCHES,
        severity: ALERT_SEVERITIES.CRITICAL,
        title: `Payment Reconciliation Mismatches Detected (${criticalDiscrepancies.length})`,
        message: `Reconciliation scan detected ${criticalDiscrepancies.length} critical payment discrepancies (e.g., amount mismatch, duplicate references, or orphan transactions).`,
        gateway: 'all',
        details: {
          count: criticalDiscrepancies.length,
          types: Array.from(new Set(criticalDiscrepancies.map((d) => d.type))),
        },
        timestamp: now.toISOString(),
        suggestedAction: 'Review Payment Operations reconciliation table and authorize appropriate corrective actions.',
      });
    }
  } catch (err) {
    logger.warn('error checking reconciliation alerts', { message: err.message });
  }

  // If notify option is requested, broadcast alerts to admin subscribers
  if (options.notify && alerts.length > 0) {
    for (const alert of alerts) {
      await notifications.notifyAdmins({
        type: 'operational_alert',
        title: alert.title,
        message: alert.message,
        link: '/payment-operations',
        roleTarget: 'billing',
        rawData: alert,
      }).catch(() => {});
    }
  }

  const countsBySeverity = {
    [ALERT_SEVERITIES.CRITICAL]: alerts.filter((a) => a.severity === ALERT_SEVERITIES.CRITICAL).length,
    [ALERT_SEVERITIES.WARNING]: alerts.filter((a) => a.severity === ALERT_SEVERITIES.WARNING).length,
    [ALERT_SEVERITIES.INFO]: alerts.filter((a) => a.severity === ALERT_SEVERITIES.INFO).length,
  };

  return {
    success: true,
    timestamp: now.toISOString(),
    totalAlerts: alerts.length,
    countsBySeverity,
    alerts,
  };
}

module.exports = {
  ALERT_CATEGORIES,
  ALERT_SEVERITIES,
  getOperationalAlerts,
};
