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

/**
 * The due date of a billing period.
 *
 * The day is clamped to the length of the month, so a due day of 31 gives
 * 2026-02-28 instead of the invalid 2026-02-31.
 *
 * @param {string} period  Period key, YYYY-MM.
 * @param {number} dueDay  Day of the month, 1-31.
 * @returns {string} YYYY-MM-DD
 */
function dueDateForPeriod(period, dueDay) {
  const [year, month] = String(period).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(Math.max(Number(dueDay || 1), 1), lastDay);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The period keys between two periods, inclusive.
 *
 * Used by the catch-up logic to bill every month that was missed instead of
 * only the current one.
 */
function periodRange(fromPeriod, toPeriod) {
  const [fromYear, fromMonth] = String(fromPeriod).split('-').map(Number);
  const [toYear, toMonth] = String(toPeriod).split('-').map(Number);
  if (!fromYear || !fromMonth || !toYear || !toMonth) return [];

  const periods = [];
  let year = fromYear;
  let month = fromMonth;
  // A hard limit keeps a bad input from looping forever.
  while ((year < toYear || (year === toYear && month <= toMonth)) && periods.length < 240) {
    periods.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return periods;
}

module.exports = {
  formatDate,
  periodKey,
  currentPeriodKey,
  addDays,
  endOfPeriod,
  dayOfMonth,
  dueDateForPeriod,
  periodRange,
};
