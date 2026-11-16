'use strict';

const config = require('../../config');
const logger = require('../../lib/logger');
const db = require('../../lib/db');
const utils = require('../../lib/utils');
const dates = require('../../lib/dates');
const mikrotik = require('../mikrotik');
const sms = require('../sms');
const referrals = require('../referrals');
const settings = require('../settings');
const notifications = require('../notifications');

/**
 * Automated Billing Engine (Integer-Cents Precision & UTC Timestamps)
 *
 * Rules implemented (Requirement 4):
 *   4a. On a new subscription, on ANY day of the signup month (1st–31st),
 *       charge once:
 *         - Installation fee: configurable (default $8.99 = 899 cents)
 *         - Tax fee: configurable (default $0.99 = 99 cents)
 *         - Plus the package price for that month. No proration.
 *   4b. From the following month onward, charge only the monthly package price.
 *   4c. If a month's payment is unpaid:
 *         - Carry the unpaid amount forward into the next month's bill.
 *         - Add a configurable late fee (default 2%), calculated on the
 *           selected package plan's price, to the next bill.
 *         - Show late fee and carried-over amounts as separate line items on
 *           the invoice (`raw_data.lines` + dedicated columns).
 *         - Never apply a late fee twice for the same missed month.
 *   4d. Idempotent invoice generation and complete `billing_events` logging.
 *   4e. Configurable fees ($8.99, $0.99, 2%) read from `system_settings.billing`.
 */

const INVOICE_PREFIX = 'INV';

/**
 * Load active billing fee configuration from `system_settings.billing`
 * with fallback to defaults ($8.99 installation, $0.99 tax, 2% late fee).
 */
async function getBillingConfig() {
  try {
    const group = await settings.getGroup('billing');
    const installationFee = Number(group?.installation_fee ?? group?.installationFee ?? 8.99);
    const taxFee = Number(group?.tax_fee ?? group?.taxFee ?? 0.99);
    const rawLateFeeType = String(group?.late_fee_type || group?.lateFeeType || 'percent').toLowerCase();
    const lateFeeType = rawLateFeeType === 'flat' ? 'flat' : 'percent';
    const rawLateFeeVal = Number(group?.late_fee_value ?? group?.lateFeeValue ?? group?.lateFeePercent ?? 10);
    const lateFeeValue = Number.isFinite(rawLateFeeVal) && rawLateFeeVal >= 0 ? rawLateFeeVal : 10;
    const cancelGroup = await settings.getGroup('cancellation').catch(() => ({}));
    const rechargeAfterCancelTreatAsNew = Boolean(
      cancelGroup?.rechargeAfterCancelTreatAsNew ?? group?.rechargeAfterCancelTreatAsNew ?? true
    );
    return {
      currency: String(group?.currency || config.billing.currency || 'USD').toUpperCase(),
      dueDay: Number(group?.dueDay ?? config.billing.dueDay ?? 10),
      lateGraceDays: Number(group?.lateGraceDays ?? config.billing.lateGraceDays ?? 5),
      suspendAfterDays: Number(group?.suspendAfterDays ?? config.billing.suspendAfterDays ?? 10),
      timezone: String(group?.timezone || 'UTC'),
      installationFee: utils.fromCents(utils.toCents(installationFee)),
      installationFeeCents: utils.toCents(installationFee),
      taxFee: utils.fromCents(utils.toCents(taxFee)),
      taxFeeCents: utils.toCents(taxFee),
      late_fee_type: lateFeeType,
      late_fee_value: lateFeeValue,
      lateFeeType,
      lateFeeValue,
      lateFeePercent: lateFeeValue,
      rechargeAfterCancelTreatAsNew,
    };
  } catch {
    return {
      currency: 'USD',
      dueDay: 10,
      lateGraceDays: 5,
      suspendAfterDays: 10,
      timezone: 'UTC',
      installationFee: 8.99,
      installationFeeCents: 899,
      taxFee: 0.99,
      taxFeeCents: 99,
      late_fee_type: 'percent',
      late_fee_value: 10,
      lateFeeType: 'percent',
      lateFeeValue: 10,
      lateFeePercent: 10,
      rechargeAfterCancelTreatAsNew: true,
    };
  }
}

/**
 * Read the billing-relevant fields of a subscriber row.
 */
function readSubscriber(row) {
  const raw = row.raw_data || {};
  return {
    id: row.id,
    firstName: row.first_name || raw.firstName || '',
    lastName: row.last_name || raw.lastName || '',
    name: row.name || raw.name || '',
    phone: row.phone || raw.phone || '',
    email: row.email || raw.email || '',
    packageId: row.package_id || raw.packageId || '',
    packageName: row.package_name_joined || raw.packageName || raw.package || '',
    status: row.status || 'active',
    balance: Number(raw.balance || 0),
    creditBalance: Number(raw.credit_balance || 0),
    dueDate: raw.dueDate || '',
    joinDate: raw.joinDate || raw.subscription_started_at || '',
    pppoeUsername: raw.pppoeUsername || raw.username || raw.connectionUsername || '',
    pppoePassword: raw.pppoePassword || raw.connectionPassword || '',
    ipAddress: raw.ipAddress || '',
    macAddress: raw.macAddress || '',
    connectionType: raw.connectionType || 'pppoe',
    zone: raw.zone || '',
  };
}

/**
 * Ensure a billing profile row exists for a subscriber.
 */
