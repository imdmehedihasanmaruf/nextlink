'use strict';

/**
 * Payment Reconciliation Service
 *
 * Implements read-only cross-table and cross-system reconciliation comparing:
 * - Local payment transactions (`payment_transactions`)
 * - Invoices (`invoices`)
 * - Billing events trail (`billing_events`)
 * - Inbound webhook records (`payment_webhooks`)
 * - Audit logs (`audit_log`)
 * - Gateway provider verified status (via provider API or adapter)
 *
 * Discrepancy Categories Detected:
 * 1. PROVIDER_PAID_LOCAL_PENDING
 * 2. LOCAL_PAID_PROVIDER_UNVERIFIED
 * 3. DUPLICATE_TRANSACTION_REFERENCE
 * 4. AMOUNT_MISMATCH
 * 5. CURRENCY_MISMATCH
 * 6. ORPHAN_TRANSACTION
 * 7. MISSING_SETTLEMENT_EVENT
 * 8. INCONSISTENT_INVOICE_BALANCE
 *
 * Designed to be read-only by default. Corrective mutations require explicit staff
 * authorization and comprehensive audit logging.
 */

const db = require('../../lib/db');
const logger = require('../../lib/logger');
const utils = require('../../lib/utils');
const { audit, ROLES } = require('../../middleware/auth');
const gateways = require('./gateways');

const DISCREPANCY_TYPES = {
  PROVIDER_PAID_LOCAL_PENDING: 'PROVIDER_PAID_LOCAL_PENDING',
  LOCAL_PAID_PROVIDER_UNVERIFIED: 'LOCAL_PAID_PROVIDER_UNVERIFIED',
  DUPLICATE_TRANSACTION_REFERENCE: 'DUPLICATE_TRANSACTION_REFERENCE',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  ORPHAN_TRANSACTION: 'ORPHAN_TRANSACTION',
  MISSING_SETTLEMENT_EVENT: 'MISSING_SETTLEMENT_EVENT',
  INCONSISTENT_INVOICE_BALANCE: 'INCONSISTENT_INVOICE_BALANCE',
};

const SEVERITY_LEVELS = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

/**
 * Run comprehensive read-only reconciliation scan
 *
 * @param {object} options
 * @param {number} [options.limit=100] Maximum number of transactions/invoices to inspect
 * @param {string} [options.gateway] Filter by specific gateway
 * @param {string} [options.status] Filter by transaction status
 * @param {string} [options.discrepancyType] Filter by specific discrepancy code
 * @param {string} [options.dateFrom] ISO date string or YYYY-MM-DD
 * @param {string} [options.dateTo] ISO date string or YYYY-MM-DD
 * @param {boolean} [options.checkProvider=false] Whether to query external gateway APIs
 * @returns {Promise<object>} Reconciliation report
 */
