import test from "node:test";
import assert from "node:assert/strict";
import { spanMinutes } from "./productionSheet.js";
import { slotsFullErrors } from "./entryValidation.js";
import { PRINTING_MAX_ENTRIES, PRINTING_STOPPAGE_FIELDS, printingDayCalc, printingRowCalc } from "./printingSheet.js";
import { validatePrintingEntry } from "./printingValidation.js";

/*
 * The PRINTING sheet through its own adapter (utils/printingSheet.js) — the
 * same 16 paper rows utils/paperSheets.test.mjs checks, entered the way the
 * form saves them (no runQtyBasis / extraStoppageKeys on the row: the adapter
 * adds them), with Planned Operator Shift typed equal to each row's Machine
 * Shift (the paper has no Planned column) and the process unlocked.
 */
const PAPER = [
  { on: "09:10", off: "10:02", std: 7, total: 240, ok: 240, stops: {}, oee: [53.85, 53.85, 53.85], unrep: 24 },
  { on: "10:05", off: "17:50", std: 11, total: 2124, ok: 2124, stops: { lunchMin: 30 }, oee: [89.52, 89.52, 89.52], unrep: 45.6 },
  { on: "09:00", off: "17:10", std: 10, total: 2620, ok: 2620, stops: { lunchMin: 30 }, oee: [94.93, 94.93, 94.93], unrep: 23.3 },
  { on: "17:15", off: "17:50", std: 7, total: 168, ok: 168, stops: {}, oee: [56, 56, 56], unrep: 15.4 },
  { on: "09:10", off: "12:00", std: 20, total: 465, ok: 465, stops: {}, oee: [91.18, 91.18, 91.18], unrep: 15 },
  { on: "12:30", off: "15:45", std: 22, total: 500, ok: 500, stops: {}, oee: [94.02, 94.02, 94.02], unrep: 11.7 },
  { on: "10:30", off: "16:00", std: 21, total: 874, ok: 874, stops: { lunchMin: 30 }, oee: [101.97, 101.97, 101.97], unrep: -5.9 },
  { on: "10:30", off: "16:00", std: 6, total: 3000, ok: 3000, stops: { lunchMin: 30 }, oee: [100, 100, 100], unrep: 0 },
  { on: "16:05", off: "17:30", std: 5, total: 874, ok: 874, stops: {}, oee: [85.69, 85.69, 85.69], unrep: 12.2 },
  { on: "17:30", off: "17:50", std: 5, total: 100, ok: 100, stops: {}, oee: [41.67, 41.67, 41.67], unrep: 11.7 },
  { on: "08:30", off: "10:30", std: 7, total: 480, ok: 480, stops: {}, oee: [46.67, 46.67, 46.67], unrep: 64 },
  { on: "08:35", off: "09:00", std: 7, total: 96, ok: 96, stops: {}, oee: [44.8, 44.8, 44.8], unrep: 13.8 },
  { on: "09:05", off: "15:45", std: 20, total: 1100, ok: 1100, stops: { lunchMin: 30 }, oee: [99.1, 99.1, 99.1], unrep: 3.3 },
  { on: "15:50", off: "16:45", std: 20, total: 90, ok: 90, stops: {}, oee: [54.55, 54.55, 54.55], unrep: 25 },
  { on: "16:50", off: "17:55", std: 10, total: 300, ok: 300, stops: {}, oee: [76.92, 76.92, 76.92], unrep: 15 },
  { on: "08:30", off: "09:05", std: 8, total: 240, ok: 240, stops: {}, oee: [91.43, 91.43, 91.43], unrep: 3 },
];

const entry = ({ on, off, std, total, ok, stops }, o = {}) => ({
  _id: `${on}-${off}-${std}`,
  machine: "OP1",
  date: "2025-05-14",
  itemName: "Label",
  totalCycleSec: std,
  machineOnTime: on,
  machineOffTime: off,
  actualQty: total,
  okQty: ok,
  plannedOperatorShiftHours: spanMinutes(on, off) / 60,
  ...stops,
  ...o,
});
const pct = (v) => Math.round(v * 10000) / 100;

