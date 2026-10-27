import test from "node:test";
import assert from "node:assert/strict";
import { dayCalc, dayFiguresFor, metricsOver100, rowCalc, withDayFigures } from "./productionSheet.js";
import { rubberDayCalc, rubberRowCalc } from "./rubberSheet.js";

/*
 * An entry is held for Admin review when its Availability, Performance or Quality
 * — or an OEE figure of its day (the worker sheets' Productivity figures) — is
 * above 100%. The OEE figures are the day's, so a caller merges them onto the
 * row's calc (withDayFigures) before asking metricsOver100.
 */
test("metricsOver100 names an OEE figure that alone is above 100%", () => {
  const calc = { availability: 1, performance: 0.95, quality: 1, oeeLosses: 1.025, oeeLunch: 1.025, oeeLunchCot: 0.99 };
  assert.deepEqual(metricsOver100(calc), ["oeeLosses", "oeeLunch"]);
  assert.deepEqual(metricsOver100({ productivity: 1.2, productivityLunch: 1.3 }), ["productivity", "productivityLunch"]);
  assert.deepEqual(metricsOver100({ availability: 1.01, oeeLosses: 1.02 }), ["availability", "oeeLosses"]);
});

test("metricsOver100: exactly 100% (floating-point dust included), blanks and under are not over", () => {
  assert.deepEqual(metricsOver100({ availability: 1, oeeLosses: 1 + 1e-12, oeeLunch: null, oeeLunchCot: undefined, productivity: 0.5 }), []);
  assert.deepEqual(metricsOver100(null), []);
});

const entry = (o) => ({ itemName: "Part", totalCycleSec: 60, plannedOperatorShiftHours: 4, ...o });
const morning = entry({ _id: "m", machineOnTime: "08:00", machineOffTime: "12:00", actualQty: 264, okQty: 264 });
const afternoon = entry({ machineOnTime: "13:00", machineOffTime: "17:00", actualQty: 228, okQty: 228 });

test("the form's day figures: an entry at 95% alone is over 100% on its OEE once the day's other entry is counted", () => {
  const own = rowCalc(afternoon);
  assert.deepEqual(metricsOver100(own), [], "its own Availability / Performance / Quality are fine");

  const day = dayFiguresFor(dayCalc, afternoon, [morning]);
  assert.ok(Math.abs(day.oeeLosses - 492 / 480) < 1e-9);
  assert.deepEqual(metricsOver100(withDayFigures(own, day, "machine")), ["oeeLosses", "oeeLunch", "oeeLunchCot"]);

  // The entry's own saved copy is replaced by what is typed, not counted twice.
  const edited = dayFiguresFor(dayCalc, { ...afternoon, _id: "x" }, [morning, { ...afternoon, _id: "x", okQty: 1, actualQty: 1 }]);
  assert.ok(Math.abs(edited.oeeLosses - 492 / 480) < 1e-9);
});

test("a worker sheet counts its two Productivity figures; a machine sheet's OEE keys are left out", () => {
  const own = rubberRowCalc(afternoon);
  const day = dayFiguresFor(rubberDayCalc, afternoon, [morning]);
  const merged = withDayFigures(own, day, "worker");
  assert.deepEqual(metricsOver100(merged), ["productivity", "productivityLunch"]);
  assert.equal("oeeLosses" in merged, false);
});

/*
 * Calculation fixes of 2026-10-27 (CALC-001 … CALC-006). The same numbers are pinned in
 * server/utils/calcFixes.test.js and mobile/test/production/calc/calc_fixes_test.dart.
 */
import { fmtNum, fmtPct } from "./productionSheet.js";
import { rivetRowCalc } from "./rivetSheet.js";
import { spmRowCalc } from "./spmSheet.js";
import { vmcRowCalc } from "./vmcSheet.js";
import { pressRowCalc } from "./pressSheet.js";
import { mfdRowCalc } from "./mfdSheet.js";
import { summarize, FORMATS } from "./processDashboard.js";
import { withDecimalPlanned } from "./entryValidation.js";

test("CALC-001: Ideal Quantity does not floor one low on an exact division", () => {
  // 00:00–03:00 at 2.7 s = 10800 ÷ 2.7 = 4000 (the float quotient is 3999.9999999999995)
  assert.equal(rowCalc({ itemName: "P", totalCycleSec: 2.7, machineOnTime: "00:00", machineOffTime: "03:00" }).idealQty, 4000);
  // RIVET 02:35 at 37.2 s = 9300 ÷ 37.2 = 250 (249.99999999999997)
  assert.equal(rivetRowCalc({ itemName: "P", totalCycleSec: 37.2, machineOnTime: "00:00", machineOffTime: "02:35" }).idealQty, 250);
  // VMC / PRESS: 180 min × 15 pcs ÷ 2.7 min = 1000
  assert.equal(vmcRowCalc({ itemName: "P", programTimeMin: 2.7, pcsPerProgram: 15, machineOnTime: "00:00", machineOffTime: "03:00" }).idealQty, 1000);
  assert.equal(pressRowCalc({ itemName: "P", standardTimeMin: 2.7, pcsPerStandardTime: 15, machineOnTime: "00:00", machineOffTime: "03:00" }).idealQty, 1000);
  // A real fraction still floors: 60 min × 7 pcs ÷ 7.5 min = 56
  assert.equal(vmcRowCalc({ itemName: "P", programTimeMin: 7.5, pcsPerProgram: 7, machineOnTime: "00:00", machineOffTime: "01:00" }).idealQty, 56);
  assert.equal(rowCalc({ itemName: "P", totalCycleSec: 100, machineOnTime: "00:00", machineOffTime: "00:05" }).idealQty, 3);
});

