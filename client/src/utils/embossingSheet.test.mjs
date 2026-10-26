import test from "node:test";
import assert from "node:assert/strict";
import { metricsOver100, spanMinutes } from "./productionSheet.js";
import { embossingDayCalc, embossingRowCalc, isEmbossingProcess } from "./embossingSheet.js";
import { validateEmbossingEntry } from "./embossingValidation.js";
import { summarize } from "./processDashboard.js";

/*
 * The EMBOSSING sheet — its adapter (utils/embossingSheet.js), its form rules
 * (utils/embossingValidation.js) and the dashboard's per-entry figures
 * (utils/processDashboard.js summarize), against every row with times the user
 * pasted from the paper sheet (2026-10-26, May 2024). The paper has no Planned
 * column: each row is entered with Planned Operator Shift = its own Machine
 * Shift, on an unlocked process. Its 16/05 and 18/05 times, written as Excel
 * day fractions (0.3333333333 / 0.75), are 08:00 and 18:00.
 */

// [date, MC No., Item, Operator, ON, OFF, Std (s), TOTAL, OK, Setup, Lunch,
//  the paper's Ideal Quantity, Effective (h), Unreported (min), OEE ×3 (%)]
const PAPER = [
  ["08-05-2024", "M/c -6/c", "S/P FOR-3 PIN", "JASHAL", "08:00", "18:00", 8.5, 3791, 3791, 15, 30, 4235.29, 8.950972222, 17.9, [96.77, 94.22, 96.77]],
  ["09-05-2024", "M/c -6/c", "S/P -10Amp", "JASHAL", "08:00", "18:00", 7.5, 4398, 4398, 15, 30, 4800, 9.1625, 5.25, [99.05, 96.45, 99.05]],
  ["10-05-2024", "M/c -6/c", "S/P FOR-3 PIN", "JASHAL", "08:00", "18:00", 8.5, 3926, 3910, 15, 30, 4235.294118, 9.269722222, -1.183333333, [100.21, 97.58, 100.21]],
  ["11-05-2024", "M/c -6/c", "S/P FOR-3 PIN", "JASHAL", "08:00", "18:00", 8.5, 3694, 3694, 15, 30, 4235.294118, 8.721944444, 31.68333333, [94.29, 91.81, 94.29]],
  ["13-05-2024", "M/c -6/c", "S/P FOR-3 PIN", "JASHAL", "08:00", "18:00", 8.5, 3958, 3952, 15, 30, 4235.294118, 9.345277778, -5.716666667, [101.03, 98.37, 101.03]],
  ["14-05-2024", "M/c -6/c", "S/P FOR-3 PIN", "JASHAL", "08:00", "18:00", 8.5, 3975, 3970, 15, 30, 4235.294118, 9.385416667, -8.125, [101.46, 98.79, 101.46]],
  ["14-05-2024", "M/c -6/f", "S/P -10Amp", "JAYA BEN", "08:00", "18:00", 7.5, 4076, 4038, 15, 30, 4800, 8.491666667, 45.5, [91.8, 89.39, 91.8]],
  ["15-05-2024", "M/c -6/f", "S/P -10Amp", "JAYA BEN", "08:00", "18:00", 7.5, 5400, 5378, 15, 30, 4800, 11.25, -120, [121.62, 118.42, 121.62]],
  ["16-05-2024", "M/c -6/f", "S/P -10Amp", "JAYA BEN", "08:00", "18:00", 7.5, 4111, 4085, 15, 30, 4800, 8.564583333, 41.125, [92.59, 90.15, 92.59]],
  ["18-05-2024", "M/c -6/f", "S/P -10Amp", "JAYA BEN", "08:00", "18:00", 6.5, 5173, 5138, 15, 30, 5538.461538, 9.340138889, -5.408333333, [100.97, 98.32, 100.97]],
];

// Decimal places the paper shows a figure to (its first row's Ideal 4,235.29 and Unreported 17.9).
const dp = (v) => (String(v).split(".")[1] || "").length;
const close = (got, paper) => Math.abs(got - paper) <= 0.5 * 10 ** -dp(paper) + 1e-9;
const pct = (v) => Math.round(v * 10000) / 100;

const entry = ([date, mc, item, operator, on, off, std, total, ok, setupMin, lunchMin], o = {}) => {
  const [d, m, y] = date.split("-");
  return {
    _id: `${date}-${mc}`,
    date: `${y}-${m}-${d}`,
    machine: mc,
    operator,
    itemName: item,
    totalCycleSec: std,
    machineOnTime: on,
    machineOffTime: off,
    actualQty: total,
    okQty: ok,
    setupMin,
    lunchMin,
    // The paper has no Planned column: each row works on its own Machine Shift.
    plannedOperatorShiftHours: spanMinutes(on, off) / 60,
    ...o,
  };
};

