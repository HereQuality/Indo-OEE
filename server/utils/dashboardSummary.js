const { SHEET_DAY, ownerFieldOf, dayOeeFor, entryParts } = require("./oeeMetrics");

/**
 * utils/dashboardSummary.js
 * ──────────────────────────
 * The Efficiency Report's figures for a period — what the summary mail and
 * the dashboard's PDF (utils/oeeReportPdf.js) show — from the same entries
 * the Production Dashboard loads (controllers/process.controller.js
 * DASHBOARD_SHEETS):
 *
 *   OK / Total / Rejected Qty      added up over the period's entries
 *   Available Working Time         Planned Production Time, added up (min)
 *   Working time                   Operating Time, added up (min)
 *   Availability / Performance /   each ratio taken once over those totals,
 *   Quality                        never an average of percentages
 *   Ideal Quantity                 what the operating time could have made
 *   OEE                            the sheet's own first OEE figure (OEE
 *                                  considering losses; Productivity on a
 *                                  worker sheet), averaged over machine-days
 *                                  (a per-entry sheet counts each entry), as
 *                                  on the dashboard's tile
 *
 * Figures come in total, by process (all its machines combined), by machine
 * within each process, and by date (for the daily chart). `summarizeRows` is
 * the pure part (tested); `summarizeRange` loads and scopes the rows.
 */
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ratio = (a, b) => (b > 0 ? a / b : null);

// Pieces of one entry: Total = Actual when saved, else OK + Rejected.
const pieces = (e) => {
  const ok = num(e.okQty) || 0;
  const actual = num(e.actualQty);
  const rejected = isNum(actual) ? Math.max(0, actual - ok) : num(e.rejectedQty) || 0;
  return { ok, rejected, total: isNum(actual) ? actual : ok + rejected };
};

const ownerOf = (e) => String(e[ownerFieldOf(e.sheet)] ?? e.machine ?? e.worker ?? "");

