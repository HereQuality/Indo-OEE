/**
 * utils/processDashboard.js
 * ────────────────────────────
 * The engine behind the process dashboards: the catalog of KPI tiles and
 * visuals a process can show (picked per process in Production > Processes),
 * the cross-filter model, and the aggregation every tile, chart and drill-down
 * reads from.
 *
 * Every figure comes from rowCalc/dayCalc in utils/productionSheet.js — the
 * same formulas the entry form uses — so the dashboard can never disagree
 * with the sheet. OEE is a per-machine-per-day figure, so it is averaged over
 * machine-day pairs, never over entries.
 */
import { STOPPAGE_FIELDS, dayCalc, displayDay, fmtNum, fmtPct, rowCalc } from "./productionSheet";

const n = (v) => (Number.isFinite(v) ? v : 0);
const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);

// ── Formats ────────────────────────────────────────────────────────────────
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
export const FORMATS = {
  qty: (v) => (Number.isFinite(v) ? (Math.abs(v) >= 100000 ? compact.format(v) : fmtNum(v)) : "—"),
  pct: (v) => fmtPct(v) || "—",
  hours: (v) => (Number.isFinite(v) ? `${fmtNum(v)} hr` : "—"),
  minutes: (v) => (Number.isFinite(v) ? `${fmtNum(v)} min` : "—"),
  days: (v) => (Number.isFinite(v) ? fmtNum(v) : "—"),
};
// Full-precision twin of FORMATS, for tooltips and tables.
export const formatExact = (format, v) => (format === "qty" ? (Number.isFinite(v) ? fmtNum(v) : "—") : FORMATS[format](v));

// ── Catalog: KPI tiles ─────────────────────────────────────────────────────
// `tone` picks the accent (ok / reject / downtime) — see chartTheme.js.
// `example` is a sample value, shown on the tile's preview in the Process Master.
export const STAT_CATALOG = [
  { key: "totalQty", label: "Total QTY", hint: "Actual quantity produced", format: "qty", example: "1.43M" },
  { key: "okQty", label: "OK QTY", hint: "Pieces that passed", format: "qty", tone: "ok", example: "269K" },
  { key: "rejectedQty", label: "Rejected QTY", hint: "Actual − OK", format: "qty", tone: "reject", example: "9,453" },
  { key: "okPct", label: "% OK Quantity", hint: "OK ÷ (OK + Rejected)", format: "pct", tone: "ok", example: "99.97%" },
  { key: "rejectionPct", label: "Rejection %", hint: "Rejected ÷ Actual", format: "pct", tone: "reject", example: "0.66%" },
  { key: "idealQty", label: "Ideal QTY", hint: "Shift time ÷ cycle time", format: "qty", example: "1.51M" },
  { key: "performance", label: "Actual vs Ideal", hint: "Actual ÷ Ideal quantity", format: "pct", example: "94.70%" },
  { key: "oeeLosses", label: "OEE Considering Losses", hint: "Averaged per machine-day", format: "pct", example: "96.42%" },
  { key: "oeeLunch", label: "OEE NOT Considering Losses, But Lunch", hint: "Averaged per machine-day", format: "pct", example: "91.10%" },
  // Key kept as oeeLunchCot: it is what a process's saved dashboard stores, so renaming it would drop the tile.
  { key: "oeeLunchCot", label: "OEE NOT Considering Losses, But Lunch & Setup Time", hint: "Averaged per machine-day", format: "pct", example: "93.85%" },
  { key: "effectiveHours", label: "Effective Machine Run Time", hint: "OK × cycle time", format: "hours", example: "7,281 hr" },
  { key: "shiftHours", label: "Machine Shift Time", hint: "Machine OFF − ON", format: "hours", example: "8,120 hr" },
  { key: "downtimeMin", label: "Total Downtime", hint: "All stoppage causes", format: "minutes", tone: "downtime", example: "5,160 min" },
];