test("isEmbossingProcess: by its Data Entry Page, or by name while not linked", () => {
  assert.equal(isEmbossingProcess({ dataEntryMenu: "/hqepl/production/embossing-data-entry" }), true);
  assert.equal(isEmbossingProcess({ processName: "EMBOSSING" }), true);
  assert.equal(isEmbossingProcess({ processName: "EMBOSSING", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), false);
  assert.equal(isEmbossingProcess({ processName: "INJECTION MOULDING" }), false);
});

test(`all ${PAPER.length} paper rows with times: Ideal, Effective, Unreported and the three OEE exactly as the paper`, () => {
  for (const row of PAPER) {
    const [date, mc, , , on, off, std, total, ok, , , ideal, eff, unrep, oee] = row;
    const where = `${date} ${mc}`;
    const c = embossingRowCalc(entry(row));
    const [d] = embossingDayCalc([entry(row)]);
    assert.ok(close(c.idealQtyExact, ideal), `${where} Ideal ${c.idealQtyExact} vs ${ideal}`);
    assert.ok(Math.abs(c.idealQtyPerHour - 3600 / std) < 1e-9, `${where} Ideal/Hour`);
    assert.ok(Math.abs(c.effectiveHours - eff) < 1e-6, `${where} Effective ${c.effectiveHours} vs ${eff} (TOTAL QTY basis)`);
    assert.ok(close(d.unreportedMin, unrep), `${where} Unreported ${d.unreportedMin} vs ${unrep}`);
    assert.deepEqual([d.oeeLosses, d.oeeLunch, d.oeeLunchCot].map(pct), oee, where);
    assert.equal(c.rejectedQty, total - ok, `${where} Rejected = TOTAL − OK`);
    assert.ok(Math.abs(c.pctOk - ok / total) < 1e-12);
    assert.equal(c.totalStoppageMin, 45);
    assert.equal(spanMinutes(on, off), 600);
  }
  // The first row's Unreported is 17.94 to the minute's fraction; the paper rounds it to 17.9.
  assert.equal(Number(embossingDayCalc([entry(PAPER[0])])[0].unreportedMin.toFixed(1)), 17.9);
});

test("two entries of one machine's date keep each entry's own figures (14/05: M/c -6/c and -6/f on one machine)", () => {
  // Put both 14/05 rows on one machine at different times: still each entry's own OEE.
  const a = entry(PAPER[5], { machine: "X", date: "2024-05-14", machineOnTime: "06:00", machineOffTime: "16:00" });
  const b = entry(PAPER[6], { machine: "X", date: "2024-05-14", machineOnTime: "16:00", machineOffTime: "22:00", plannedOperatorShiftHours: 6, setupMin: 0, lunchMin: 0, actualQty: 2000, okQty: 2000 });
  const [da, db] = embossingDayCalc([a, b]);
  assert.equal(pct(da.oeeLosses), 101.46);
  assert.ok(Math.abs(db.oeeLosses - (2000 * 7.5) / 3600 / 6) < 1e-12);
});

// ── TOTAL above Ideal: allowed, and flagged for review ─────────────────────
const form = (row, o = {}) => ({ ...entry(row), plannedOperatorShiftHours: "10", workingMode: "Working", machineStatus: [], ...o });

test("TOTAL above Ideal (JAYA BEN 15/05: 5400 against 4800) passes the form, and is flagged for OEE Review", () => {
  const v = form(PAPER[7]);
  const errors = validateEmbossingEntry(v);
  assert.deepEqual(errors, {}, "saved as typed — no cap at Ideal");
  const c = embossingRowCalc(v);
  assert.ok(v.actualQty > c.idealQtyExact);
  // Performance = 5400 × 7.5 s ÷ (600 − 45) min = 121.62% → held for Admin review.
  assert.deepEqual(metricsOver100(embossingRowCalc({ ...v, plannedOperatorShiftHours: 10 })), ["performance"]);
  assert.equal(pct(embossingRowCalc({ ...v, plannedOperatorShiftHours: 10 }).performance), 121.62);
});

test("every paper row passes the form as typed", () => {
  for (const row of PAPER) assert.deepEqual(validateEmbossingEntry(form(row)), {}, `${row[0]} ${row[1]}`);
});

test("required fields and quantity rules, in the sheet's words", () => {
  const e = validateEmbossingEntry(form(PAPER[0], { machine: "", operator: "", itemName: "", totalCycleSec: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "" }));
  assert.equal(e.machine, "MC No. is required");
  assert.equal(e.operator, "Operator is required");
  assert.equal(e.itemName, "Item Name is required");
  assert.equal(e.totalCycleSec, "Standard Time per Piece is required");
  assert.equal(e.actualQty, "TOTAL QTY is required");
  assert.equal(e.okQty, "OK QTY is required");
  assert.equal(e.plannedOperatorShiftHours, "Planned Operator Shift is required");
  assert.equal(e.rejectBreakdown, undefined, "no Rejection Master");
  assert.equal(validateEmbossingEntry(form(PAPER[0], { okQty: 3792 })).okQty, "OK can't be more than TOTAL QTY (3791)");
  assert.match(validateEmbossingEntry(form(PAPER[0], { actualQty: 3791.5 })).actualQty, /whole number/);
  assert.match(validateEmbossingEntry(form(PAPER[0], { plannedOperatorShiftHours: "9.5" })).plannedOperatorShiftHours, /can't be less than the Machine Shift \(10:00\)/);
  assert.match(validateEmbossingEntry(form(PAPER[0], { lunchMin: 586 })).stoppageTotal, /601 min but the Machine Shift is only 600 min/);
});

test("a Non Working day (17/05 JAYA BEN, Leave) needs only Date and MC No.", () => {
  assert.deepEqual(validateEmbossingEntry({ date: "2024-05-17", machine: "M/c -6/f", workingMode: "Non Working", machineStatus: [], remarks: "Leave" }), {});
});

// ── Planned Operator Shift locked at 12 h in Process Master ───────────────
test("on Process Master's 12 h lock the machine's day is combined once", () => {
  // Two entries on one machine's date, both saved on the lock.
  const a = entry(PAPER[0], { machine: "X", date: "2024-05-14", machineOnTime: "06:00", machineOffTime: "12:00", actualQty: 2000, okQty: 2000, plannedOperatorShiftHours: 12, plannedLocked: true });
  const b = entry(PAPER[1], { machine: "X", date: "2024-05-14", machineOnTime: "12:00", machineOffTime: "18:00", actualQty: 2500, okQty: 2500, plannedOperatorShiftHours: 12, plannedLocked: true });
  const res = embossingDayCalc([a, b]);
  assert.equal(res[0].oeeLosses, res[1].oeeLosses);
  // (2000 × 8.5 + 2500 × 7.5) ÷ 3600 over 12 h once, less the day's 90 min of downtime.
  const eff = (2000 * 8.5 + 2500 * 7.5) / 3600;
  assert.ok(Math.abs(res[0].oeeLosses - eff / (12 - 90 / 60)) < 1e-9);
  assert.ok(Math.abs(res[0].unreportedMin - (12 * 60 - eff * 60 - 90)) < 1e-9);
});

// ── Dashboard ───────────────────────────────────────────────────────────────
// What GET /processes/entries hands over for this sheet (process.controller.js DASHBOARD_SHEETS).
const fed = (row, o = {}) => ({ ...entry(row), runQtyBasis: "total", calcMode: "perEntry", ...o });

test("dashboard: each entry's figures count — OEE averaged over entries, Unreported added up", () => {
  const rows = PAPER.map((r) => fed(r));
  const s = summarize(rows);
  const each = PAPER.map((r) => embossingDayCalc([entry(r)])[0]);
  const mean = (k) => each.reduce((sum, d) => sum + d[k], 0) / each.length;
  assert.ok(Math.abs(s.oeeLosses - mean("oeeLosses")) < 1e-12);
  assert.ok(Math.abs(s.unreportedMin - each.reduce((sum, d) => sum + d.unreportedMin, 0)) < 1e-9);
  assert.equal(s.totalQty, PAPER.reduce((sum, r) => sum + r[7], 0));
  assert.ok(Math.abs(s.effectiveHours - PAPER.reduce((sum, r) => sum + r[12], 0)) < 1e-6, "Effective on TOTAL QTY.");
});

test("dashboard: a locked day still counts once", () => {
  const a = fed(PAPER[0], { machine: "X", date: "2024-05-14", machineOnTime: "06:00", machineOffTime: "12:00", plannedOperatorShiftHours: 12, plannedLocked: true });
  const b = fed(PAPER[1], { machine: "X", date: "2024-05-14", machineOnTime: "12:00", machineOffTime: "18:00", plannedOperatorShiftHours: 12, plannedLocked: true });
  const s = summarize([a, b]);
  const [d] = embossingDayCalc([a, b]);
  assert.equal(s.oeeLosses, d.oeeLosses);
  assert.equal(s.unreportedMin, d.unreportedMin);
});
