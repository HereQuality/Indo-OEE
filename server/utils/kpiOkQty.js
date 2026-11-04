"use strict";
/**
 * utils/kpiOkQty.js
 * ───────────────────
 * OK Qty summed by month from every process's data entries — what the KPI,
 * Graph and Company Level Objective pages show, never typed by hand. Pools
 * every sheet's own collection the way the dashboard does (DASHBOARD_SHEETS in
 * controllers/process.controller.js): a machine sheet's entries belong to the
 * process their machine is in; a worker sheet's entries carry their process.
 * Entry dates are stored as UTC midnight of the calendar day, so grouping by
 * the UTC month is the calendar month.
 */
const Machine = require("../models/Machine");
const { DASHBOARD_SHEETS } = require("../controllers/process.controller");

const MONTHS = 12;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Every machine's process, including machines since deleted from Machine
// Master: their past entries still count for the process they were in.
const machineProcessMap = async () => {
  const machines = await Machine.find({ process: { $ne: null } }).select("process").lean();
  return new Map(machines.map((m) => [String(m._id), String(m.process)]));
};

/**
 * Map of process id → [Jan…Dec OK Qty] for one year, over every process that
 * has entries. A process with none that year is absent.
 */
const okQtyByProcessMonth = async (year) => {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const byMachine = await machineProcessMap();
  const out = new Map();
  const add = (processId, month, qty) => {
    if (!processId) return;
    if (!out.has(processId)) out.set(processId, Array(MONTHS).fill(0));
    out.get(processId)[month - 1] += qty;
  };
  await Promise.all(
    DASHBOARD_SHEETS.map(async ({ Model, byProcess }) => {
      const key = byProcess ? "$process" : "$machine";
      const rows = await Model.aggregate([
        { $match: { date: { $gte: from, $lt: to } } },
        { $group: { _id: { owner: key, month: { $month: "$date" } }, ok: { $sum: { $ifNull: ["$okQty", 0] } } } },
      ]);
      for (const r of rows) {
        const owner = r._id.owner ? String(r._id.owner) : null;
        add(byProcess ? owner : byMachine.get(owner), r._id.month, num(r.ok));
      }
    }),
  );
  return out;
};

/** [Jan…Dec] OK Qty for the given processes in one year, from the map above. */
const monthsFor = (byProcess, processIds) => {
  const totals = Array(MONTHS).fill(0);
  for (const id of processIds || []) {
    const months = byProcess.get(String(id));
    if (months) months.forEach((q, i) => (totals[i] += q));
  }
  return totals;
};

/**
 * Every process's OK Qty by calendar month, all time: [{ year, month, okQty }]
 * sorted oldest first — the Company Level Objective page's year / month / all
 * bifurcation.
 */
const okQtyAllByYearMonth = async () => {
  const totals = new Map();
  await Promise.all(
    DASHBOARD_SHEETS.map(async ({ Model }) => {
      const rows = await Model.aggregate([
        { $group: { _id: { year: { $year: "$date" }, month: { $month: "$date" } }, ok: { $sum: { $ifNull: ["$okQty", 0] } } } },
      ]);
      for (const r of rows) {
        const k = `${r._id.year}-${r._id.month}`;
        totals.set(k, (totals.get(k) || 0) + num(r.ok));
      }
    }),
  );
  return [...totals.entries()]
    .map(([k, okQty]) => {
      const [year, month] = k.split("-").map(Number);
      return { year, month, okQty };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);
};

module.exports = { okQtyByProcessMonth, monthsFor, okQtyAllByYearMonth, MONTHS };
