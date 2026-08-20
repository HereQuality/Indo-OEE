/**
 * Client-side mirror of server/utils/workingDays.js — advisory only (greys
 * out the Edit button / drives the dev simulator). The server copy is what
 * actually enforces the 2-working-day edit window; this one must never be
 * trusted as the source of truth.
 *
 * Working week: Mon/Wed/Thu/Fri/Sat/Sun — Tuesday (day 2) is off.
 */

const OFF_DAY = 2; // Date#getDay(): 0=Sun..6=Sat, 2=Tuesday

export function isWorkingDay(date) {
  return date.getDay() !== OFF_DAY;
}

// Counts working (non-Tuesday) calendar days strictly after `entryDate`, up to and including `now`.
export function workingDaysElapsed(entryDate, now) {
  const cursor = new Date(entryDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  let count = 0;
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    if (isWorkingDay(cursor)) count++;
  }
  return count;
}

export function isEntryEditable(entryDate, now = new Date(), maxWorkingDays = 2) {
  return workingDaysElapsed(entryDate, now) <= maxWorkingDays;
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