// ── Catalog: graphs ────────────────────────────────────────────────────────
// `size` is the default width on the 12-column grid: sm 4 · md 6 · lg 8 · full 12.
// `measure` is the KPI the card's "Break down" button drills into. `preview`
// picks the thumbnail sketch and `tone` its colour (WidgetPreview.jsx).
export const CHART_CATALOG = [
  { key: "oeeTrend", measure: "oeeLosses", label: "OEE (over time)", hint: "The three OEE figures by date — by month on long ranges.", size: "lg", preview: "lines" },
  { key: "runTimeByOperator", measure: "effectiveHours", label: "Effective Machine Run Time (Hour) by Operator", hint: "Hours of effective run time each operator produced.", size: "sm", preview: "hbars", tone: "ok" },
  { key: "downtimeByMachine", measure: "downtimeMin", label: "B.D. Backup — Stoppage by MC No.", hint: "Minutes lost per machine: breakdown, setup, lunch/tea, other.", size: "md", preview: "stacked" },
  { key: "runTimeByMachine", measure: "effectiveHours", label: "Effective Machine Run Time (Hour) by MC No.", hint: "Each machine's share of effective run time.", size: "md", preview: "treemap" },
  { key: "unreportedByMachine", measure: "unreportedMin", label: "Unreported Time (Min) by MC No.", hint: "Minutes not accounted for — one small chart per machine.", size: "md", preview: "multiples" },
  { key: "okRejectedTrend", measure: "okQty", label: "OK vs Rejected QTY (over time)", hint: "Stacked — the full bar is the actual quantity.", size: "md", preview: "stackedTime" },
  { key: "oeeByMachine", measure: "oeeLosses", label: "OEE by MC No.", hint: "Considering losses — average of that machine's days.", size: "md", preview: "vbars", tone: "ok" },
  { key: "rejectByReason", measure: "rejectedQty", label: "Rejected QTY by Reason", hint: "Rejected quantity grouped by reject reason.", size: "md", preview: "hbars", tone: "reject" },
  { key: "okPctByOperator", measure: "okPct", label: "Operator v/s OK QTY %", hint: "OK ÷ Actual for each operator.", size: "md", preview: "hbars", tone: "ok" },
  { key: "outputByItem", measure: "okQty", label: "OK QTY by Part", hint: "Parts ranked by OK quantity.", size: "md", preview: "hbars", tone: "ok" },
  { key: "machineSummary", label: "MC No. Summary (table)", hint: "One row per machine — quantities, run time, downtime and OEE.", size: "full", preview: "table" },
];

export const DEFAULT_STATS = ["totalQty", "okQty", "rejectedQty", "okPct", "oeeLosses", "oeeLunch", "effectiveHours", "downtimeMin"];
export const DEFAULT_CHARTS = ["runTimeByOperator", "oeeTrend", "downtimeByMachine", "runTimeByMachine", "unreportedByMachine", "okRejectedTrend", "rejectByReason", "machineSummary"];

const byKey = (catalog) => Object.fromEntries(catalog.map((w) => [w.key, w]));
export const STATS_BY_KEY = byKey(STAT_CATALOG);
export const CHARTS_BY_KEY = byKey(CHART_CATALOG);

// A process's saved keys → catalog entries, dropping keys this build doesn't
// know. `undefined` (never configured) falls back to the defaults; an empty
// array is respected as "show none".
export const resolveWidgets = (saved, lookup, defaults) =>
  (Array.isArray(saved) ? saved : defaults).map((k) => lookup[k]).filter(Boolean);

// ── Stoppage groups (Breakdown & Stoppage by Machine) ──────────────────────
// Ten causes is more series than a stacked bar can carry, so they are folded
// into four fixed groups; Downtime by Cause keeps the full ten.
export const STOPPAGE_GROUPS = [
  { key: "breakdown", label: "Breakdown (Mech + Ele)", fields: ["bdMechMin", "bdEleMin"] },
  { key: "setup", label: "Setup", fields: ["setupMin"] },
  { key: "lunch", label: "Lunch / Tea", fields: ["lunchMin"] },
  { key: "other", label: "Other stoppages", fields: ["plannedDownMin", "noManPowerMin", "materialShiftingMin", "noMaterialMin", "noPowerMin", "otherMin"] },
];

