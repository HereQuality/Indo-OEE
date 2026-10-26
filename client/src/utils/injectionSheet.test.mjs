import test from "node:test";
import assert from "node:assert/strict";
import { spanMinutes } from "./productionSheet.js";
import { injectionDayCalc, injectionRowCalc, isInjectionProcess } from "./injectionSheet.js";
import { validateInjectionEntry } from "./injectionValidation.js";
import { summarize } from "./processDashboard.js";

/*
 * The INJECTION MOULDING sheet — its adapter (utils/injectionSheet.js), its
 * form rules (utils/injectionValidation.js) and the dashboard's per-entry
 * figures (utils/processDashboard.js summarize), against real rows of the
 * paper sheet (the same rows utils/paperSheets.test.mjs checks entryDayCalc on).
 */

// [ON, OFF, Standard Time (s), TOTAL, OK, downtime, the paper's Ideal Quantity, OEE ×3 (%), Unreported (min)]
const PAPER = [
  ["08:30", "18:00", 20, 1608, 1600, { lunchMin: 30 }, 1710, [99.26, 99.26, 99.26], 4],
  ["08:30", "11:30", 15, 608, 600, { setupMin: 30 }, 720, [101.33, 84.44, 101.33], -2],
  ["12:30", "16:30", 9, 1500, 1500, {}, 1600, [93.75, 93.75, 93.75], 15],
  ["08:30", "17:55", 38, 828, 825, { lunchMin: 30 }, 892.1052632, [98.02, 98.02, 98.02], 10.6],
  ["08:30", "17:55", 0.9, 35490, 35490, { lunchMin: 30 }, 37666.66667, [99.5, 99.5, 99.5], 2.65],
  ["08:30", "18:55", 0.88, 40088, 40088, { lunchMin: 30 }, 42613.63636, [98.82, 98.82, 98.82], 7.042666667],
];

const MACHINE = "m1";
const entry = ([on, off, std, total, ok, stops], o = {}) => ({
  _id: `${on}-${off}-${std}`,
  date: "2026-05-13",
  machine: MACHINE,
  operator: "RAMESH",
  itemName: "Part",
  totalCycleSec: std,
  machineOnTime: on,
  machineOffTime: off,
  actualQty: total,
  okQty: ok,
  // The paper has no Planned column: each row works on its own Machine Shift.
  plannedOperatorShiftHours: spanMinutes(on, off) / 60,
  ...stops,
  ...o,
});
const pct = (v) => Math.round(v * 10000) / 100;