test("CALC-002: the dashboard's Ideal QTY for MODULAR FRAME DRILLING takes Lunch out like the table", () => {
  const row = { date: "2026-10-27", machine: "m", itemName: "P", totalCycleSec: 50, machineOnTime: "08:15", machineOffTime: "18:55", lunchMin: 30, calcMode: "perEntry", actualQty: 700, okQty: 700 };
  assert.equal(mfdRowCalc(row).idealQtyExact, 732);
  assert.equal(summarize([{ ...row, idealLessLunch: true }]).idealQty, 732);
  assert.equal(summarize([row]).idealQty, 768, "an unflagged row still reads the plain shift");
});

test("CALC-003: a number that rounds to zero never prints a minus", () => {
  assert.equal(fmtNum(-2.8e-14), "0");
  assert.equal(fmtNum(-0.0013), "0");
  assert.equal(fmtNum(-0), "0");
  assert.equal(fmtNum(-0.5), "-0.5");
  assert.equal(fmtNum(12.5), "12.5");
  assert.equal(fmtPct(-0.00001), "0.00%");
  assert.equal(fmtPct(-0), "0.00%");
  assert.equal(fmtPct(0.8333333), "83.33%");
  assert.equal(fmtPct(-0.25), "-25.00%");
  assert.equal(FORMATS.pct(-0.00001), "0.00%");
  assert.equal(FORMATS.hours(-1e-12), "0 hr");
});

test("CALC-004: the form's day figures count a new entry's locked 12 h once, as the table does after Save", () => {
  const mk = (on, off, extra = {}) => ({ itemName: "P", totalCycleSec: 60, machineOnTime: on, machineOffTime: off, okQty: 200, actualQty: 200, plannedOperatorShiftHours: 12, machine: "m", date: "2026-10-27", ...extra });
  const saved = [mk("08:00", "12:00", { _id: "a", plannedLocked: true }), mk("12:30", "16:30", { _id: "b", plannedLocked: true })];
  const form = mk("17:00", "21:00");
  const lock = { locked: true, hours: 12, fromEntry: false };
  const wrong = dayFiguresFor(dayCalc, withDecimalPlanned(form), saved);
  assert.ok(Math.abs(wrong.oeeLosses - 10 / 24) < 1e-9, "without the lock the 12 h is added twice (the old 41.67%)");
  const right = dayFiguresFor(dayCalc, withDecimalPlanned(form, lock), saved);
  assert.ok(Math.abs(right.oeeLosses - 10 / 12) < 1e-9);
  assert.equal(Math.round(right.unreportedMin), 120);
  const afterSave = dayFiguresFor(dayCalc, { ...form, plannedLocked: true }, saved);
  assert.equal(right.oeeLosses, afterSave.oeeLosses);
  // Editing a saved locked entry: the form values carry its own flag, and its saved copy is replaced.
  const edited = dayFiguresFor(dayCalc, withDecimalPlanned({ ...form, _id: "c", plannedLocked: true }, { locked: true, hours: 12, fromEntry: true }), [...saved, { ...form, _id: "c", plannedLocked: true }]);
  assert.ok(Math.abs(edited.oeeLosses - 10 / 12) < 1e-9);
  // A typed Planned (no lock) is untouched, and a lock the entry kept from its save adds nothing.
  assert.equal(withDecimalPlanned(form, null).plannedLocked, undefined);
  assert.equal(withDecimalPlanned(form, { locked: true, hours: 12, fromEntry: true }).plannedLocked, undefined);
  assert.equal(withDecimalPlanned(form, lock).plannedLocked, true);
});

test("CALC-006: unticking more seconds than the Part has leaves no cycle, not a nonsense one", () => {
  const times = { machineOnTime: "08:00", machineOffTime: "16:00" };
  // RIVET: total 33.1 less 21.4 and 11.7 is 7.1e-15 in floating point
  const rivet = rivetRowCalc({ itemName: "P", totalCycleSec: 33.1, rivetLoadingSec: 21.4, rivetProcessSec: 11.7, excludedOps: ["rivetLoadingSec", "rivetProcessSec"], ...times });
  assert.equal(rivet.totalCycleSec, null);
  assert.equal(rivet.idealQty, null);
  // CNC: total 20 less Boring 36.9 is -16.9
  const cnc = rowCalc({ itemName: "P", totalCycleSec: 20, boringSec: 36.9, excludedOps: ["boringSec"], ...times });
  assert.equal(cnc.totalCycleSec, null);
  assert.equal(cnc.idealQty, null);
  const spm = spmRowCalc({ itemName: "P", totalCycleSec: 20, loadingSec: 36.9, excludedOps: ["loadingSec"], ...times });
  assert.equal(spm.idealQty, null);
  // A normal untick still works: 20 − 5.5 = 14.5 s
  assert.equal(rowCalc({ itemName: "P", totalCycleSec: 20, boringSec: 5.5, excludedOps: ["boringSec"], ...times }).totalCycleSec, 14.5);
});
