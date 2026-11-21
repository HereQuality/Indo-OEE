const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const CompanyHoliday = require("../models/CompanyHoliday");
const { isNonWorkingDay, buildHolidaySets, toISO } = require("./workingDays");

/**
 * utils/sheetDates.js
 * ────────────────────
 * Which dates a data entry sheet pages through (every *Sheet.controller.js
 * getSheet), newest first, PAGE_SIZE_DAYS a page:
 *
 *   • every date that has an entry in the range (as always), plus
 *   • every WORKING day in the range up to today — weekly offs and company
 *     holidays left out unless something was entered on them — so a day
 *     with nothing entered yet still shows up, with a "Not filled yet" row
 *     per machine (client utils/sheetPlaceholders.js, app sheet_model.dart):
 *     at midnight the new day appears on every sheet, and each machine's
 *     row turns into its entries as they're saved.
 *
 * With an Operator / Part filter on (`filtered`) only the dates with a match
 * are paged, as before — a filtered view is a search, not the day's roll call.
 *
 * `meta.dates` tells the client the page's dates, so it can draw the empty
 * ones; the days themselves are IST, like the entries' own Date.
 */
const DAY_MS = 86400000;

const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const parseIso = (iso) => new Date(`${iso}T00:00:00.000Z`);

// The working days from `from` to `to` (UTC-midnight Dates), as YYYY-MM-DD,
// no later than today (IST).
const workingDaysBetween = async (from, to) => {
  const [{ weeklyOffDays }, holidays] = await Promise.all([
    WeeklyOffSetting.findOne().lean().then((d) => d || { weeklyOffDays: [0] }),
    CompanyHoliday.find({ isActive: true }).lean(),
  ]);
  const sets = buildHolidaySets(holidays);
  const last = [toISO(to), todayIST()].sort()[0];
  const out = [];
  for (let d = new Date(from.getTime()); toISO(d) <= last; d = new Date(d.getTime() + DAY_MS)) {
    if (!isNonWorkingDay(d, weeklyOffDays, sets)) out.push(toISO(d));
  }
  return out;
};

// { page, totalPages, totalDays, dates: ["YYYY-MM-DD", …] (this page, newest
//   first), pageDates: the same as UTC-midnight Dates for a $in query }
const pageDatesFor = async ({ Model, from, to, dateFilterQuery, filtered, page, pageSize }) => {
  const withEntries = await Model.find(dateFilterQuery).distinct("date");
  const dates = new Set(withEntries.map((d) => d.toISOString().slice(0, 10)));
  if (!filtered) for (const iso of await workingDaysBetween(from, to)) dates.add(iso);
  const sorted = [...dates].sort().reverse();
  const totalDays = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalDays / pageSize));
  const current = Math.min(Math.max(1, parseInt(page, 10) || 1), totalPages);
  const pageIso = sorted.slice((current - 1) * pageSize, current * pageSize);
  return { page: current, totalPages, totalDays, dates: pageIso, pageDates: pageIso.map(parseIso) };
};

module.exports = { pageDatesFor, workingDaysBetween, todayIST };