test("isInjectionProcess: by its Data Entry Page, or by name while not linked", () => {
  assert.equal(isInjectionProcess({ dataEntryMenu: "/hqepl/production/injection-moulding-data-entry" }), true);
  assert.equal(isInjectionProcess({ processName: "INJECTION MOULDING" }), true);
  assert.equal(isInjectionProcess({ processName: "INJECTION MOULDING", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), false);
  assert.equal(isInjectionProcess({ processName: "SPRING FOR PINS" }), false);
});

test("row figures match the paper: Ideal Quantity unrounded, Ideal/Hours = 3600 ÷ Std, Effective on TOTAL, OK % = OK ÷ TOTAL", () => {
  for (const row of PAPER) {
    const [on, off, std, total, ok, , ideal] = row;
    const c = injectionRowCalc(entry(row));
    const shiftH = spanMinutes(on, off) / 60;
    assert.ok(Math.abs(c.idealQtyExact - ideal) < 1e-4, `Ideal ${on}–${off}: ${c.idealQtyExact} vs ${ideal}`);
    assert.equal(c.idealQty, Math.floor(c.idealQtyExact + 1e-9), "the cap is the whole number under it");
    assert.ok(Math.abs(c.idealQtyPerHour - 3600 / std) < 1e-9);
    assert.ok(Math.abs(c.effectiveHours - (total * std) / 3600) < 1e-9, "Effective counts TOTAL QTY.");
    assert.ok(Math.abs(c.pctOk - ok / total) < 1e-12);
    assert.equal(c.rejectedQty, total - ok);
    assert.ok(Math.abs(c.shiftHours - shiftH) < 1e-12);
  }
});

test("each entry's OEE and Unreported Time equal the paper's, even with several entries on one machine's date", () => {
  // Rows 1–2 and 3 put on one machine and date: still each entry's own figures.
  const rows = PAPER.slice(1, 3).map((r) => entry(r));
  const res = injectionDayCalc(rows);
  PAPER.slice(1, 3).forEach(([, , , , , , , oee, unrep], i) => {
    assert.deepEqual([res[i].oeeLosses, res[i].oeeLunch, res[i].oeeLunchCot].map(pct), oee);
    assert.ok(Math.abs(res[i].unreportedMin - unrep) < 1e-6);
  });
  for (const row of PAPER) {
    const [d] = injectionDayCalc([entry(row)]);
    assert.deepEqual([d.oeeLosses, d.oeeLunch, d.oeeLunchCot].map(pct), row[7], `${row[0]}–${row[1]}`);
    assert.ok(Math.abs(d.unreportedMin - row[8]) < 1e-6, `Unreported ${row[0]}–${row[1]}: ${d.unreportedMin}`);
  }
});

test("on Process Master's 12 h lock the machine's day is combined once", () => {
  const rows = PAPER.slice(1, 3).map((r) => entry(r, { plannedOperatorShiftHours: 12, plannedLocked: true }));
  const res = injectionDayCalc(rows);
  assert.equal(res[0].oeeLosses, res[1].oeeLosses);
  // (608 × 15 + 1500 × 9) ÷ 3600 over 12 h less 30 min of Setup.
  assert.ok(Math.abs(res[0].oeeLosses - ((608 * 15 + 1500 * 9) / 3600) / 11.5) < 1e-9);
});

// ── Form rules ──────────────────────────────────────────────────────────────
const form = (o = {}) => ({ ...entry(PAPER[0]), plannedOperatorShiftHours: "9.5", workingMode: "Working", machineStatus: [], ...o });

test("a paper row passes as typed — Rejected pieces need no reasons (no Rejection Master)", () => {
  assert.deepEqual(validateInjectionEntry(form()), {});
  assert.deepEqual(validateInjectionEntry(form({ actualQty: 1608, okQty: 1500 })), {});
});

test("required fields, in the sheet's words", () => {
  const e = validateInjectionEntry(form({ machine: "", operator: "", itemName: "", totalCycleSec: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "" }));
  assert.equal(e.machine, "MC No. is required");
  assert.equal(e.operator, "Operator is required");
  assert.equal(e.itemName, "Item Name is required");
  assert.equal(e.totalCycleSec, "Standard Time per Piece is required");
  assert.equal(e.actualQty, "Actual Quantity is required");
  assert.equal(e.okQty, "OK Quantity is required");
  assert.equal(e.plannedOperatorShiftHours, "Planned Operator Shift is required");
  assert.equal(e.rejectBreakdown, undefined);
});

test("TOTAL can't be more than Ideal rounded down; OK can't be more than TOTAL; whole numbers", () => {
  // 08:30–17:55 at 38 s: Ideal 892.105… → at most 892.
  const r5 = (actualQty, okQty = 800) => form({ machineOffTime: "17:55", totalCycleSec: 38, actualQty, okQty, plannedOperatorShiftHours: "9.42" });
  assert.match(validateInjectionEntry(r5(893)).actualQty, /Ideal Quantity \(892\)/);
  assert.equal(validateInjectionEntry(r5(892)).actualQty, undefined);
  assert.match(validateInjectionEntry(r5(800, 801)).okQty, /OK can't be more than Actual/);
  assert.match(validateInjectionEntry(r5(800.5)).actualQty, /whole number/);
});

test("Planned not under the Machine Shift; downtime within it; Other needs a remark", () => {
  assert.match(validateInjectionEntry(form({ plannedOperatorShiftHours: "9" })).plannedOperatorShiftHours, /can't be less than the Machine Shift \(9:30\)/);
  assert.match(validateInjectionEntry(form({ lunchMin: 500, setupMin: 71 })).stoppageTotal, /571 min but the Machine Shift is only 570 min/);
  assert.match(validateInjectionEntry(form({ otherMin: 5 })).otherMinRemark, /Remark is required/);
  assert.equal(validateInjectionEntry(form({ otherMin: 5, otherMinRemark: "mould change" })).otherMinRemark, undefined);
});

test("a Non Working day needs only Date and MC No.", () => {
  assert.deepEqual(validateInjectionEntry({ date: "2026-05-13", machine: MACHINE, workingMode: "Non Working", machineStatus: [] }), {});
  assert.deepEqual(Object.keys(validateInjectionEntry({ date: "", machine: "", workingMode: "Non Working" })).sort(), ["date", "machine"]);
});

// ── Dashboard ───────────────────────────────────────────────────────────────
// What GET /processes/entries hands over for this sheet (process.controller.js DASHBOARD_SHEETS).
const fed = (row, o = {}) => ({ ...entry(row), runQtyBasis: "total", calcMode: "perEntry", ...o });

test("dashboard: a per-entry sheet counts each entry's figures — OEE averaged over entries, Unreported added up", () => {
  const rows = [fed(PAPER[1]), fed(PAPER[2])];
  const s = summarize(rows);
  const each = injectionDayCalc(rows);
  assert.ok(Math.abs(s.oeeLosses - (each[0].oeeLosses + each[1].oeeLosses) / 2) < 1e-12);
  assert.ok(Math.abs(s.oeeLunch - (0.8444444444444444 + 0.9375) / 2) < 1e-9);
  assert.ok(Math.abs(s.unreportedMin - (-2 + 15)) < 1e-9);
  assert.ok(Math.abs(s.effectiveHours - (608 * 15 + 1500 * 9) / 3600) < 1e-9, "Effective on TOTAL QTY.");
});

test("dashboard: a locked per-entry day still counts once", () => {
  const rows = [fed(PAPER[1], { plannedOperatorShiftHours: 12, plannedLocked: true }), fed(PAPER[2], { plannedOperatorShiftHours: 12, plannedLocked: true })];
  const s = summarize(rows);
  const [d] = injectionDayCalc(rows);
  assert.equal(s.oeeLosses, d.oeeLosses);
  assert.equal(s.unreportedMin, d.unreportedMin);
});

test("dashboard: every other sheet is still one figure per machine-day", () => {
  const rows = [entry(PAPER[1]), entry(PAPER[2])];
  const s = summarize(rows);
  // The two entries' runs (OK Qty — no runQtyBasis here) added up over their
  // Planned added up (3 h + 4 h) less the day's 30 min of Setup — one day figure.
  assert.ok(Math.abs(s.oeeLosses - (600 * 15 + 1500 * 9) / 3600 / (3 + 4 - 0.5)) < 1e-9);
  assert.ok(Math.abs(s.unreportedMin - ((3 + 4) * 60 - (600 * 15 + 1500 * 9) / 60 - 30)) < 1e-9);
});