export const causeLabel = (key) => (STOPPAGE_FIELDS.find((f) => f.key === key)?.label || key).replace(" (min)", "");

// ── Dimensions (what a row can be sliced / cross-filtered by) ──────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (yyyymm) => `${MONTHS[Number(yyyymm.slice(5, 7)) - 1]} ${yyyymm.slice(0, 4)}`;

export const DIMENSIONS = {
  machine: { label: "Machine", value: (r) => r.machine, text: (v, ctx) => ctx.machineName[v] || "—" },
  operator: { label: "Operator", value: (r) => r.operator || "", text: (v) => v || "(no operator)" },
  item: { label: "Part", value: (r) => r.itemName || "", text: (v) => v || "(no part)" },
  month: { label: "Month", value: (r) => r.date.slice(0, 7), text: (v) => monthLabel(v) },
  date: { label: "Date", value: (r) => r.date, text: (v) => displayDay(v) },
};
export const EMPTY_FILTERS = { machine: [], operator: [], item: [], month: [], date: [] };

// Sheet order for machines: ctx.machineOrder is {machineId: position} built
// from the Machine list, which the API returns in Sequence order (see
// server/utils/machineOrder.js). A machine not in it — deactivated since it
// made entries — ranks after every listed one, then by name, numbers compared
// as numbers. `keyOf` reads the machine id off whatever is being sorted
// (chart rows carry it as .key, filter options as .value).
export const compareMachines = (ctx, keyOf = (item) => item.key) => {
  const order = ctx?.machineOrder || {};
  const rank = (item) => order[keyOf(item)] ?? Infinity;
  const name = (item) => ctx?.machineName?.[keyOf(item)] || item.label || "";
  return (a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    return name(a).localeCompare(name(b), undefined, { numeric: true });
  };
};

export const hasFilters = (filters) => Object.values(filters).some((v) => v.length);