test("every PRINTING paper row comes out exactly as on the sheet, through the sheet's own adapter", () => {
  for (const row of PAPER) {
    const [d] = printingDayCalc([entry(row)]);
    assert.deepEqual([d.oeeLosses, d.oeeLunch, d.oeeLunchCot].map(pct), row.oee, `OEE ${row.on}–${row.off}`);
    assert.equal(Number(d.unreportedMin.toFixed(1)), row.unrep, `Unreported ${row.on}–${row.off}`);
    const c = printingRowCalc(entry(row));
    // Effective on TOTAL QTY; Ideal Qty/Hours = 3600 ÷ Std; Ideal Quantity unrounded.
    assert.ok(Math.abs(c.effectiveHours - (row.total * row.std) / 3600) < 1e-9);
    assert.equal(c.idealQtyPerHour, 3600 / row.std);
    assert.ok(Math.abs(c.idealQtyExact - (spanMinutes(row.on, row.off) * 60) / row.std) < 1e-9);
    assert.equal(c.pctOk, row.ok / row.total);
  }
});

test("several entries of one operator on one date keep their own figures (unlocked)", () => {
  // SUREKHA 14/05: 10:30–16:00 twice (two jobs at once), then 16:05–17:30 and 17:30–17:50.
  const rows = PAPER.slice(6, 10).map((r) => entry(r));
  const res = printingDayCalc(rows);
  assert.deepEqual(res.map((d) => pct(d.oeeLosses)).sort((a, b) => a - b), [41.67, 85.69, 100, 101.97]);
});

test("Ideal Quantity is shown unrounded, while TOTAL QTY is capped at it rounded down", () => {
  const row = entry({ on: "08:30", off: "17:55", std: 38, total: 893, ok: 893, stops: { lunchMin: 30 } });
  const c = printingRowCalc(row);
  assert.ok(Math.abs(c.idealQtyExact - 892.1052631578947) < 1e-9);
  assert.equal(c.idealQty, 892);
  const errors = validatePrintingEntry({ ...row, plannedOperatorShiftHours: "9.42" });
  assert.match(errors.actualQty, /Actual can't be more than Ideal Quantity \(892\)/);
  assert.equal(validatePrintingEntry({ ...row, actualQty: 892, okQty: 892, plannedOperatorShiftHours: "9.42" }).actualQty, undefined);
});

test("Printing's three own downtime columns are Idle Time: in the total, the OEE, Unreported and Availability", () => {
  assert.deepEqual(PRINTING_STOPPAGE_FIELDS.slice(0, 3).map((f) => f.key), ["askQueryQcMin", "emptyBagTuggingMin", "stockCountingMin"]);
  assert.equal(PRINTING_STOPPAGE_FIELDS.length, 13);
  const base = { on: "10:30", off: "16:00", std: 6, total: 2700, ok: 2700, stops: { lunchMin: 30 } };
  const row = entry(base, { askQueryQcMin: 10, emptyBagTuggingMin: 10, stockCountingMin: 10 });
  const c = printingRowCalc(row);
  assert.equal(c.totalStoppageMin, 60);
  // Operating 330 − 60 = 270 of Planned Production 330 − 30 = 300.
  assert.ok(Math.abs(c.availability - 0.9) < 1e-9);
  const [d] = printingDayCalc([row]);
  // Effective 4.5 h; OEE1 = 4.5 ÷ (5.5 − 60/60); Unreported = 330 − 270 − 60 = 0.
  assert.ok(Math.abs(d.oeeLosses - 4.5 / 4.5) < 1e-9);
  assert.ok(Math.abs(d.oeeLunch - 4.5 / 5) < 1e-9);
  assert.ok(Math.abs(d.unreportedMin) < 1e-9);
  // …and the 13 together can't be more than the Machine Shift.
  const over = validatePrintingEntry({ ...entry(base, { askQueryQcMin: 100, emptyBagTuggingMin: 100, stockCountingMin: 101 }), plannedOperatorShiftHours: "5.5" });
  assert.match(over.stoppageTotal, /Total Idle Time is 331 min but the Machine Shift is only 330 min/);
});

test("form rules: no Rejection Master, MC No. optional, Planned not under the Machine Shift", () => {
  const ok = { ...entry(PAPER[7]), okQty: 2990, plannedOperatorShiftHours: "5.5", mcMachine: "" };
  assert.deepEqual(validatePrintingEntry(ok), {}, "10 rejected with no reject split is fine; no MC No. is fine");
  assert.match(validatePrintingEntry({ ...ok, plannedOperatorShiftHours: "5" }).plannedOperatorShiftHours, /can't be less than the Machine Shift \(5:30\)/);
  const blank = validatePrintingEntry({ date: "2025-05-14", machine: "OP1", itemName: "", totalCycleSec: "", machineOnTime: "", machineOffTime: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "" });
  assert.equal(blank.itemName, "Item Name is required");
  assert.equal(blank.totalCycleSec, "Standard Time per Piece is required");
  assert.equal(blank.machineOnTime, "Machine ON Time is required");
  assert.equal(blank.mcMachine, undefined);
  // A Non Working day needs only its Date and Operator.
  assert.deepEqual(validatePrintingEntry({ date: "2025-05-14", machine: "OP1", workingMode: "Non Working" }), {});
  assert.equal(validatePrintingEntry({ date: "2025-05-14", machine: "", workingMode: "Non Working" }).machine, "Operator is required");
});

test(`an operator may have up to ${PRINTING_MAX_ENTRIES} entries on a date`, () => {
  const v = { date: "2025-05-14", machine: "OP1" };
  const taken = (n) => ({ "OP1|2025-05-14": Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "10:30", machineOffTime: "16:00" })) });
  const opts = { who: () => "SUREKHA", max: PRINTING_MAX_ENTRIES };
  assert.deepEqual(slotsFullErrors([v], taken(PRINTING_MAX_ENTRIES - 1), opts), [{}]);
  assert.match(slotsFullErrors([v], taken(PRINTING_MAX_ENTRIES), opts)[0].machine, /SUREKHA already has 8 entries on 14\/05\/2025/);
});