async function ensureBillingProfile(subscriber, packagePrice, signupDate = null) {
  const existing = await db.queryOne(
    'SELECT * FROM subscriber_billing WHERE subscriber_id = $1',
    [subscriber.id],
  );

  const priceFormatted = utils.fromCents(utils.toCents(packagePrice || 0));

  if (existing) {
    if (packagePrice !== undefined && utils.toCents(existing.amount) !== utils.toCents(priceFormatted)) {
      await db.query(
        `UPDATE subscriber_billing SET amount = $2, package_id = $3, updated_at = NOW() WHERE subscriber_id = $1`,
        [subscriber.id, priceFormatted, subscriber.packageId || null],
      );
      existing.amount = priceFormatted;
    }
    return existing;
  }

  const billingCfg = await getBillingConfig();
  const startStr = signupDate
    ? (typeof signupDate === 'string' ? signupDate.slice(0, 10) : new Date(signupDate).toISOString().slice(0, 10))
    : new Date().toISOString().slice(0, 10);

  const created = await db.queryOne(
    `INSERT INTO subscriber_billing
       (subscriber_id, package_id, amount, currency, billing_start, next_invoice_date, auto_disconnect, status, raw_data)
     VALUES ($1, $2, $3, $4, $5::date, $6, TRUE, $7, $8)
     ON CONFLICT (subscriber_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      subscriber.id,
      subscriber.packageId || null,
      priceFormatted,
      billingCfg.currency,
      startStr,
      dates.addDays(new Date(), billingCfg.dueDay),
      subscriber.status === 'active' ? 'active' : 'inactive',
      JSON.stringify({ createdBy: 'billing-engine', signupDate: startStr }),
    ],
  );
  return created;
}

/**
 * Get the package details (name & price) for a subscriber from `packages`.
 */
async function getPackageDetails(packageId) {
  if (!packageId) return null;
  const row = await db.queryOne('SELECT id, name, price, speed, upload_speed FROM packages WHERE id = $1', [packageId]);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    price: utils.fromCents(utils.toCents(row.price || 0)),
    priceCents: utils.toCents(row.price || 0),
    speed: Number(row.speed || 0),
    uploadSpeed: Number(row.upload_speed || row.speed || 0),
  };
}

async function getPackagePrice(packageId) {
  const pkg = await getPackageDetails(packageId);
  return pkg ? pkg.price : null;
}

/**
 * Format a package name with its total speed in Mbps, e.g. "Standard (200 Mbps)".
 */
function formatPackageWithSpeed(pkg) {
  if (!pkg) return 'Internet Package';
  const rawName = String(pkg.name || 'Internet Package').trim();
  const baseName = rawName.replace(/\s*\(\d+\s*(?:Mbps|Gbps)\)\s*$/i, '').trim() || rawName;
  const speed = Number(pkg.speed || 0);
  if (speed > 0) {
    return `${baseName} (${speed} Mbps)`;
  }
  return rawName;
}

const MONTH_NAMES_UTC = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Format a period ("YYYY-MM") or date ("YYYY-MM-DD" / ISO) into "Month Year" (e.g. "October 2026").
 */
function formatPeriodMonthYear(periodOrDate) {
  if (!periodOrDate) {
    const now = new Date();
    return `${MONTH_NAMES_UTC[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
  }
  const str = String(periodOrDate).trim();
  const match = str.match(/^(\d{4})-(\d{2})/);
  if (match) {
    const year = Number(match[1]);
    const monthIdx = Number(match[2]) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      return `${MONTH_NAMES_UTC[monthIdx]} ${year}`;
    }
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return `${MONTH_NAMES_UTC[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
  }
  return str;
}

/**
 * Calculate the late fee in integer cents on the missed month's package plan price.
 * Supports configurable `late_fee_type` ("percent" | "flat") and `late_fee_value` (default 10%).
 * Rounds percentage late fees half-up to the nearest cent (e.g. 10% of $29.99 = 299.9 cents -> 300 cents = $3.00).
 */
function calculateLateFeeCents(packagePriceCents, rateOrConfig = 10) {
  if (typeof rateOrConfig === 'object' && rateOrConfig !== null) {
    const type = String(rateOrConfig.late_fee_type || rateOrConfig.lateFeeType || 'percent').toLowerCase();
    const val = Number(
      rateOrConfig.late_fee_value ?? rateOrConfig.lateFeeValue ?? rateOrConfig.lateFeePercent ?? 10,
    );
    if (!Number.isFinite(val) || val <= 0) return 0;
    if (type === 'flat') {
      return utils.toCents(val);
    }
    if (packagePriceCents <= 0) return 0;
    return Math.floor((packagePriceCents * val) / 100 + 0.5);
  }
  const pct = Number(rateOrConfig ?? 10);
  if (!Number.isFinite(pct) || pct <= 0 || packagePriceCents <= 0) return 0;
  return Math.floor((packagePriceCents * pct) / 100 + 0.5);
}

/**
 * Calculate an authoritative Subscriber Plan Invoice Preview quote from PostgreSQL.
 *
 * Detects the subscriber's billing scenario on the backend:
 *   - SCENARIO 1 (NEW_SUBSCRIBER): No previous paid/active subscription ever ->
 *       Badge: "New Subscription"
 *       Line items:
 *         1. [Package Name (Total Mbps)] monthly fee: $[package_price]
 *         2. One-Time Installation Fee: +$8.99
 *         3. Tax Fee: +$0.99
 *   - SCENARIO 2 (EXISTING_NORMAL): Has a subscription and no unpaid invoice ->
 *       Badge: "Monthly Renewal" (or "Package Plan Upgrade" if changing plans)
 *       Line items:
 *         1. [Package Name (Total Mbps)] monthly fee: $[package_price]
 *   - SCENARIO 3 (OVERDUE_BALANCE): Has one or more unpaid past-due invoices ->
 *       Badge: "Overdue Balance"
 *       Line items:
 *         1..N. [Package Name (Total Mbps)] previous month fee ([Month Year]): $[package_price]
 *         N+1.  [Package Name (Total Mbps)] running month fee: $[package_price]
 *         N+2.. [Late Fee (10%)]: +$[10% of that missed month's package price]
 */
async function calculateQuote({ subscriberId, packageId, purchaseType }) {
  if (!subscriberId) {
    const err = new Error('subscriberId is required to calculate a billing quote');
    err.status = 400;
    throw err;
  }

  const subRow = await db.queryOne(
    `SELECT s.*, p.name AS current_pkg_name, p.speed AS current_pkg_speed, p.price AS current_pkg_price
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
      WHERE s.id = $1`,
    [subscriberId],
  );
  if (!subRow) {
    const err = new Error('Subscriber account not found');
    err.status = 404;
    throw err;
  }

  const subRaw = subRow.raw_data || {};
  const currentPackageId = subRow.package_id || subRaw.packageId || '';
  const effectivePackageId = packageId || currentPackageId;
  const targetPkg = await getPackageDetails(effectivePackageId);
  if (!targetPkg) {
    const err = new Error('Selected package plan not found');
    err.status = 404;
    throw err;
  }

  const billingCfg = await getBillingConfig();
  const targetPkgLabel = formatPackageWithSpeed(targetPkg);
  const pkgPriceCents = targetPkg.priceCents;

  // Query all non-cancelled invoices for this subscriber in chronological order
  const allInvoices = await db.queryAll(
    `SELECT *
       FROM invoices
      WHERE (subscriber_id = $1 OR raw_data->>'subscriberId' = $1)
        AND status NOT IN ('cancelled')
      ORDER BY COALESCE(raw_data->>'period', due_date, '') ASC, created_at ASC`,
    [subscriberId],
  );

  const invoiceById = new Map(allInvoices.map((inv) => [inv.id, inv]));

  // Collect all unpaid missed-month invoices. If an unpaid invoice carried forward earlier
  // unpaid invoices (via raw_data.carriedFromInvoices), expand the chain chronologically
  // so every missed month is represented once by its own base package fee and its own late fee.
  const openUnpaidInvoices = allInvoices.filter(
    (inv) =>
      (inv.status === 'unpaid' || inv.status === 'overdue') &&
      !(inv.raw_data && inv.raw_data.carriedIntoInvoiceId),
  );

  const unpaidMonthInvoices = [];
  const seenMissedIds = new Set();

  function collectMissedChain(inv) {
    if (!inv || seenMissedIds.has(inv.id)) return;
    const raw = inv.raw_data || {};
    const carriedFrom = Array.isArray(raw.carriedFromInvoices) ? raw.carriedFromInvoices : [];
    for (const srcId of carriedFrom) {
      const srcInv = invoiceById.get(srcId);
      if (srcInv) {
        collectMissedChain(srcInv);
      }
    }
    seenMissedIds.add(inv.id);
    unpaidMonthInvoices.push(inv);
  }

  for (const openInv of openUnpaidInvoices) {
    collectMissedChain(openInv);
  }

  // Sort unpaid missed months chronologically by period / due_date
  unpaidMonthInvoices.sort((a, b) => {
    const pa = (a.raw_data && a.raw_data.period) || a.due_date || '';
    const pb = (b.raw_data && b.raw_data.period) || b.due_date || '';
    return String(pa).localeCompare(String(pb));
  });

  // Determine if subscriber has ever had a paid or active subscription
  const paidInvoicesCount = allInvoices.filter((inv) => inv.status === 'paid').length;
  const paidOrdersRow = await db.queryOne(
    `SELECT COUNT(*)::int AS cnt
       FROM orders
      WHERE customer_id = $1
        AND (UPPER(COALESCE(order_status, '')) = 'ACTIVE' OR LOWER(COALESCE(payment_status, '')) = 'paid')`,
    [subscriberId],
  );
  const paidOrdersCount = Number(paidOrdersRow?.cnt || 0);
  const subStatus = String(subRow.status || '').toLowerCase();
  const isCancelledSub = subStatus === 'cancelled';
  const treatAsNewAfterCancel = Boolean(billingCfg.rechargeAfterCancelTreatAsNew ?? true);

  const hasActiveSubscriptionHistory =
    paidInvoicesCount > 0 ||
    paidOrdersCount > 0 ||
    (Boolean(currentPackageId) &&
      subStatus === 'active' &&
      subRaw.isNewSubscriber !== true &&
      subRaw.source !== 'self-register');

  let scenario = 'NEW_SUBSCRIBER';
  let scenarioNumber = 1;
  let badge = 'New Subscription';
  const lines = [];
  let installationFeeCents = 0;
  let taxFeeCents = 0;
  let carriedOverCents = 0;
  let lateFeeCents = 0;
  const unpaidInvoiceIds = [];

  if (unpaidMonthInvoices.length > 0) {
    // SCENARIO 3: EXISTING SUBSCRIBER WITH UNPAID PREVIOUS MONTH(S)
    scenario = 'OVERDUE_BALANCE';
    scenarioNumber = 3;
    badge = 'Overdue Balance';

    const previousMonthLines = [];
    const lateFeeLines = [];

    for (const mInv of unpaidMonthInvoices) {
      unpaidInvoiceIds.push(mInv.id);
      const mRaw = mInv.raw_data || {};
      const missedPkgId = mRaw.packageId || currentPackageId || targetPkg.id;
      const missedPkg =
        missedPkgId === targetPkg.id
          ? targetPkg
          : (await getPackageDetails(missedPkgId)) || targetPkg;
      const missedPkgLabel = formatPackageWithSpeed(missedPkg);

      // Base package price of that missed month (never includes prior carried-over or late fees)
      let missedBaseCents = 0;
      if (mRaw.subscriptionAmountCents !== undefined && Number(mRaw.subscriptionAmountCents) > 0) {
        missedBaseCents = Number(mRaw.subscriptionAmountCents);
      } else if (mRaw.subscriptionAmount !== undefined && Number(mRaw.subscriptionAmount) > 0) {
        missedBaseCents = utils.toCents(mRaw.subscriptionAmount);
      } else if (mRaw.packagePrice !== undefined && Number(mRaw.packagePrice) > 0) {
        missedBaseCents = utils.toCents(mRaw.packagePrice);
      } else {
        const netCents =
          utils.toCents(mInv.amount || 0) -
          utils.toCents(mInv.installation_fee || 0) -
          utils.toCents(mInv.tax_fee || 0) -
          utils.toCents(mInv.late_fee || 0) -
          utils.toCents(mInv.carried_over_amount || 0);
        missedBaseCents = netCents > 0 ? netCents : missedPkg.priceCents;
      }

      const periodStr = mRaw.period || mInv.due_date || mInv.created_at;
      const monthYearLabel = formatPeriodMonthYear(periodStr);

      previousMonthLines.push({
        code: 'previous_month_fee',
        type: 'carried_over',
        invoiceId: mInv.id,
        period: mRaw.period || '',
        monthYear: monthYearLabel,
        label: `${missedPkgLabel} previous month fee (${monthYearLabel})`,
        description: `${missedPkgLabel} previous month fee (${monthYearLabel})`,
        amountCents: missedBaseCents,
        amount: utils.fromCents(missedBaseCents),
        formattedAmount: `$${utils.fromCentsStr(missedBaseCents)}`,
        prefix: '$',
      });

      const thisLateFeeCents = calculateLateFeeCents(missedBaseCents, billingCfg);
      const lateFeeDescBase =
        billingCfg.late_fee_type === 'flat'
          ? `Late Fee ($${utils.fromCentsStr(thisLateFeeCents)})`
          : `Late Fee (${billingCfg.late_fee_value}%)`;
      const lateFeeLabel =
        unpaidMonthInvoices.length > 1
          ? `${lateFeeDescBase} (${monthYearLabel})`
          : lateFeeDescBase;

      lateFeeLines.push({
        code: 'late_fee',
        type: 'late_fee',
        invoiceId: mInv.id,
        period: mRaw.period || '',
        monthYear: monthYearLabel,
        label: lateFeeLabel,
        description: lateFeeLabel,
        amountCents: thisLateFeeCents,
        amount: utils.fromCents(thisLateFeeCents),
        formattedAmount: `+$${utils.fromCentsStr(thisLateFeeCents)}`,
        prefix: '+$',
      });
    }

    const runningMonthLine = {
      code: 'running_month_fee',
      type: 'subscription',
      label: `${targetPkgLabel} running month fee`,
      description: `${targetPkgLabel} running month fee`,
      amountCents: pkgPriceCents,
      amount: utils.fromCents(pkgPriceCents),
      formattedAmount: `$${utils.fromCentsStr(pkgPriceCents)}`,
      prefix: '$',
    };

    lines.push(...previousMonthLines, runningMonthLine, ...lateFeeLines);
    carriedOverCents = previousMonthLines.reduce((sum, l) => sum + l.amountCents, 0);
    lateFeeCents = lateFeeLines.reduce((sum, l) => sum + l.amountCents, 0);
  } else if (hasActiveSubscriptionHistory && (!isCancelledSub || !treatAsNewAfterCancel)) {
    // SCENARIO 2: EXISTING SUBSCRIBER, NORMAL (no unpaid dues)
    scenario = 'EXISTING_NORMAL';
    scenarioNumber = 2;
    const isSamePackage = Boolean(
      currentPackageId && currentPackageId.trim().toLowerCase() === targetPkg.id.trim().toLowerCase()
    );
    const isPlanChange =
      !isSamePackage &&
      (Boolean(currentPackageId && currentPackageId !== targetPkg.id) ||
        String(purchaseType || '').toUpperCase() === 'UPGRADE');
    badge = isPlanChange ? 'Package Plan Upgrade' : 'Monthly Renewal';

    const monthYearLabel = formatPeriodMonthYear(new Date());
    lines.push({
      code: 'monthly_fee',
      type: 'subscription',
      label: `${targetPkgLabel} monthly fee`,
      description: `${targetPkgLabel} monthly fee (${monthYearLabel})`,
      amountCents: pkgPriceCents,
      amount: utils.fromCents(pkgPriceCents),
      formattedAmount: `$${utils.fromCentsStr(pkgPriceCents)}`,
      prefix: '$',
      period: monthYearLabel,
    });
  } else {
    // SCENARIO 1: NEW SUBSCRIBER (first-ever package purchase, any day 1st-31st, no proration)
    scenario = 'NEW_SUBSCRIBER';
    scenarioNumber = 1;
    badge = 'New Subscription';
    installationFeeCents = billingCfg.installationFeeCents;
    taxFeeCents = billingCfg.taxFeeCents;

    lines.push(
      {
        code: 'monthly_fee',
        type: 'subscription',
        label: `${targetPkgLabel} monthly fee`,
        description: `${targetPkgLabel} monthly fee`,
        amountCents: pkgPriceCents,
        amount: utils.fromCents(pkgPriceCents),
        formattedAmount: `$${utils.fromCentsStr(pkgPriceCents)}`,
        prefix: '$',
      },
      {
        code: 'installation_fee',
        type: 'installation_fee',
        label: 'One-Time Installation Fee',
        description: 'One-Time Installation Fee',
        amountCents: installationFeeCents,
        amount: utils.fromCents(installationFeeCents),
        formattedAmount: `+$${utils.fromCentsStr(installationFeeCents)}`,
        prefix: '+$',
      },
      {
        code: 'tax_fee',
        type: 'tax_fee',
        label: 'Tax Fee',
        description: 'Tax Fee',
        amountCents: taxFeeCents,
        amount: utils.fromCents(taxFeeCents),
        formattedAmount: `+$${utils.fromCentsStr(taxFeeCents)}`,
        prefix: '+$',
      },
    );
  }

  const totalPayableCents =
    pkgPriceCents + installationFeeCents + taxFeeCents + carriedOverCents + lateFeeCents;

  const currentPeriod = dates.currentPeriodKey();
  const currentPeriodPaid = allInvoices.some(
    (inv) =>
      inv.status === 'paid' &&
      (
        (inv.raw_data && inv.raw_data.period === currentPeriod) ||
        (inv.due_date && String(inv.due_date).startsWith(currentPeriod))
      ),
  );

  let alreadyPaid = false;
  const paidMonthYear = formatPeriodMonthYear(currentPeriod);
  const [cYear, cMonth] = currentPeriod.split('-').map(Number);
  const nextMonthDate = new Date(Date.UTC(cYear, cMonth, 1));
  const nextPeriod = `${nextMonthDate.getUTCFullYear()}-${String(nextMonthDate.getUTCMonth() + 1).padStart(2, '0')}`;
  const nextDueDateRaw = dates.dueDateForPeriod(nextPeriod, billingCfg.dueDay);
  const [ndY, ndM, ndD] = nextDueDateRaw.split('-');
  const nextDueDateFormatted = `${ndD}/${ndM}/${ndY}`;
  let paidNotice = '';

  const isRenewalTarget =
    Boolean(currentPackageId && currentPackageId.trim().toLowerCase() === targetPkg.id.trim().toLowerCase()) ||
    String(purchaseType || '').toUpperCase() === 'RENEWAL';

  if (unpaidMonthInvoices.length === 0 && currentPeriodPaid && isRenewalTarget) {
    alreadyPaid = true;
    paidNotice = `Paid for ${paidMonthYear}. Next due: ${nextDueDateFormatted}`;
  }

  return {
    subscriberId,
    packageId: targetPkg.id,
    packageName: targetPkg.name,
    packageSpeed: targetPkg.speed,
    packageLabel: targetPkgLabel,
    scenario,
    scenarioNumber,
    badge,
    currency: billingCfg.currency,
    alreadyPaid,
    isCurrentPeriodPaid: Boolean(currentPeriodPaid && unpaidMonthInvoices.length === 0),
    paidMonthYear,
    nextDueDate: nextDueDateFormatted,
    paidNotice,
    packagePrice: utils.fromCents(pkgPriceCents),
    packagePriceCents: pkgPriceCents,
    installationFee: utils.fromCents(installationFeeCents),
    installationFeeCents,
    taxFee: utils.fromCents(taxFeeCents),
    taxFeeCents,
    taxes: utils.fromCents(taxFeeCents),
    carriedOverAmount: utils.fromCents(carriedOverCents),
    carriedOverCents,
    previousDue: utils.fromCents(carriedOverCents + lateFeeCents),
    lateFee: utils.fromCents(lateFeeCents),
    lateFeeCents,
    late_fee_type: billingCfg.late_fee_type,
    late_fee_value: billingCfg.late_fee_value,
    lateFeeType: billingCfg.late_fee_type,
    lateFeeValue: billingCfg.late_fee_value,
    lateFeePercent: billingCfg.lateFeePercent,
    unpaidInvoiceIds,
    unpaidMonthsCount: unpaidMonthInvoices.length,
    lines,
    totalPayable: utils.fromCents(totalPayableCents),
    totalPayableCents,
    formattedTotalPayable: `$${utils.fromCentsStr(totalPayableCents)}`,
    verifiedAt: utils.nowIso(),
  };
}

/**
 * Determine whether a subscriber is in their initial signup month and has not
 * yet been charged the one-time installation + tax fee.
 */
async function isSubscriberFirstBill({ subscriberId, period, signupDate, explicitIsNewSubscription }) {
  if (typeof explicitIsNewSubscription === 'boolean') {
    return explicitIsNewSubscription;
  }

  // Check if any invoice already exists for this subscriber across any period
  const priorCountRow = await db.queryOne(
    `SELECT COUNT(*)::int AS count FROM invoices WHERE subscriber_id = $1 AND id <> $2`,
    [subscriberId, `${INVOICE_PREFIX}-${period.replace('-', '')}-${subscriberId}`],
  );
  const priorCount = Number(priorCountRow?.count || 0);
  if (priorCount > 0) {
    return false;
  }

  if (signupDate) {
    const signupIso = typeof signupDate === 'string' ? signupDate : new Date(signupDate).toISOString();
    const signupPeriod = signupIso.slice(0, 7);
    return signupPeriod === period;
  }

  // Check subscriber_billing.billing_start or subscribers.raw_data.subscription_started_at
  const billingRow = await db.queryOne(
    `SELECT billing_start, raw_data FROM subscriber_billing WHERE subscriber_id = $1`,
    [subscriberId],
  );
  if (billingRow?.billing_start) {
    const startIso =
      billingRow.billing_start instanceof Date
        ? billingRow.billing_start.toISOString()
        : String(billingRow.billing_start);
    if (startIso.slice(0, 7) === period) {
      return true;
    }
  }

  return false;
}

/**
 * Generate one invoice for a subscriber for a given period (YYYY-MM).
 *
 * Idempotent: re-running for the same subscriber + period returns the existing
 * invoice (`created: false`) without duplicating charges or late fees.
 *
 * @param {object} params
 * @param {object} params.subscriber
 * @param {string} params.period          YYYY-MM period string (e.g. '2026-11')
 * @param {number} [params.amount]        Monthly package price in USD
 * @param {string} [params.dueDate]       YYYY-MM-DD due date
 * @param {boolean} [params.isNewSubscription] Force first-month rules (install + tax fee)
 * @param {string|Date} [params.signupDate] Optional signup date (any day 1st–31st)
 */
async function generateInvoice({
  subscriber,
  period,
  amount,
  baseAmount,
  dueDate,
  isNewSubscription,
  signupDate = null,
}) {
  const invoiceId = `${INVOICE_PREFIX}-${period.replace('-', '')}-${subscriber.id}`;
  const existing = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (existing) {
    const eRaw = existing.raw_data || {};
    return {
      invoice: {
        ...existing,
        installationFee: Number(existing.installation_fee ?? eRaw.installationFee ?? 0),
        taxFee: Number(existing.tax_fee ?? eRaw.taxFee ?? 0),
        lateFee: Number(existing.late_fee ?? eRaw.lateFee ?? 0),
        carriedOverAmount: Number(existing.carried_over_amount ?? eRaw.carriedOverAmount ?? 0),
        dueDate: existing.due_date || eRaw.dueDate || '',
        lines: Array.isArray(eRaw.lines) ? eRaw.lines : [],
      },
      created: false,
    };
  }

  const billingCfg = await getBillingConfig();
  const pkgDetails = subscriber.packageId ? await getPackageDetails(subscriber.packageId) : null;
  const packageName = pkgDetails?.name || subscriber.packageName || 'Internet Plan';
  const resolvedInputAmount = amount !== undefined && amount !== null ? amount : baseAmount;
  const packagePriceCents =
    resolvedInputAmount !== undefined && resolvedInputAmount !== null
      ? utils.toCents(resolvedInputAmount)
      : pkgDetails
        ? pkgDetails.priceCents
        : 0;

  const resolvedDueDate = dueDate || dates.dueDateForPeriod(period, billingCfg.dueDay);
  const effectiveSignupDate = signupDate || subscriber.signupDate || subscriber.joinDate || subscriber.subscriptionStartedAt || null;

  // Requirement 4a & 4b: Charge installation ($8.99) + tax ($0.99) + package price
  // ONLY on a new subscription (any day 1st–31st of the signup month), no proration.
  // From the following month onward, charge only the monthly package price.
  const firstMonth = await isSubscriberFirstBill({
    subscriberId: subscriber.id,
    period,
    signupDate: effectiveSignupDate,
    explicitIsNewSubscription: isNewSubscription,
  });

  const installationFeeCents = firstMonth ? billingCfg.installationFeeCents : 0;
  const taxFeeCents = firstMonth ? billingCfg.taxFeeCents : 0;

  // Requirement 4c: Check prior unpaid invoices for this subscriber from earlier periods.
  // - Carry unpaid amount forward into the next month's bill.
  // - Add a 2% late fee (calculated on the selected package plan's price) for each
  //   missed month that has NOT already had a late fee applied.
  const priorUnpaidRows = await db.queryAll(
    `SELECT *
       FROM invoices
      WHERE subscriber_id = $1
        AND id <> $2
        AND status = 'unpaid'
        AND COALESCE(raw_data->>'period', '') < $3
      ORDER BY COALESCE(raw_data->>'period', due_date, '') ASC, created_at ASC`,
    [subscriber.id, invoiceId, period],
  );

  let carriedOverCents = 0;
  let lateFeeCents = 0;
  const carriedInvoiceIds = [];
  const carriedPeriods = [];
  const lateFeeInvoiceIds = [];
  const lateFeePeriods = [];

  for (const prevInv of priorUnpaidRows) {
    const prevRaw = prevInv.raw_data || {};
    // Only carry forward if this invoice hasn't already been carried into another invoice
    if (!prevRaw.carriedIntoInvoiceId) {
      const prevAmountCents = utils.toCents(prevInv.amount);
      if (prevAmountCents > 0) {
        carriedOverCents += prevAmountCents;
        carriedInvoiceIds.push(prevInv.id);
        carriedPeriods.push(prevRaw.period || prevInv.id);
      }
    }

    // Apply configured late fee only if a late fee has NOT already been applied for this missed month
    const alreadyApplied = Boolean(prevInv.late_fee_applied || prevRaw.lateFeeApplied);
    if (!alreadyApplied) {
      const feeForMissedMonth = calculateLateFeeCents(packagePriceCents, billingCfg);
      if (feeForMissedMonth > 0) {
        lateFeeCents += feeForMissedMonth;
        lateFeeInvoiceIds.push(prevInv.id);
        lateFeePeriods.push(prevRaw.period || prevInv.id);
      }
    }
  }

  // Build itemized invoice lines (in integer cents & decimal dollars)
  const lines = [
    {
      code: 'subscription',
      type: 'subscription',
      description: `${packageName} — Monthly Subscription (${period})`,
      amountCents: packagePriceCents,
      amount: utils.fromCents(packagePriceCents),
    },
  ];

  if (installationFeeCents > 0) {
    lines.push({
      code: 'installation_fee',
      type: 'installation_fee',
      description: 'One-Time Installation Fee',
      amountCents: installationFeeCents,
      amount: utils.fromCents(installationFeeCents),
    });
  }

  if (taxFeeCents > 0) {
    lines.push({
      code: 'tax_fee',
      type: 'tax_fee',
      description: 'Tax & Regulatory Fee',
      amountCents: taxFeeCents,
      amount: utils.fromCents(taxFeeCents),
    });
  }

  if (carriedOverCents > 0) {
    lines.push({
      code: 'carried_forward',
      type: 'carried_over',
      description: `Carried-Over Unpaid Balance (${carriedPeriods.join(', ')})`,
      amountCents: carriedOverCents,
      amount: utils.fromCents(carriedOverCents),
      sourceInvoices: carriedInvoiceIds,
    });
  }

  if (lateFeeCents > 0) {
    lines.push({
      code: 'late_fee',
      type: 'late_fee',
      description: `Late Fee (${billingCfg.lateFeePercent}% on $${utils.fromCentsStr(packagePriceCents)} plan for ${lateFeePeriods.join(', ')})`,
      amountCents: lateFeeCents,
      amount: utils.fromCents(lateFeeCents),
      sourceInvoices: lateFeeInvoiceIds,
    });
  }

  const subtotalCents =
    packagePriceCents + installationFeeCents + taxFeeCents + carriedOverCents + lateFeeCents;

  // Referral credits are consumed at invoice generation time in integer cents
  const creditBalanceCents = utils.toCents(subscriber.creditBalance || 0);
  const creditUsedCents = Math.min(Math.max(0, creditBalanceCents), subtotalCents);
  const invoiceAmountCents = subtotalCents - creditUsedCents;

  if (creditUsedCents > 0) {
    lines.push({
      code: 'referral_credit',
      description: 'Referral Credit Applied',
      amountCents: -creditUsedCents,
      amount: -utils.fromCents(creditUsedCents),
    });
  }

  const invoiceAmount = utils.fromCents(invoiceAmountCents);
  const subscriptionAmount = utils.fromCents(packagePriceCents);
  const installationFee = utils.fromCents(installationFeeCents);
  const taxFee = utils.fromCents(taxFeeCents);
  const carriedOverAmount = utils.fromCents(carriedOverCents);
  const lateFee = utils.fromCents(lateFeeCents);
  const creditUsed = utils.fromCents(creditUsedCents);

  const rawData = {
    period,
    invoiceNumber: invoiceId,
    subscriberId: subscriber.id,
    subscriberName: subscriber.name,
    subscriberPhone: subscriber.phone,
    packageId: subscriber.packageId,
    packageName,
    amount: invoiceAmount,
    amountCents: invoiceAmountCents,
    subscriptionAmount,
    subscriptionAmountCents: packagePriceCents,
    installationFee,
    installationFeeCents,
    taxFee,
    taxFeeCents,
    carriedOverAmount,
    carriedOverCents,
    carriedFromInvoices: carriedInvoiceIds,
    carriedFromPeriods: carriedPeriods,
    lateFee,
    lateFeeCents,
    lateFeePercent: billingCfg.lateFeePercent,
    lateFeeFromInvoices: lateFeeInvoiceIds,
    lateFeeFromPeriods: lateFeePeriods,
    lateFeeReason:
      lateFeeCents > 0
        ? `${billingCfg.lateFeePercent}% late fee on package price for missed period(s): ${lateFeePeriods.join(', ')}`
        : null,
    isFirstMonthBill: firstMonth,
    signupDate: signupDate ? new Date(signupDate).toISOString() : null,
    lines,
    currency: billingCfg.currency,
    dueDate: resolvedDueDate,
    status: 'unpaid',
    generatedBy: 'billing-engine',
    generatedAt: utils.nowIso(),
    creditUsed,
    creditUsedCents,
    creditBalanceBefore: utils.fromCents(creditBalanceCents),
    mikrotikUsername: subscriber.pppoeUsername || '',
  };

  // Execute the invoice insert, carry-forward status updates, credit deduction,
  // and charge event logging inside a single database transaction.
  const txResult = await db.transaction(async (client) => {
    const check = await client.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoiceId]);
    if (check.rows.length > 0) {
      return { invoice: check.rows[0], created: false };
    }

    const ins = await client.query(
      `INSERT INTO invoices
         (id, subscriber_id, amount, installation_fee, tax_fee, late_fee, carried_over_amount, late_fee_applied, status, due_date, raw_data, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, 'unpaid', $8, $9, NOW(), NOW())
       RETURNING *`,
      [
        invoiceId,
        subscriber.id,
        invoiceAmount,
        installationFee,
        taxFee,
        lateFee,
        carriedOverAmount,
        resolvedDueDate,
        JSON.stringify(rawData),
      ],
    );
    const createdInv = ins.rows[0];

    // Mark prior unpaid invoices whose balances were carried forward and/or had late fees applied
    for (const prevInv of priorUnpaidRows) {
      const wasCarried = carriedInvoiceIds.includes(prevInv.id);
      const hadLateFee = lateFeeInvoiceIds.includes(prevInv.id);
      if (wasCarried || hadLateFee) {
        const patch = {
          ...(prevInv.raw_data || {}),
          lateFeeApplied: Boolean(prevInv.late_fee_applied || prevInv.raw_data?.lateFeeApplied || hadLateFee),
          ...(hadLateFee ? { lateFeeAppliedInInvoice: invoiceId, lateFeeAppliedInPeriod: period } : {}),
          ...(wasCarried
            ? {
                status: 'carried_forward',
                carriedIntoInvoiceId: invoiceId,
                carriedIntoPeriod: period,
                carriedForwardAt: utils.nowIso(),
              }
            : {}),
        };
        await client.query(
          `UPDATE invoices
              SET status = CASE WHEN $2::boolean THEN 'carried_forward' ELSE status END,
                  late_fee_applied = CASE WHEN $3::boolean THEN TRUE ELSE late_fee_applied END,
                  raw_data = $4::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [prevInv.id, wasCarried, hadLateFee, JSON.stringify(patch)],
        );
      }
    }

    // Deduct referral credit if used
    if (creditUsedCents > 0) {
      const subRes = await client.query('SELECT raw_data FROM subscribers WHERE id = $1 FOR UPDATE', [
        subscriber.id,
      ]);
      const currentCreditCents = utils.toCents((((subRes.rows[0] || {}).raw_data || {})).credit_balance || 0);
      const nextCredit = utils.fromCents(Math.max(0, currentCreditCents - creditUsedCents));
      await client.query(
        `UPDATE subscribers
            SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('credit_balance', $2::numeric),
                updated_at = NOW()
          WHERE id = $1`,
        [subscriber.id, nextCredit],
      );
      await client.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
         VALUES ($1, $2, 'referral_credit_applied', $3, $4, $5)`,
        [
          subscriber.id,
          invoiceId,
          creditUsed,
          `Referral credit of $${utils.fromCentsStr(creditUsedCents)} applied`,
          JSON.stringify({ creditUsedCents }),
        ],
      );
    }

    // Log every charge item in billing_events (Requirement 4d)
    await client.query(
      `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
       VALUES ($1, $2, 'invoice_generated', $3, $4, $5)`,
      [
        subscriber.id,
        invoiceId,
        invoiceAmount,
        `Invoice ${invoiceId} generated for ${period} ($${utils.fromCentsStr(invoiceAmountCents)})`,
        JSON.stringify({ period, lines }),
      ],
    );

    if (installationFeeCents > 0) {
      await client.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
         VALUES ($1, $2, 'installation_fee_charged', $3, $4, $5)`,
        [
          subscriber.id,
          invoiceId,
          installationFee,
          `One-time installation fee of $${utils.fromCentsStr(installationFeeCents)} charged for ${period}`,
          JSON.stringify({ period, installationFeeCents }),
        ],
      );
    }

    if (taxFeeCents > 0) {
      await client.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
         VALUES ($1, $2, 'tax_fee_charged', $3, $4, $5)`,
        [
          subscriber.id,
          invoiceId,
          taxFee,
          `One-time tax fee of $${utils.fromCentsStr(taxFeeCents)} charged for ${period}`,
          JSON.stringify({ period, taxFeeCents }),
        ],
      );
    }

    if (carriedOverCents > 0) {
      await client.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
         VALUES ($1, $2, 'balance_carried_forward', $3, $4, $5)`,
        [
          subscriber.id,
          invoiceId,
          carriedOverAmount,
          `Unpaid balance of $${utils.fromCentsStr(carriedOverCents)} carried forward from ${carriedPeriods.join(', ')}`,
          JSON.stringify({ carriedInvoiceIds, carriedPeriods, carriedOverCents }),
        ],
      );
    }

    if (lateFeeCents > 0) {
      await client.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message, raw_data)
         VALUES ($1, $2, 'late_fee_applied', $3, $4, $5)`,
        [
          subscriber.id,
          invoiceId,
          lateFee,
          `${billingCfg.lateFeePercent}% late fee ($${utils.fromCentsStr(lateFeeCents)}) applied for missed period(s): ${lateFeePeriods.join(', ')}`,
          JSON.stringify({ lateFeeInvoiceIds, lateFeePeriods, lateFeeCents, lateFeePercent: billingCfg.lateFeePercent }),
        ],
      );
    }

    await client.query(
      `UPDATE subscriber_billing SET last_invoice_id = $2, updated_at = NOW() WHERE subscriber_id = $1`,
      [subscriber.id, invoiceId],
    );

    return {
      invoice: {
        ...createdInv,
        installationFee,
        taxFee,
        lateFee,
        carriedOverAmount,
        dueDate: resolvedDueDate,
        lines,
      },
      created: true,
    };
  });

  // Trigger real-time notifications when a new invoice is generated
  if (txResult.created) {
    await notifications.notifySubscriber(subscriber.id, {
      type: 'invoice_generated',
      title: `New Invoice Generated (${period})`,
      message: `Your invoice ${invoiceId} for $${utils.fromCentsStr(invoiceAmountCents)} is ready. Due date: ${resolvedDueDate}.`,
      link: '/dashboard/orders',
      rawData: { invoiceId, period, amount: invoiceAmount },
    });

    if (lateFeeCents > 0) {
      await notifications.notifySubscriber(subscriber.id, {
        type: 'late_fee_applied',
        title: 'Late Payment Fee Applied',
        message: `A ${billingCfg.lateFeePercent}% late fee ($${utils.fromCentsStr(lateFeeCents)}) and carried-over balance ($${utils.fromCentsStr(carriedOverCents)}) were added to invoice ${invoiceId}.`,
        link: '/dashboard/orders',
        rawData: { invoiceId, period, lateFee, carriedOverAmount },
      });
    }
  }

  return txResult;
}

/**
 * Convenience helper for generating the initial signup invoice on any day (1st–31st)
 * of the signup month. Charges: packagePrice + $8.99 installation + $0.99 tax.
 */
async function generateSubscriptionSignupInvoice({ subscriber, signupDate = new Date(), packagePrice }) {
  const dateObj = signupDate instanceof Date ? signupDate : new Date(signupDate);
  const period = dateObj.toISOString().slice(0, 7);
  const billingCfg = await getBillingConfig();
  const dueDate = dates.dueDateForPeriod(period, billingCfg.dueDay);

  await ensureBillingProfile(subscriber, packagePrice, dateObj);

  return generateInvoice({
    subscriber,
    period,
    amount: packagePrice,
    dueDate,
    isNewSubscription: true,
    signupDate: dateObj,
  });
}

const CYCLE_LOCK_KEY = 739_215_011;

/**
 * Run the monthly billing cycle.
 */
async function runMonthlyCycle({ period = dates.currentPeriodKey(), dryRun = false } = {}) {
  const cycleId = `CYCLE-${period.replace('-', '')}`;
  const startedAt = new Date();

  logger.info('billing cycle started', { period, dryRun });

  let lockClient = null;
  if (!dryRun) {
    lockClient = await db.getPool().connect();
    const lock = await lockClient.query('SELECT pg_try_advisory_lock($1) AS locked', [
      CYCLE_LOCK_KEY,
    ]);

    if (!lock.rows[0].locked) {
      lockClient.release();
      lockClient = null;
      logger.info('billing cycle skipped — another cycle is already running', { period });
      return {
        cycleId,
        period,
        dryRun,
        skipped: [],
        reason: 'another_cycle_is_running',
        invoiceCount: 0,
        createdCount: 0,
        totalAmount: 0,
        failures: [],
        dueDate: '',
      };
    }
  }

  try {
    return await executeCycle({ period, dryRun, cycleId, startedAt });
  } finally {
    if (lockClient) {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [CYCLE_LOCK_KEY]).catch(() => {});
      lockClient.release();
    }
  }
}

/**
 * The body of the monthly billing cycle.
 */
async function executeCycle({ period, dryRun, cycleId, startedAt }) {
  if (!dryRun) {
    await db.query(
      `INSERT INTO billing_cycles (id, period, status, started_at)
       VALUES ($1, $2, 'running', NOW())
       ON CONFLICT (id) DO UPDATE SET status = 'running', started_at = NOW()`,
      [cycleId, period],
    );
  }

  const billingCfg = await getBillingConfig();
  const subscribersResult = await db.query(
    `SELECT s.*, p.name AS package_name_joined
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
      WHERE s.status IN ('active', 'pending')
      ORDER BY s.id`,
  );

  const dueDate = dates.dueDateForPeriod(period, billingCfg.dueDay);
  let invoiceCount = 0;
  let createdCount = 0;
  let totalAmountCents = 0;
  const failures = [];
  const skipped = [];

  for (const row of subscribersResult.rows) {
    const subscriber = readSubscriber(row);
    if (!subscriber.packageId) {
      skipped.push({ subscriberId: subscriber.id, reason: 'no_package_assigned' });
      continue;
    }

    const pkg = await getPackageDetails(subscriber.packageId);
    if (!pkg) {
      failures.push({ subscriberId: subscriber.id, reason: 'package_not_found' });
      continue;
    }
    if (pkg.priceCents === 0) {
      skipped.push({ subscriberId: subscriber.id, reason: 'zero_price_package' });
      continue;
    }

    if (dryRun) {
      const priorUnpaid = await db.queryAll(
        `SELECT * FROM invoices
          WHERE subscriber_id = $1 AND status = 'unpaid' AND COALESCE(raw_data->>'period', '') < $2`,
        [subscriber.id, period],
      );
      let carriedCents = 0;
      let lateCents = 0;
      for (const pInv of priorUnpaid) {
        if (!pInv.raw_data?.carriedIntoInvoiceId) {
          carriedCents += utils.toCents(pInv.amount);
        }
        if (!pInv.late_fee_applied && !pInv.raw_data?.lateFeeApplied) {
          lateCents += calculateLateFeeCents(pkg.priceCents, billingCfg.lateFeePercent);
        }
      }
      const firstMonth = await isSubscriberFirstBill({ subscriberId: subscriber.id, period });
      const installCents = firstMonth ? billingCfg.installationFeeCents : 0;
      const taxCents = firstMonth ? billingCfg.taxFeeCents : 0;
      invoiceCount += 1;
      totalAmountCents += pkg.priceCents + installCents + taxCents + carriedCents + lateCents;
      continue;
    }

    try {
      await ensureBillingProfile(subscriber, pkg.price);
      const { invoice, created } = await generateInvoice({
        subscriber,
        period,
        amount: pkg.price,
        dueDate,
      });

      invoiceCount += 1;
      totalAmountCents += utils.toCents(invoice.amount || 0);

      if (created) {
        createdCount += 1;

        await sms.sendTemplate(
          'bill_reminder',
          {
            name: subscriber.name || 'Customer',
            phone: subscriber.phone,
            amount: utils.formatAmount(invoice.amount),
            dueDate,
            invoiceId: invoice.id,
          },
          { subscriberId: subscriber.id },
        );

        await db.query(
          `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
           VALUES ($1, $2, 'reminder_sent', $3, $4)`,
          [subscriber.id, invoice.id, Number(invoice.amount), `Reminder sent for ${period}`],
        );
      }
    } catch (error) {
      failures.push({ subscriberId: subscriber.id, reason: error.message });
      logger.error('billing cycle failed for subscriber', {
        subscriberId: subscriber.id,
        message: error.message,
      });
    }
  }

  const totalAmount = utils.fromCents(totalAmountCents);

  if (!dryRun) {
    await db.query(
      `UPDATE billing_cycles
         SET status = $2, invoice_count = $3, total_amount = $4, completed_at = NOW(), details = $5
       WHERE id = $1`,
      [
        cycleId,
        failures.length ? 'completed_with_errors' : 'completed',
        invoiceCount,
        totalAmount,
        JSON.stringify({ failures, skipped, createdCount, durationMs: Date.now() - startedAt.getTime() }),
      ],
    );
  }

  logger.info('billing cycle finished', {
    period,
    invoiceCount,
    createdCount,
    totalAmount,
    failures: failures.length,
    skipped: skipped.length,
  });

  return {
    cycleId,
    period,
    dryRun,
    invoiceCount,
    createdCount,
    totalAmount,
    failures,
    skipped,
    dueDate,
  };
}

/**
 * List invoices that are overdue and eligible for auto-suspension.
 */
async function findSuspendableInvoices() {
  const billingCfg = await getBillingConfig();
  const graceCutoff = dates.addDays(new Date(), -billingCfg.lateGraceDays);
  const result = await db.query(
    `SELECT * FROM invoices
      WHERE status = 'unpaid'
        AND due_date <> ''
        AND due_date::date < $1::date
      ORDER BY due_date::date ASC`,
    [graceCutoff],
  );
  return result.rows;
}

/**
 * Auto-suspend overdue subscribers: disable the MikroTik PPPoE secret and
 * notify the customer.
 */
async function autoSuspendOverdue() {
  const invoices = await findSuspendableInvoices();
  const results = [];

  const bySubscriber = new Map();
  for (const invoice of invoices) {
    if (!bySubscriber.has(invoice.subscriber_id)) {
      bySubscriber.set(invoice.subscriber_id, []);
    }
    bySubscriber.get(invoice.subscriber_id).push(invoice);
  }

  for (const [subscriberId, subscriberInvoices] of bySubscriber.entries()) {
    const subscriberRow = await db.queryOne('SELECT * FROM subscribers WHERE id = $1', [subscriberId]);
    if (!subscriberRow) continue;
    const subscriber = readSubscriber(subscriberRow);

    if (subscriber.status === 'suspended' || subscriber.status === 'disconnected') {
      for (const invoice of subscriberInvoices) {
        results.push({ subscriberId, invoiceId: invoice.id, status: 'already_suspended' });
      }
      continue;
    }

    const username = subscriber.pppoeUsername || subscriber.id;
    const routerResult = await mikrotik.suspendSubscriber({
      subscriberId: subscriber.id,
      username,
    });

    if (routerResult.success) {
      const totalAmountCents = subscriberInvoices.reduce(
        (sum, invoice) => sum + utils.toCents(invoice.amount || 0),
        0,
      );
      const totalAmount = utils.fromCents(totalAmountCents);
      const invoiceIds = subscriberInvoices.map((invoice) => invoice.id).join(', ');

      await db.transaction(async (client) => {
        await client.query(
          `UPDATE subscribers
              SET status = 'suspended',
                  raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"suspended"}'::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [subscriber.id],
        );
        await client.query(
          `UPDATE subscriber_billing SET status = 'suspended', updated_at = NOW() WHERE subscriber_id = $1`,
          [subscriber.id],
        );

        for (const invoice of subscriberInvoices) {
          await client.query(
            `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
             VALUES ($1, $2, 'auto_suspended', $3, $4)`,
            [
              subscriber.id,
              invoice.id,
              Number(invoice.amount),
              `Service auto-suspended for unpaid invoice (outstanding: ${invoiceIds})`,
            ],
          );
        }
      });

      await sms.sendTemplate(
        'service_suspended',
        {
          name: subscriber.name || 'Customer',
          phone: subscriber.phone,
          amount: utils.formatAmount(totalAmount),
          invoiceId: invoiceIds,
        },
        { subscriberId: subscriber.id },
      );
    }

    for (const invoice of subscriberInvoices) {
      results.push({
        subscriberId: subscriber.id,
        invoiceId: invoice.id,
        status: routerResult.success ? 'suspended' : 'router_error',
        error: routerResult.error,
      });
    }
  }

  return { processed: results.length, results };
}