// The figures of one group of entries (everything, a process, a machine, a date).
const figuresOf = (group) => {
  const s = { entries: group.length, okQty: 0, totalQty: 0, rejectedQty: 0, availableMin: 0, operatingMin: 0, idealQty: 0 };
  const apq = { plannedMin: 0, operatingMin: 0, idealRunMin: 0, runOperatingMin: 0, okQty: 0, totalQty: 0 };
  const figures = [];
  const days = new Map();
  for (const e of group) {
    const p = pieces(e);
    s.okQty += p.ok;
    s.totalQty += p.total;
    s.rejectedQty += p.rejected;
    const parts = SHEET_DAY[e.sheet] ? entryParts(e.sheet, e) : null;
    if (parts) {
      if (parts.plannedProdMin > 0) {
        s.availableMin += parts.plannedProdMin;
        apq.plannedMin += parts.plannedProdMin;
        apq.operatingMin += parts.operatingMin;
      }
      if (parts.operatingMin > 0) s.operatingMin += parts.operatingMin;
      if (parts.operatingMin > 0 && isNum(parts.idealRunSec)) {
        apq.idealRunMin += parts.idealRunSec / 60;
        apq.runOperatingMin += parts.operatingMin;
      }
      if (isNum(parts.idealQty)) s.idealQty += parts.idealQty;
      if (isNum(parts.totalQty) && parts.totalQty > 0 && isNum(parts.ok)) {
        apq.okQty += parts.ok;
        apq.totalQty += parts.totalQty;
      }
    }
    const k = `${e.sheet}|${ownerOf(e)}|${e.date}`;
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  for (const day of days.values()) {
    const sheet = day[0].sheet;
    const cfg = SHEET_DAY[sheet];
    if (!cfg) continue;
    const figure = cfg.figures[0];
    const perEntry = cfg.perEntry && !day.some((r) => r.plannedLocked === true);
    const counted = perEntry ? day.map((e) => dayOeeFor(sheet, e, day)) : [dayOeeFor(sheet, day[0], day)];
    for (const f of counted) if (isNum(f?.[figure])) figures.push(f[figure]);
  }
  return {
    ...s,
    idealQty: Math.round(s.idealQty),
    availability: ratio(apq.operatingMin, apq.plannedMin),
    performance: ratio(apq.idealRunMin, apq.runOperatingMin),
    quality: ratio(apq.okQty, apq.totalQty),
    oee: mean(figures),
    machineDays: days.size,
  };
};

const groupBy = (rows, keyOf) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/**
 * `rows`: entries each carrying `sheet` (cnc, vmc, …), `processId`,
 * `processName` and `ownerName` (the machine's or worker's name).
 * Returns { from, to, ...figures, byDate: [{ date, ...figures }],
 *   processes: [{ processId, processName, ...figures, machines: [{ ownerId, ownerName, ...figures }] }] }
 */
const summarizeRows = (rows, { from, to } = {}) => {
  const processes = [...groupBy(rows, (r) => r.processId || "none").values()]
    .map((group) => ({
      processId: group[0].processId || null,
      processName: group[0].processName || "Not in any process",
      ...figuresOf(group),
      machines: [...groupBy(group, ownerOf).values()]
        .map((g) => ({ ownerId: ownerOf(g[0]), ownerName: g[0].ownerName || "—", ...figuresOf(g) }))
        .sort((a, b) => a.ownerName.localeCompare(b.ownerName, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.processName.localeCompare(b.processName));
  const byDate = [...groupBy(rows, (r) => r.date).entries()]
    .map(([date, g]) => ({ date, ...figuresOf(g) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { from, to, ...figuresOf(rows), byDate, processes };
};

/**
 * Loads every dashboard sheet's entries dated from..to (YYYY-MM-DD,
 * inclusive), names each one's process and machine / worker, and narrows to
 * `processIds` (a Set; null = every process) and `machineIds` (machine or
 * worker ids; empty = all).
 */
const summarizeRange = async (from, to, { processIds = null, machineIds = [] } = {}) => {
  const { DASHBOARD_SHEETS } = require("../controllers/process.controller");
  const Machine = require("../models/Machine");
  const MachineOperator = require("../models/MachineOperator");
  const Process = require("../models/Process");
  const [machines, workers, processes] = await Promise.all([
    Machine.find().select("process machineName").lean(),
    MachineOperator.find().select("name").lean(),
    Process.find().select("processName").lean(),
  ]);
  const processName = Object.fromEntries(processes.map((p) => [String(p._id), p.processName]));
  const machineProcess = Object.fromEntries(machines.map((m) => [String(m._id), m.process ? String(m.process) : null]));
  const ownerName = Object.fromEntries([...machines.map((m) => [String(m._id), m.machineName]), ...workers.map((w) => [String(w._id), w.name])]);
  const wanted = new Set(machineIds.map(String));
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  const rows = (
    await Promise.all(
      DASHBOARD_SHEETS.map(async ({ Model, sheet, byProcess, extra }) => {
        const entries = await Model.find({ date: { $gte: fromDate, $lte: toDate } }).lean();
        const out = [];
        for (const e of entries) {
          const processId = byProcess ? (e.process ? String(e.process) : null) : machineProcess[String(e.machine)] || null;
          if (processIds && (!processId || !processIds.has(processId))) continue;
          const owner = String(e[ownerFieldOf(sheet)] ?? e.machine ?? e.worker ?? "");
          if (wanted.size && !wanted.has(owner)) continue;
          out.push({
            ...e,
            ...extra,
            sheet,
            date: e.date.toISOString().slice(0, 10),
            processId,
            processName: processId ? processName[processId] || "Deleted process" : "Not in any process",
            ownerName: ownerName[owner] || "—",
          });
        }
        return out;
      }),
    )
  ).flat();
  return summarizeRows(rows, { from, to });
};

module.exports = { summarizeRows, summarizeRange, figuresOf };