test("the dashboard shows PRINTING's own three downtime causes on their own, and BEFORE POWDER COATING's breakdown in its own words", async () => {
  const { causeLabel, causeLabelsFor, stoppageKeysFor, summarize } = await import("./processDashboard.js");
  // A row as the dashboard feed sends it (server DASHBOARD_SHEETS adds the flags).
  const row = {
    date: "2025-05-13", machine: "OP1", slot: 1, machineOnTime: "09:00", machineOffTime: "17:10",
    plannedOperatorShiftHours: 8 + 10 / 60, totalCycleSec: 10, actualQty: 2620, okQty: 2620,
    lunchMin: 30, askQueryQcMin: 5, emptyBagTuggingMin: 7, stockCountingMin: 3,
    runQtyBasis: "total", calcMode: "perEntry", extraStoppageKeys: ["askQueryQcMin", "emptyBagTuggingMin", "stockCountingMin"],
  };
  const s = summarize([row]);
  assert.equal(s.downtimeByCause.askQueryQcMin, 5);
  assert.equal(s.downtimeByCause.emptyBagTuggingMin, 7);
  assert.equal(s.downtimeByCause.stockCountingMin, 3);
  assert.equal(s.downtimeMin, 45, "Total Downtime counts them too");
  const printing = { processName: "PRINTING" };
  assert.deepEqual(stoppageKeysFor(printing).slice(0, 3), ["askQueryQcMin", "emptyBagTuggingMin", "stockCountingMin"]);
  assert.equal(stoppageKeysFor(printing).length, 13);
  assert.equal(causeLabel("askQueryQcMin"), "Ask Query To QC Team");
  assert.equal(causeLabel("bdMechMin"), "B.D. Mech.");
  assert.equal(causeLabel("bdMechMin", causeLabelsFor({ processName: "BEFORE POWDER COATING" })), "B.D. (Breakdown)");
  assert.equal(causeLabel("bdMechMin", causeLabelsFor(printing)), "B.D. Mech.");
});
