'use strict';

/**
 * Date helpers that work in the configured billing timezone.
 *
 * The platform bills in Asia/Dhaka. JavaScript's `toISOString()` converts to
 * UTC, which shifts the calendar date by six hours and makes the monthly
 * cycle bill the wrong month. Every calendar date therefore goes through this
 * module, which formats the date in the billing timezone explicitly.
 */

const config = require('../config');

/**
 * Format a date as YYYY-MM-DD in the billing timezone.
 */
function formatDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.billing.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * The billing period key (YYYY-MM) of a date in the billing timezone.
 */
function periodKey(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.billing.timezone,
    year: 'numeric',
    month: '2-digit',
  });
  const [year, month] = formatter.format(date).split('-');
  return `${year}-${month}`;
}

/**
 * The current period key.
 */
function currentPeriodKey() {
  return periodKey(new Date());
}

/**
 * Add a number of calendar days in the billing timezone.
 *
 * The date is parsed as a calendar date, the days are added on the calendar
 * and the result is formatted again in the same timezone.
 */
function addDays(date, days) {
  const base = formatDate(date);
  const [year, month, day] = base.split('-').map(Number);

  // Use UTC arithmetic on the calendar parts — it has no timezone of its own,
  // so the result is an exact calendar day.
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const nextYear = shifted.getUTCFullYear();
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * The last day of the given period (YYYY-MM).
 */
function endOfPeriod(periodKeyValue) {
  const [year, month] = periodKeyValue.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * The day of the month (1-31) in the billing timezone.
 */
function dayOfMonth(date = new Date()) {
  return Number(formatDate(date).split('-')[2]);
}

module.exports = {
  formatDate,
  periodKey,
  currentPeriodKey,
  addDays,
  endOfPeriod,
  dayOfMonth,
};