/**
 * Reconcile a settled payment: mark the invoice paid (plus any carried-forward
 * source invoices included in its balance), restore service, log events, and
 * trigger notifications.
 */
async function applyPayment({ invoiceId, transactionId, gateway, amount, raw = {} }) {
  const invoice = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invoice) {
    const error = new Error(`Invoice not found: ${invoiceId}`);
    error.code = 'INVOICE_NOT_FOUND';
    throw error;
  }

  if (invoice.status === 'paid') {
    return { invoice, alreadyPaid: true };
  }

  const expectedCents = utils.toCents(invoice.amount || 0);
  const settledCents = amount !== undefined && amount !== null ? utils.toCents(amount) : expectedCents;
  const settledAmount = utils.fromCents(settledCents);

  if (expectedCents > 0 && settledCents + 1 < expectedCents) {
    const error = new Error(
      `The settled amount ($${utils.fromCentsStr(settledCents)}) does not cover the invoice ($${utils.fromCentsStr(expectedCents)})`,
    );
    error.code = 'AMOUNT_MISMATCH';
    throw error;
  }

  const paidAt = utils.nowIso();

  const updateRes = await db.query(
    `UPDATE invoices
        SET status = 'paid',
            updated_at = NOW(),
            raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb
      WHERE id = $1 AND status != 'paid'
      RETURNING id`,
    [
      invoiceId,
      JSON.stringify({
        status: 'paid',
        paidAt,
        paidVia: gateway,
        transactionId,
        paidAmount: settledAmount,
      }),
    ],
  );

  if (!updateRes.rows || updateRes.rows.length === 0) {
    const currentInv = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    return { invoice: currentInv, alreadyPaid: true };
  }

  // Also settle any prior carried_forward invoices that were rolled into this invoice chain
  await db.query(
    `UPDATE invoices
        SET status = 'paid',
            updated_at = NOW(),
            raw_data = COALESCE(raw_data, '{}'::jsonb) || $2::jsonb
      WHERE subscriber_id = $1
        AND status = 'carried_forward'
        AND COALESCE(raw_data->>'period', '') <= COALESCE($3, '')`,
    [
      invoice.subscriber_id,
      JSON.stringify({
        status: 'paid',
        paidAt,
        paidVia: gateway,
        settledByInvoiceId: invoiceId,
        transactionId,
      }),
      invoice.raw_data?.period || '',
    ],
  );

  const subscriberRow = await db.queryOne(
    `SELECT s.*, p.name AS package_name_joined
       FROM subscribers s
       LEFT JOIN packages p ON p.id = s.package_id
      WHERE s.id = $1`,
    [invoice.subscriber_id],
  );
  const subscriber = subscriberRow ? readSubscriber(subscriberRow) : null;

  if (subscriber) {
    const isFirstPurchase = subscriber.status === 'registered';

    const outstanding = await db.queryOne(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS total
         FROM invoices
        WHERE subscriber_id = $1 AND status = 'unpaid'`,
      [subscriber.id],
    );
    const hasOutstanding = Number(outstanding?.count || 0) > 0;

    if (!hasOutstanding && !isFirstPurchase) {
      const username = subscriber.pppoeUsername || subscriber.id;
      const routerResult = await mikrotik.restoreSubscriber({
        subscriberId: subscriber.id,
        username,
      });

      if (routerResult.success && subscriber.status !== 'active') {
        await db.transaction(async (client) => {
          await client.query(
            `UPDATE subscribers
                SET status = 'active',
                    raw_data = COALESCE(raw_data, '{}'::jsonb) || '{"status":"active"}'::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [subscriber.id],
          );
          await client.query(
            `UPDATE subscriber_billing SET status = 'active', updated_at = NOW() WHERE subscriber_id = $1`,
            [subscriber.id],
          );
          await client.query(
            `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
             VALUES ($1, $2, 'service_restored', $3, $4)`,
            [subscriber.id, invoiceId, settledAmount, 'Service restored after payment'],
          );
        });

        await sms.sendTemplate(
          'service_restored',
          {
            name: subscriber.name || 'Customer',
            phone: subscriber.phone,
            amount: utils.formatAmount(settledAmount),
            invoiceId,
          },
          { subscriberId: subscriber.id },
        );
      }
    } else if (hasOutstanding) {
      await db.query(
        `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
         VALUES ($1, $2, 'payment_received_outstanding', $3, $4)`,
        [
          subscriber.id,
          invoiceId,
          settledAmount,
          `Payment received, but ${outstanding.count} invoice(s) worth ${utils.formatAmount(outstanding.total)} are still unpaid — the service stays suspended`,
        ],
      );
    }

    await sms.sendTemplate(
      'payment_success',
      {
        name: subscriber.name || 'Customer',
        phone: subscriber.phone,
        amount: utils.formatAmount(settledAmount),
        invoiceId,
      },
      { subscriberId: subscriber.id },
    );

    await notifications.notifySubscriber(subscriber.id, {
      type: 'payment_received',
      title: 'Payment Received',
      message: `Your payment of $${utils.fromCentsStr(settledCents)} for invoice ${invoiceId} via ${String(gateway).toUpperCase()} has been confirmed (Ref: ${transactionId}).`,
      link: '/dashboard/orders',
      rawData: { invoiceId, transactionId, gateway, amount: settledAmount },
    });

    // Advance subscriber's dueDate and nextBillingDate to next monthly cycle (Requirement 7)
    try {
      const billingPeriod = invoice.raw_data?.period || dates.currentPeriodKey();
      const [pYear, pMonth] = billingPeriod.split('-').map(Number);
      const nextCycleDate = new Date(Date.UTC(pYear, pMonth, 1));
      const nextCyclePeriod = `${nextCycleDate.getUTCFullYear()}-${String(nextCycleDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const activeBillingCfg = await getBillingConfig();
      const nextCycleDueDate = dates.dueDateForPeriod(nextCyclePeriod, activeBillingCfg.dueDay);

      await db.query(
        `UPDATE subscribers
            SET raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('dueDate', $2::text, 'nextBillingDate', $2::text),
                updated_at = NOW()
          WHERE id = $1`,
        [subscriber.id, nextCycleDueDate],
      );
    } catch (dueErr) {
      logger.warn('Failed to advance subscriber dueDate after payment:', { error: dueErr.message });
    }
  }

  await db.query(
    `INSERT INTO billing_events (subscriber_id, invoice_id, event, amount, message)
     VALUES ($1, $2, 'payment_received', $3, $4)`,
    [invoice.subscriber_id, invoiceId, settledAmount, `Payment via ${gateway} (${transactionId})`],
  );

  const updated = await db.queryOne('SELECT * FROM invoices WHERE id = $1', [invoiceId]);

  if (subscriber) {
    try {
      await referrals.onPaymentSettled({ subscriberId: subscriber.id, invoiceId });
    } catch (error) {
      logger.error('referral qualification failed', {
        subscriberId: subscriber.id,
        invoiceId,
        error: error.message,
      });
    }
  }

  return { invoice: updated, alreadyPaid: false };
}

/**
 * Billing overview for the admin dashboard.
 */
async function getOverview() {
  const totals = await db.queryOne(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'unpaid')                          AS unpaid_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'unpaid'), 0)           AS unpaid_amount,
       COUNT(*) FILTER (WHERE status = 'paid')                            AS paid_count,
       COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0)             AS paid_amount,
       COALESCE(SUM(installation_fee), 0)                                  AS total_installation_fees,
       COALESCE(SUM(tax_fee), 0)                                           AS total_tax_fees,
       COALESCE(SUM(late_fee), 0)                                          AS total_late_fees,
       COALESCE(SUM(amount) FILTER (WHERE status <> 'carried_forward'), 0) AS total_amount,
       COUNT(*)                                                             AS total_count
     FROM invoices`,
  );

  const cycles = await db.query(
    'SELECT * FROM billing_cycles ORDER BY started_at DESC LIMIT 12',
  );

  const overdue = await db.query(
    `SELECT COUNT(*) AS count FROM invoices
      WHERE status = 'unpaid' AND due_date <> '' AND due_date::date < CURRENT_DATE`,
  );

  const recentEvents = await db.query(
    'SELECT * FROM billing_events ORDER BY created_at DESC LIMIT 20',
  );

  return {
    totals,
    cycles: cycles.rows,
    overdueCount: Number(overdue.rows[0]?.count || 0),
    recentEvents: recentEvents.rows,
  };
}

module.exports = {
  runMonthlyCycle,
  autoSuspendOverdue,
  applyPayment,
  getOverview,
  getBillingConfig,
  getFeeConfig: getBillingConfig,
  calculateLateFeeCents,
  calculateQuote,
  formatPackageWithSpeed,
  formatPeriodMonthYear,
  ensureBillingProfile,
  generateInvoice,
  generateSubscriptionSignupInvoice,
  readSubscriber,
};
