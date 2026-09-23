// utils/workingDays.js
// ──────────────────────
// Client-side copy of server/utils/workingDays.js — used only to preview
// an entry's lock state in the UI (grey out Edit/Delete, show a lock icon
// with a tooltip). The server runs the same math again with the real date
// when Save/Delete is actually submitted, so this copy being stale or
// spoofed (see the lock-testing widget on the Data Entry page) can never
// let a locked entry actually get edited or deleted — it can only make the
// UI show the wrong hint until the request comes back.

const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toMonthDay = (d) => `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseISODay = (s) => new Date(`${s}T00:00:00.000Z`);

const buildHolidaySets = (holidays) => {
  const exact = new Set();
  const recurring = new Set();
  for (const h of holidays || []) {
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

// The last "YYYY-MM-DD" an entry dated `entryDateISO` can still be edited
// or deleted — exactly `workingDaysAhead` working days after its own date.
export const getLockDeadline = (entryDateISO, weeklyOffDays, holidays, workingDaysAhead = 2) => {
  const holidaySets = buildHolidaySets(holidays);
  let d = parseISODay(entryDateISO);
  let counted = 0;
  while (counted < workingDaysAhead) {
    d = new Date(d.getTime() + 86400000);
    if (!isNonWorkingDay(d, weeklyOffDays, holidaySets)) counted += 1;
  }
  return toISO(d);
};

export const isEntryLocked = (entryDateISO, weeklyOffDays, holidays, asOfISO, workingDaysAhead = 2) =>
  (asOfISO || toISO(new Date())) > getLockDeadline(entryDateISO, weeklyOffDays, holidays, workingDaysAhead);

export const LOCK_WORKING_DAYS = 2;
