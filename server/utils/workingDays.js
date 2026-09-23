"use strict";
/**
 * utils/workingDays.js
 * ──────────────────────
 * "Working day" math shared by the production entry lock (see
 * controllers/productionSheet.controller.js) and, in its own client-side
 * copy (client/src/utils/workingDays.js), the entries table's lock icons.
 * Kept as two small independent copies rather than one shared package —
 * same approach already used for the OEE formulas — because the server
 * copy is the one that actually enforces the lock; the client's is only
 * ever a preview of what the server will do.
 *
 * A day is "working" unless it falls on a configured weekly-off weekday
 * (WeeklyOffSetting) or a specific holiday date (CompanyHoliday, either a
 * one-off or a "repeats every year" one matched on month/day only).
 */

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toMonthDay = (d) => `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// "YYYY-MM-DD" -> Date at UTC midnight. Entry dates and holiday dates are
// both compared this way so a timezone offset never shifts which calendar
// day a date lands on.
const parseISODay = (s) => new Date(`${s}T00:00:00.000Z`);

const buildHolidaySets = (holidays) => {
  const exact = new Set();
  const recurring = new Set();
  for (const h of holidays) {
    if (!h.isActive) continue;
    const d = new Date(h.date);
    if (Number.isNaN(d.getTime())) continue;
    if (h.isRecurringYearly) recurring.add(toMonthDay(d));
    else exact.add(toISO(d));
  }
  return { exact, recurring };
};

const isNonWorkingDay = (date, weeklyOffDays, holidaySets) =>
  weeklyOffDays.includes(date.getUTCDay()) || holidaySets.exact.has(toISO(date)) || holidaySets.recurring.has(toMonthDay(date));

/**
 * The last calendar date (inclusive, "YYYY-MM-DD") an entry dated
 * `entryDateISO` can still be edited or deleted — exactly `workingDaysAhead`
 * working days after its own date. The entry is locked from the day after
 * this one onward.
 */
const getLockDeadline = (entryDateISO, weeklyOffDays, holidays, workingDaysAhead = 2) => {
  const holidaySets = buildHolidaySets(holidays);
  let d = parseISODay(entryDateISO);
  let counted = 0;
  while (counted < workingDaysAhead) {
    d = new Date(d.getTime() + 86400000);
    if (!isNonWorkingDay(d, weeklyOffDays, holidaySets)) counted += 1;
  }
  return toISO(d);
};

// `asOfISO` defaults to the real current date — pass a different one only
// for a trusted internal check (never from client input), since this is
// what the server itself trusts to allow or block a write.
const isEntryLocked = (entryDateISO, weeklyOffDays, holidays, asOfISO = toISO(new Date()), workingDaysAhead = 2) =>
  asOfISO > getLockDeadline(entryDateISO, weeklyOffDays, holidays, workingDaysAhead);

module.exports = { getLockDeadline, isEntryLocked, isNonWorkingDay, buildHolidaySets, toISO };