async function runReconciliation(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
  const gatewayFilter = options.gateway && options.gateway !== 'all' ? String(options.gateway).toLowerCase() : null;
  const statusFilter = options.status && options.status !== 'all' ? String(options.status).toLowerCase() : null;
  const dateFrom = options.dateFrom ? new Date(options.dateFrom) : null;
  const dateTo = options.dateTo ? new Date(options.dateTo) : null;
  const checkProvider = Boolean(options.checkProvider);

  const discrepancies = [];

  // 1. Fetch transactions within scope
  let txQuery = 'SELECT * FROM payment_transactions WHERE 1=1';
  const txParams = [];

  if (gatewayFilter) {
    txParams.push(gatewayFilter);
    txQuery += ` AND LOWER(gateway) = $${txParams.length}`;
  }
  if (statusFilter) {
    txParams.push(statusFilter);
    txQuery += ` AND LOWER(status) = $${txParams.length}`;
  }
  if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
    txParams.push(dateFrom.toISOString());
    txQuery += ` AND created_at >= $${txParams.length}`;
  }
  if (dateTo && !Number.isNaN(dateTo.getTime())) {
    txParams.push(dateTo.toISOString());
    txQuery += ` AND created_at <= $${txParams.length}`;
  }

  txParams.push(limit);
  txQuery += ` ORDER BY created_at DESC LIMIT $${txParams.length}`;

  const txResults = await db.query(txQuery, txParams);
  const transactions = txResults.rows || [];

  // 2. Fetch associated invoices
  const invoiceIds = Array.from(new Set(transactions.map((t) => t.invoice_id).filter(Boolean)));
  let invoiceMap = new Map();
  if (invoiceIds.length > 0) {
    const invRes = await db.query(
      'SELECT * FROM invoices WHERE id = ANY($1)',
      [invoiceIds]
    );
    for (const inv of invRes.rows || []) {
      invoiceMap.set(inv.id, inv);
    }
  }

  // 3. Fetch associated billing events
  let billingEventsMap = new Map();
  if (invoiceIds.length > 0) {
    const eventsRes = await db.query(
      `SELECT * FROM billing_events 
       WHERE invoice_id = ANY($1) 
       ORDER BY created_at ASC`,
      [invoiceIds]
    );
    for (const ev of eventsRes.rows || []) {
      if (!billingEventsMap.has(ev.invoice_id)) {
        billingEventsMap.set(ev.invoice_id, []);
      }
      billingEventsMap.get(ev.invoice_id).push(ev);
    }
  }

  // 4. Fetch associated webhooks
  const gatewayTxnIds = Array.from(new Set(transactions.map((t) => t.gateway_txn_id).filter(Boolean)));
  let webhookMap = new Map();
  if (gatewayTxnIds.length > 0) {
    const whRes = await db.query(
      `SELECT * FROM payment_webhooks 
       WHERE gateway_txn_id = ANY($1) 
       ORDER BY created_at DESC`,
      [gatewayTxnIds]
    );
    for (const wh of whRes.rows || []) {
      if (!webhookMap.has(wh.gateway_txn_id)) {
        webhookMap.set(wh.gateway_txn_id, []);
      }
      webhookMap.get(wh.gateway_txn_id).push(wh);
    }
  }

  // Track duplicate references across transactions
  const referenceCounts = new Map();
  for (const tx of transactions) {
    const ref = tx.gateway_txn_id || tx.reference;
    if (ref && String(ref).trim() !== '') {
      const key = `${String(tx.gateway).toLowerCase()}::${ref}`;
      referenceCounts.set(key, (referenceCounts.get(key) || 0) + 1);
    }
  }

  // 5. Evaluate Transaction-level discrepancies
  for (const tx of transactions) {
    const invoice = tx.invoice_id ? invoiceMap.get(tx.invoice_id) : null;
    const events = tx.invoice_id ? (billingEventsMap.get(tx.invoice_id) || []) : [];
    const webhooks = tx.gateway_txn_id ? (webhookMap.get(tx.gateway_txn_id) || []) : [];

    // Check 3: Duplicate Transaction Reference
    const refKey = `${String(tx.gateway).toLowerCase()}::${tx.gateway_txn_id || tx.reference}`;
    if ((referenceCounts.get(refKey) || 0) > 1) {
      discrepancies.push({
        id: `DISC-DUP-${tx.id}`,
        type: DISCREPANCY_TYPES.DUPLICATE_TRANSACTION_REFERENCE,
        severity: SEVERITY_LEVELS.CRITICAL,
        transactionId: tx.id,
        invoiceId: tx.invoice_id || null,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: null,
        description: `Duplicate gateway reference '${tx.gateway_txn_id || tx.reference}' detected across multiple transaction records.`,
        details: {
          reference: tx.gateway_txn_id || tx.reference,
          gateway: tx.gateway,
          count: referenceCounts.get(refKey),
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Verify authentic transaction ID with gateway logs and void or consolidate duplicate records.',
      });
    }

    // Check 6: Orphan Transaction
    if (!tx.invoice_id || !invoice) {
      discrepancies.push({
        id: `DISC-ORPHAN-${tx.id}`,
        type: DISCREPANCY_TYPES.ORPHAN_TRANSACTION,
        severity: SEVERITY_LEVELS.HIGH,
        transactionId: tx.id,
        invoiceId: tx.invoice_id || null,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: null,
        description: !tx.invoice_id
          ? `Transaction ${tx.id} has no invoice_id assigned.`
          : `Transaction ${tx.id} references non-existent invoice '${tx.invoice_id}'.`,
        details: {
          invoiceId: tx.invoice_id || null,
          amount: tx.amount,
          gateway: tx.gateway,
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Link transaction to appropriate subscriber invoice or flag as unassigned ledger balance.',
      });
      continue; // Skip invoice-dependent checks for orphan transactions
    }

    // Check 4: Amount Mismatch
    const txAmount = Number(tx.amount || 0);
    const invAmount = Number(invoice.amount || 0);
    if (Math.abs(txAmount - invAmount) > 0.01) {
      discrepancies.push({
        id: `DISC-AMT-${tx.id}`,
        type: DISCREPANCY_TYPES.AMOUNT_MISMATCH,
        severity: SEVERITY_LEVELS.CRITICAL,
        transactionId: tx.id,
        invoiceId: tx.invoice_id,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: null,
        description: `Transaction amount ($${txAmount.toFixed(2)}) differs from invoice ${invoice.id} amount ($${invAmount.toFixed(2)}).`,
        details: {
          transactionAmount: txAmount,
          invoiceAmount: invAmount,
          difference: Number((txAmount - invAmount).toFixed(2)),
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Review price calculations and require billing adjustment before settling.',
      });
    }

    // Check 5: Currency Mismatch
    const expectedCurrency = 'USD';
    const txCurrency = String(tx.currency || '').toUpperCase();
    if (txCurrency && txCurrency !== expectedCurrency) {
      discrepancies.push({
        id: `DISC-CURR-${tx.id}`,
        type: DISCREPANCY_TYPES.CURRENCY_MISMATCH,
        severity: SEVERITY_LEVELS.HIGH,
        transactionId: tx.id,
        invoiceId: tx.invoice_id,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: null,
        description: `Transaction currency '${txCurrency}' does not match system standard '${expectedCurrency}'.`,
        details: {
          expectedCurrency,
          actualCurrency: txCurrency,
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Normalize gateway currency mapping or configure exchange rate handling.',
      });
    }

    // Check 8: Inconsistent Invoice Balances
    const isTxSuccess = tx.status === 'success' || tx.status === 'settled';
    const isInvPaid = invoice.status === 'paid';

    if (isTxSuccess && !isInvPaid) {
      discrepancies.push({
        id: `DISC-INCON-INV-${tx.id}`,
        type: DISCREPANCY_TYPES.INCONSISTENT_INVOICE_BALANCE,
        severity: SEVERITY_LEVELS.CRITICAL,
        transactionId: tx.id,
        invoiceId: tx.invoice_id,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: null,
        description: `Transaction ${tx.id} is settled (${tx.status}), but invoice ${invoice.id} remains '${invoice.status}'.`,
        details: {
          transactionStatus: tx.status,
          invoiceStatus: invoice.status,
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Apply settlement to invoice and restore subscriber service if eligible.',
      });
    } else if (!isTxSuccess && isInvPaid) {
      // Check if there is another successful transaction for this invoice
      const hasOtherSuccessTx = transactions.some(
        (t) => t.invoice_id === tx.invoice_id && (t.status === 'success' || t.status === 'settled')
      );
      if (!hasOtherSuccessTx) {
        discrepancies.push({
          id: `DISC-INCON-TX-${tx.id}`,
          type: DISCREPANCY_TYPES.INCONSISTENT_INVOICE_BALANCE,
          severity: SEVERITY_LEVELS.CRITICAL,
          transactionId: tx.id,
          invoiceId: tx.invoice_id,
          gateway: tx.gateway,
          gatewayTxnId: tx.gateway_txn_id,
          subscriberId: tx.subscriber_id,
          localStatus: tx.status,
          providerStatus: null,
          description: `Invoice ${invoice.id} is marked 'paid', but transaction ${tx.id} is '${tx.status}' with no other settled transaction found.`,
          details: {
            transactionStatus: tx.status,
            invoiceStatus: invoice.status,
          },
          detectedAt: new Date().toISOString(),
          recommendedAction: 'Investigate how invoice was marked paid without settled gateway transaction.',
        });
      }
    }

    // Check 7: Missing Settlement Event
    if (isTxSuccess || isInvPaid) {
      const hasSettlementEvent = events.some(
        (e) => e.event === 'payment_received' || e.event === 'payment_settled'
      );
      if (!hasSettlementEvent) {
        discrepancies.push({
          id: `DISC-EVENT-${tx.id}`,
          type: DISCREPANCY_TYPES.MISSING_SETTLEMENT_EVENT,
          severity: SEVERITY_LEVELS.MEDIUM,
          transactionId: tx.id,
          invoiceId: tx.invoice_id,
          gateway: tx.gateway,
          gatewayTxnId: tx.gateway_txn_id,
          subscriberId: tx.subscriber_id,
          localStatus: tx.status,
          providerStatus: null,
          description: `Settled transaction/paid invoice has no corresponding 'payment_received' event in billing_events trail.`,
          details: {
            transactionId: tx.id,
            invoiceId: tx.invoice_id,
            existingEvents: events.map((e) => e.event),
          },
          detectedAt: new Date().toISOString(),
          recommendedAction: 'Append audit billing_event to complete compliance audit trail.',
        });
      }
    }

    // Check 1: Provider Paid but Local Pending (based on webhook evidence or active query)
    const successfulWebhook = webhooks.find((w) => w.status === 'processed' || (w.payload && (w.payload.status === 'success' || w.payload.status === 'VALID' || w.payload.status === 'Completed')));
    if (successfulWebhook && tx.status === 'pending') {
      discrepancies.push({
        id: `DISC-PRV-PAID-${tx.id}`,
        type: DISCREPANCY_TYPES.PROVIDER_PAID_LOCAL_PENDING,
        severity: SEVERITY_LEVELS.HIGH,
        transactionId: tx.id,
        invoiceId: tx.invoice_id,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: 'success',
        description: `Gateway webhook reports successful payment for ${tx.gateway_txn_id}, but local transaction remains 'pending'.`,
        details: {
          webhookId: successfulWebhook.id,
          webhookStatus: successfulWebhook.status,
          gatewayTxnId: tx.gateway_txn_id,
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Process webhook retry or run server-side verification to settle.',
      });
    }

    // Check 2: Local Paid but Provider Unverified
    const failedWebhook = webhooks.find((w) => w.status === 'unverified' || w.status === 'failed');
    if (isTxSuccess && failedWebhook) {
      discrepancies.push({
        id: `DISC-LOC-PAID-${tx.id}`,
        type: DISCREPANCY_TYPES.LOCAL_PAID_PROVIDER_UNVERIFIED,
        severity: SEVERITY_LEVELS.CRITICAL,
        transactionId: tx.id,
        invoiceId: tx.invoice_id,
        gateway: tx.gateway,
        gatewayTxnId: tx.gateway_txn_id,
        subscriberId: tx.subscriber_id,
        localStatus: tx.status,
        providerStatus: 'unverified',
        description: `Local transaction is marked success, but gateway webhook was recorded as unverified/failed: ${failedWebhook.error || 'unverified'}.`,
        details: {
          webhookId: failedWebhook.id,
          webhookError: failedWebhook.error,
          gatewayTxnId: tx.gateway_txn_id,
        },
        detectedAt: new Date().toISOString(),
        recommendedAction: 'Perform direct server-to-server gateway order validation.',
      });
    }

    // Optional active provider check if requested
    if (checkProvider && tx.gateway && tx.gateway_txn_id) {
      try {
        const gw = gateways.resolveGateway(tx.gateway);
        const pResult = await gw.verifyPayment({ transactionId: tx.gateway_txn_id });
        if (pResult.status === 'success' && tx.status === 'pending') {
          if (!discrepancies.some((d) => d.id === `DISC-PRV-PAID-${tx.id}`)) {
            discrepancies.push({
              id: `DISC-PRV-PAID-${tx.id}`,
              type: DISCREPANCY_TYPES.PROVIDER_PAID_LOCAL_PENDING,
              severity: SEVERITY_LEVELS.HIGH,
              transactionId: tx.id,
              invoiceId: tx.invoice_id,
              gateway: tx.gateway,
              gatewayTxnId: tx.gateway_txn_id,
              subscriberId: tx.subscriber_id,
              localStatus: tx.status,
              providerStatus: pResult.status,
              description: `Live provider query confirms completed payment, but local transaction is 'pending'.`,
              details: { providerResult: pResult },
              detectedAt: new Date().toISOString(),
              recommendedAction: 'Settle invoice and complete local transaction.',
            });
          }
        } else if (pResult.status !== 'success' && isTxSuccess) {
          if (!discrepancies.some((d) => d.id === `DISC-LOC-PAID-${tx.id}`)) {
            discrepancies.push({
              id: `DISC-LOC-PAID-${tx.id}`,
              type: DISCREPANCY_TYPES.LOCAL_PAID_PROVIDER_UNVERIFIED,
              severity: SEVERITY_LEVELS.CRITICAL,
              transactionId: tx.id,
              invoiceId: tx.invoice_id,
              gateway: tx.gateway,
              gatewayTxnId: tx.gateway_txn_id,
              subscriberId: tx.subscriber_id,
              localStatus: tx.status,
              providerStatus: pResult.status,
              description: `Live provider query returned '${pResult.status}', but local transaction is marked settled.`,
              details: { providerResult: pResult },
              detectedAt: new Date().toISOString(),
              recommendedAction: 'Investigate discrepancy with gateway dispute team.',
            });
          }
        }
      } catch (err) {
        logger.warn('active provider reconciliation query failed', {
          gateway: tx.gateway,
          transactionId: tx.gateway_txn_id,
          message: err.message,
        });
      }
    }
  }

  // 6. Check for Paid Invoices that have NO payment_transactions at all
  const paidInvoicesRes = await db.query(
    `SELECT * FROM invoices 
     WHERE status = 'paid' 
       AND created_at >= NOW() - INTERVAL '30 days'
     ORDER BY created_at DESC 
     LIMIT 100`
  );
  for (const inv of paidInvoicesRes.rows || []) {
    const hasTx = transactions.some((t) => t.invoice_id === inv.id);
    if (!hasTx) {
      // Look up if any transaction exists for this invoice in DB
      const existingTx = await db.queryOne(
        'SELECT id, status FROM payment_transactions WHERE invoice_id = $1 LIMIT 1',
        [inv.id]
      );
      if (!existingTx) {
        discrepancies.push({
          id: `DISC-INCON-NOTX-${inv.id}`,
          type: DISCREPANCY_TYPES.INCONSISTENT_INVOICE_BALANCE,
          severity: SEVERITY_LEVELS.HIGH,
          transactionId: null,
          invoiceId: inv.id,
          gateway: inv.raw_data?.paidVia || 'unknown',
          gatewayTxnId: inv.raw_data?.transactionId || null,
          subscriberId: inv.subscriber_id,
          localStatus: 'no_transaction',
          providerStatus: null,
          description: `Invoice ${inv.id} is marked 'paid' ($${Number(inv.amount || 0).toFixed(2)}) but has zero payment_transactions recorded.`,
          details: {
            invoiceAmount: inv.amount,
            paidVia: inv.raw_data?.paidVia || null,
            paidAt: inv.raw_data?.paidAt || null,
          },
          detectedAt: new Date().toISOString(),
          recommendedAction: 'Create offline cash receipt or link transaction record.',
        });
      }
    }
  }

  // Apply discrepancy type filter if specified
  const filteredDiscrepancies = options.discrepancyType && options.discrepancyType !== 'all'
    ? discrepancies.filter((d) => d.type === options.discrepancyType)
    : discrepancies;

  // Compile summary statistics
  const discrepanciesByType = {};
  for (const code of Object.values(DISCREPANCY_TYPES)) {
    discrepanciesByType[code] = 0;
  }
  for (const d of filteredDiscrepancies) {
    discrepanciesByType[d.type] = (discrepanciesByType[d.type] || 0) + 1;
  }

  return {
    success: true,
    timestamp: new Date().toISOString(),
    summary: {
      total_transactions_scanned: transactions.length,
      total_invoices_scanned: invoiceMap.size + (paidInvoicesRes.rows ? paidInvoicesRes.rows.length : 0),
      discrepancies_count: filteredDiscrepancies.length,
      discrepancies_by_type: discrepanciesByType,
      status: filteredDiscrepancies.length === 0 ? 'clean' : 'discrepancies_detected',
    },
    discrepancies: filteredDiscrepancies,
  };
}

/**
 * Resolve or apply corrective action to a reconciliation discrepancy.
 * Requires explicit staff authorization, safe mutation guards, and audit logging.
 *
 * @param {object} params
 * @param {string} params.discrepancyType
 * @param {string} [params.transactionId]
 * @param {string} [params.invoiceId]
 * @param {string} params.action ('mark_invoice_paid' | 'sync_transaction_status' | 'record_missing_event' | 'dismiss')
 * @param {string} params.reason Mandatory justification from staff
 * @param {string} params.actorId Staff user ID
 * @param {string} params.actorRole Staff user role
 * @param {string} params.ip Request IP address
 */
async function resolveDiscrepancy({
  discrepancyType,
  transactionId,
  invoiceId,
  action,
  reason,
  actorId,
  actorRole,
  ip,
}) {
  if (!action) {
    const err = new Error('action is required to resolve a discrepancy');
    err.statusCode = 400;
    throw err;
  }
  if (!reason || String(reason).trim().length < 5) {
    const err = new Error('A detailed reason (min 5 characters) is required for authorized corrective actions');
    err.statusCode = 400;
    throw err;
  }

  let transaction = null;
  if (transactionId) {
    transaction = await db.queryOne('SELECT * FROM payment_transactions WHERE id = $1', [transactionId]);
  }
  let invoice = null;
  const effectiveInvoiceId = invoiceId || transaction?.invoice_id;
  if (effectiveInvoiceId) {
    invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [effectiveInvoiceId]);
  }

  let resolutionDetails = {};

  if (action === 'mark_invoice_paid') {
    if (!invoice) {
      const err = new Error('Invoice not found for settlement');
      err.statusCode = 404;
      throw err;
    }
    const billing = require('../billing/engine');
    const result = await billing.applyPayment({
      invoiceId: invoice.id,
      transactionId: transaction?.gateway_txn_id || transactionId || `MANUAL-${Date.now()}`,
      gateway: transaction?.gateway || 'manual',
      amount: transaction?.amount || invoice.amount,
      raw: { resolvedBy: actorId, reason },
    });
    if (transaction) {
      await db.query(
        "UPDATE payment_transactions SET status = 'success', updated_at = NOW() WHERE id = $1",
        [transaction.id]
      );
    }
    resolutionDetails = { invoiceId: invoice.id, settled: true, alreadyPaid: result.alreadyPaid };
  } else if (action === 'sync_transaction_status') {
    if (!transaction) {
      const err = new Error('Transaction not found to update status');
      err.statusCode = 404;
      throw err;
    }
    const targetStatus = invoice?.status === 'paid' ? 'success' : 'failed';
    await db.query(
      'UPDATE payment_transactions SET status = $2, updated_at = NOW() WHERE id = $1',
      [transaction.id, targetStatus]
    );
    resolutionDetails = { transactionId: transaction.id, updatedStatus: targetStatus };
  } else if (action === 'record_missing_event') {
    if (!invoice) {
      const err = new Error('Invoice not found to record event');
      err.statusCode = 404;
      throw err;
    }
    const settledAmount = transaction?.amount || invoice.amount;
    await db.query(
      `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
       VALUES ($1, $2, 'payment_received', $3, $4, $5)`,
      [
        invoice.subscriber_id,
        invoice.id,
        settledAmount,
        `Reconciliation retroactive settlement event authorized by ${actorId}: ${reason}`,
        JSON.stringify({ transactionId, actorId, reason, resolvedAt: new Date().toISOString() }),
      ]
    );
    resolutionDetails = { invoiceId: invoice.id, eventRecorded: 'payment_received' };
  } else if (action === 'dismiss') {
    resolutionDetails = { dismissed: true, reason };
  } else {
    const err = new Error(`Unsupported action: ${action}`);
    err.statusCode = 400;
    throw err;
  }

  // Mandatory Staff Audit Trail
  await audit({
    actorId,
    actorRole,
    action: 'payment.reconciliation.resolved',
    entityType: 'payment_reconciliation',
    entityId: transactionId || invoiceId || 'global',
    details: {
      discrepancyType,
      transactionId,
      invoiceId: effectiveInvoiceId,
      action,
      reason,
      resolutionDetails,
    },
    ip,
  });

  return {
    success: true,
    action,
    discrepancyType,
    details: resolutionDetails,
    resolvedAt: new Date().toISOString(),
  };
}

module.exports = {
  DISCREPANCY_TYPES,
  SEVERITY_LEVELS,
  runReconciliation,
  resolveDiscrepancy,
};
