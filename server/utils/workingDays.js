"use strict";

/**
 * Edit-window rule for Production Entries: an entry stays editable for up
 * to 2 working days after its date. The working week excludes whatever
 * day(s) are configured as "weekly off" (server/models/CompanySettings.js
 * — Tuesday by default, editable from Holiday Master). Company holidays
 * (server/models/CompanyHoliday.js) don't count either, for exactly the
 * same reason: buildHolidaySet/isHoliday below just make a holiday another
 * day isWorkingDay() says no to, so the 2-working-day window naturally
 * extends one more calendar day past it — no separate "bypass" branch
 * needed.
 */

const DEFAULT_WEEKLY_OFF_DAYS = [2]; // Date#getDay(): 0=Sun..6=Sat — Tuesday, used if settings haven't loaded yet

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthDayKey(d) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Builds a lookup from a list of CompanyHoliday documents (or plain
 * {date, isRecurringYearly} objects) — build once per check, not per day,
 * since workingDaysElapsed calls isWorkingDay in a loop.
 */
function buildHolidaySet(holidays = []) {
  const exact = new Set();
  const recurring = new Set();
  for (const h of holidays) {
    const d = new Date(h.date);
    if (Number.isNaN(d.getTime())) continue;
    if (h.isRecurringYearly) recurring.add(monthDayKey(d));
    else exact.add(dateKey(d));
  }
  return { exact, recurring };
}

function isHoliday(date, holidaySet) {
  if (!holidaySet) return false;
  return holidaySet.exact.has(dateKey(date)) || holidaySet.recurring.has(monthDayKey(date));
}

function isWorkingDay(date, holidaySet, weeklyOffDays) {
  // Only fall back to the Tuesday default when the setting hasn't loaded at
  // all (null/undefined) — an explicit empty array is a valid "no weekly
  // off day" configuration and must not be silently overridden.
  const offDays = weeklyOffDays == null ? DEFAULT_WEEKLY_OFF_DAYS : weeklyOffDays;
  return !offDays.includes(date.getDay()) && !isHoliday(date, holidaySet);
}

/**
 * Counts working (non-weekly-off, non-holiday) calendar days strictly after
 * `entryDate`, up to and including `now`.
 */
function workingDaysElapsed(entryDate, now, holidaySet, weeklyOffDays) {
  const cursor = new Date(entryDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  let count = 0;
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDay(cursor, holidaySet, weeklyOffDays)) count++;
  }
  return count;
}

function isEntryEditable(entryDate, now = new Date(), maxWorkingDays = 2, holidaySet, weeklyOffDays) {
  return workingDaysElapsed(entryDate, now, holidaySet, weeklyOffDays) <= maxWorkingDays;
}

module.exports = {
  DEFAULT_WEEKLY_OFF_DAYS,
  isWorkingDay,
  workingDaysElapsed,
  isEntryEditable,
  buildHolidaySet,
  isHoliday,
};