export const toggleFilter = (filters, dim, value) => {
  const cur = filters[dim] || [];
  return { ...filters, [dim]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
};

// `except` leaves one dimension unfiltered — the chart that owns a dimension
// keeps showing every mark (dimming the unselected) instead of collapsing to
// the selection, the way a Power BI visual does.
export const applyFilters = (rows, filters, except = null) => {
  const active = Object.entries(filters).filter(([dim, vals]) => dim !== except && vals.length);
  if (!active.length) return rows;
  const sets = active.map(([dim, vals]) => [DIMENSIONS[dim].value, new Set(vals)]);
  return rows.filter((r) => sets.every(([value, set]) => set.has(value(r))));
};

export const groupRows = (rows, dim) => {
  const value = DIMENSIONS[dim].value;
  const groups = new Map();
  for (const r of rows) {
    const k = value(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return groups;
};

// Day buckets read fine up to about two months; past that, trends roll up
// to months so the bars stay wide enough to hit.
export const timeBucket = (rows) => (new Set(rows.map((r) => r.date)).size > 62 ? "month" : "date");

// ── Aggregation ────────────────────────────────────────────────────────────
const calcCache = new WeakMap();
export const calcOf = (row) => {
  let c = calcCache.get(row);
  if (!c) {
    c = rowCalc(row);
    calcCache.set(row, c);
  }
  return c;
};

// Rejected pieces by reason for one row: the per-reason split when the entry
// has one, else the whole lot against its single reason (older entries).
const rejectSplit = (row, rejected) => {
  const split = Object.entries(row.rejectBreakdown || {}).filter(([, q]) => n(Number(q)) > 0);
  if (split.length) return split.map(([reason, q]) => [reason, Number(q)]);
  return [[row.rejectReason || "Not specified", rejected]];
};

export function summarize(rows) {
  const s = {
    totalQty: 0, okQty: 0, rejectedQty: 0, idealQty: 0,
    shiftHours: 0, effectiveHours: 0, plannedShiftHours: 0,
    downtimeMin: 0, unreportedMin: 0, unutilizedDays: 0, entries: rows.length,
  };
  const setupEff = [];
  const downtimeByCause = Object.fromEntries(STOPPAGE_FIELDS.map((f) => [f.key, 0]));
  const rejectByReason = {};
  const byMachineDay = new Map();

  for (const row of rows) {
    const c = calcOf(row);
    s.totalQty += n(c.actualQty);
    s.okQty += n(Number(row.okQty));
    s.rejectedQty += n(c.rejectedQty);
    s.idealQty += n(c.idealQty);
    s.shiftHours += n(c.shiftHours);
    s.effectiveHours += n(c.effectiveHours);
    s.plannedShiftHours += n(Number(row.plannedOperatorShiftHours));
    s.downtimeMin += n(c.totalStoppageMin);
    if (Number.isFinite(c.setupEfficiency)) setupEff.push(c.setupEfficiency);
    for (const f of STOPPAGE_FIELDS) downtimeByCause[f.key] += n(Number(row[f.key]));
    if (n(c.rejectedQty) > 0) {
      for (const [reason, q] of rejectSplit(row, c.rejectedQty)) rejectByReason[reason] = (rejectByReason[reason] || 0) + q;
    }
    const k = `${row.machine}|${row.date}`;
    if (!byMachineDay.has(k)) byMachineDay.set(k, []);
    byMachineDay.get(k).push(row);
  }

  // dayCalc hands back one result per row of the group (a rolling window
  // starting at that row), not one shared value for the whole day — so every
  // row's own figure is added in here, not the day's counted once.
  const oee = { oeeLosses: [], oeeLunch: [], oeeLunchCot: [] };
  for (const group of byMachineDay.values()) {
    for (const d of dayCalc(group)) {
      if (Number.isFinite(d.unreportedMin)) s.unreportedMin += d.unreportedMin;
      if (Number.isFinite(d.unutilized)) s.unutilizedDays += d.unutilized;
      for (const k of Object.keys(oee)) if (Number.isFinite(d[k])) oee[k].push(d[k]);
    }
  }

  return {
    ...s,
    okPct: s.totalQty > 0 ? s.okQty / s.totalQty : null,
    rejectionPct: s.totalQty > 0 ? s.rejectedQty / s.totalQty : null,
    performance: s.idealQty > 0 ? s.totalQty / s.idealQty : null,
    setupEfficiency: mean(setupEff),
    oeeLosses: mean(oee.oeeLosses),
    oeeLunch: mean(oee.oeeLunch),
    oeeLunchCot: mean(oee.oeeLunchCot),
    machineDays: byMachineDay.size,
    downtimeByCause,
    rejectByReason,
  };
}

// One summary per value of `dim`: [{ key, label, summary }].
export const summarizeBy = (rows, dim, ctx) =>
  [...groupRows(rows, dim)].map(([key, group]) => ({
    key,
    label: DIMENSIONS[dim].text(key, ctx),
    summary: summarize(group),
  }));

// ── Measures (what a drill-down breaks apart) ──────────────────────────────
// Every KPI tile is a measure; a stoppage cause or reject reason becomes one
// on the fly when its bar is clicked.
export const statMeasure = (stat) => ({ key: stat.key, label: stat.label, format: stat.format, get: (s) => s[stat.key] });
export const causeMeasure = (causeKey) => ({
  key: `cause:${causeKey}`,
  label: `${causeLabel(causeKey)} — downtime`,
  format: "minutes",
  get: (s) => s.downtimeByCause[causeKey] || 0,
});
export const reasonMeasure = (reason) => ({
  key: `reason:${reason}`,
  label: `Rejected — ${reason}`,
  format: "qty",
  get: (s) => s.rejectByReason[reason] || 0,
});

// ── Period (the date range the dashboard loads) ────────────────────────────
// Dates are "YYYY-MM-DD" strings throughout — the same form the API takes —
// and are always built from LOCAL calendar parts, never via toISOString(),
// which would shift the day for anyone east or west of UTC.
const pad = (v) => String(v).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseIsoDate = (s) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const daysAgo = (days) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
};
const lastDayOfMonth = (y, m) => new Date(y, m, 0).getDate(); // m is 1-based

export const monthRange = (yyyymm) => {
  const [y, m] = yyyymm.split("-").map(Number);
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}`];
};
export const yearRange = (year) => [`${year}-01-01`, `${year}-12-31`];

// Quick ranges offered under the calendar.
export const QUICK_RANGES = [
  { key: "today", label: "Today", range: () => [isoDate(new Date()), isoDate(new Date())] },
  { key: "last7", label: "Last 7 days", range: () => [isoDate(daysAgo(6)), isoDate(new Date())] },
  { key: "last30", label: "Last 30 days", range: () => [isoDate(daysAgo(29)), isoDate(new Date())] },
  { key: "last90", label: "Last 90 days", range: () => [isoDate(daysAgo(89)), isoDate(new Date())] },
  { key: "thisMonth", label: "This month", range: () => monthRange(isoDate(new Date()).slice(0, 7)) },
  {
    key: "lastMonth",
    label: "Last month",
    range: () => {
      const t = new Date();
      return monthRange(isoDate(new Date(t.getFullYear(), t.getMonth() - 1, 1)).slice(0, 7));
    },
  },
  { key: "thisYear", label: "This year", range: () => yearRange(new Date().getFullYear()) },
  { key: "lastYear", label: "Last year", range: () => yearRange(new Date().getFullYear() - 1) },
];
export const DEFAULT_RANGE_KEY = "thisMonth";
export const defaultRange = () => QUICK_RANGES.find((q) => q.key === DEFAULT_RANGE_KEY).range();

// The Data Entry sheet (unlike a dashboard) is where the actual records
// live — defaulting it to "this month" (or even "this year") hid a machine's
// earlier entries the moment the calendar rolled over, which read as data
// having vanished. It defaults to a rolling window ending today and going
// back one year — wide enough that real data doesn't look like it "vanished"
// across a month/year rollover, without pulling years of rows on every
// visit the way the old 5-year default did. The Filters panel's own Year/
// Date range tabs can still reach further back whenever that's actually
// wanted (up to MAX_RANGE_DAYS below). A dashboard's own default stays
// DEFAULT_RANGE_KEY/defaultRange above, unaffected.
const ENTRY_RANGE_DAYS = 366;
export const defaultEntryRange = () => [isoDate(daysAgo(ENTRY_RANGE_DAYS - 1)), isoDate(new Date())];

// The API accepts at most this many days in one request (server: MAX_RANGE_DAYS).
export const MAX_RANGE_DAYS = 366 * 5;
export const rangeDays = ([from, to]) => Math.round((parseIsoDate(to) - parseIsoDate(from)) / 86400000) + 1;

// How a range reads on the Filters button and chips: a whole year or month is
// named as one ("2025", "September 2026"); a quick range by its name; anything
// else as its two dates.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const describeRange = ([from, to]) => {
  if (!from || !to) return "";
  const [fy, fm] = from.split("-");
  if (from === `${fy}-01-01` && to === `${fy}-12-31`) return fy;
  const [mFrom, mTo] = monthRange(`${fy}-${fm}`);
  if (from === mFrom && to === mTo) return `${MONTH_NAMES[Number(fm) - 1]} ${fy}`;
  if (from === to) return displayDay(from);
  return `${displayDay(from)} to ${displayDay(to)}`;
};
export const quickRangeKey = (range) => QUICK_RANGES.find((q) => q.range().join() === range.join())?.key || null;

// Years the process has data for (newest first), from the API's `extent`;
// falls back to the current year so the Year tab is never empty.
export const yearsOfExtent = (extent) => {
  const thisYear = new Date().getFullYear();
  const first = extent ? Number(extent.from.slice(0, 4)) : thisYear;
  const last = Math.max(extent ? Number(extent.to.slice(0, 4)) : thisYear, thisYear);
  return Array.from({ length: last - first + 1 }, (_, i) => last - i);
};
export const MONTH_LABELS = MONTH_NAMES;
