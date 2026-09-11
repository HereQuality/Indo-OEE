/**
 * Client-side mirror of server/utils/workingDays.js — advisory only (greys
 * out the Edit button / drives the dev simulator). The server copy is what
 * actually enforces the 2-working-day edit window; this one must never be
 * trusted as the source of truth.
 *
 * Working week excludes whatever day(s) are configured as "weekly off"
 * (Tuesday by default — see useCompanySettings / Holiday Master). Company
 * holidays are skipped the same way — see buildHolidaySet.
 */

export const DEFAULT_WEEKLY_OFF_DAYS = [2]; // Date#getDay(): 0=Sun..6=Sat — Tuesday, used if settings haven't loaded yet

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function monthDayKey(d) {
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Builds a lookup from a list of CompanyHoliday records (or plain
// {date, isRecurringYearly} objects) — build once (e.g. via useMemo), not
// per day, since workingDaysElapsed calls isWorkingDay in a loop.
export function buildHolidaySet(holidays = []) {
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

export function isWorkingDay(date, holidaySet, weeklyOffDays) {
  // Only fall back to the Tuesday default when the setting hasn't loaded at
  // all (null/undefined) — an explicit empty array is a valid "no weekly
  // off day" configuration and must not be silently overridden.
  const offDays = weeklyOffDays == null ? DEFAULT_WEEKLY_OFF_DAYS : weeklyOffDays;
  return !offDays.includes(date.getDay()) && !isHoliday(date, holidaySet);
}

// Counts working (non-weekly-off, non-holiday) calendar days strictly after `entryDate`, up to and including `now`.
export function workingDaysElapsed(entryDate, now, holidaySet, weeklyOffDays) {
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

export function isEntryEditable(entryDate, now = new Date(), maxWorkingDays = 2, holidaySet, weeklyOffDays) {
  return workingDaysElapsed(entryDate, now, holidaySet, weeklyOffDays) <= maxWorkingDays;
}

// Parses a "YYYY-MM-DD" (or ISO datetime) string into a local Date, avoiding
// the timezone-shift bug of `new Date(isoString)` — same convention already
// used by Dashboard.jsx and Components/Common/DatePicker.jsx.
export function parseLocalDate(dateStrOrDate) {
  if (dateStrOrDate instanceof Date) return dateStrOrDate;
  const datePart = String(dateStrOrDate).split("T")[0];
  const [y, m, d] = datePart.split("-").map(Number);
  return new Date(y, m - 1, d);
}
