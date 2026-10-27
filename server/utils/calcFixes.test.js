// The calculation fixes of 2026-10-27 (CALC-003, CALC-004, CALC-006) on the server's side of the
// day figures, with the same numbers as client/src/utils/productionSheet.test.mjs and
// mobile/test/production/calc/calc_fixes_test.dart:
//   node --test utils/calcFixes.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { entryMetrics, dayOeeFor } = require("./oeeMetrics");

const times = { machineOnTime: "08:00", machineOffTime: "16:00" };

test("CALC-006: unticking more seconds than the Part has leaves no cycle", () => {
  // RIVET: 33.1 less 21.4 and 11.7 is 7.1e-15 in floating point
  const rivet = entryMetrics("rivet", { itemName: "P", totalCycleSec: 33.1, rivetLoadingSec: 21.4, rivetProcessSec: 11.7, excludedOps: ["rivetLoadingSec", "rivetProcessSec"], okQty: 100, actualQty: 100, plannedOperatorShiftHours: 8, ...times });
  assert.equal(rivet.performance, null, "no cycle, so no Performance (it was ~1e15)");
  // CNC: 20 less Boring 36.9 is -16.9
  const cnc = entryMetrics("cnc", { itemName: "P", totalCycleSec: 20, boringSec: 36.9, excludedOps: ["boringSec"], okQty: 100, actualQty: 100, plannedOperatorShiftHours: 8, ...times });
  assert.equal(cnc.performance, null);
  const spm = entryMetrics("spm", { itemName: "P", totalCycleSec: 20, loadingSec: 36.9, excludedOps: ["loadingSec"], okQty: 100, actualQty: 100, plannedOperatorShiftHours: 8, ...times });
  assert.equal(spm.performance, null);
  // A normal untick still works: 20 − 5.5 = 14.5 s → 100 pcs = 1450 s = 24.17 min of 480
  const ok = entryMetrics("cnc", { itemName: "P", totalCycleSec: 20, boringSec: 5.5, excludedOps: ["boringSec"], okQty: 100, actualQty: 100, plannedOperatorShiftHours: 8, ...times });
  assert.ok(Math.abs(ok.performance - 1450 / 60 / 480) < 1e-9);
});

test("CALC-004: the server counts a locked 12 h once a day (what the form now previews)", () => {
  const mk = (on, off, extra = {}) => ({ itemName: "P", totalCycleSec: 60, machineOnTime: on, machineOffTime: off, okQty: 200, actualQty: 200, plannedOperatorShiftHours: 12, plannedLocked: true, ...extra });
  const day = [mk("08:00", "12:00"), mk("12:30", "16:30"), mk("17:00", "21:00")];
  const f = dayOeeFor("cnc", day[2], day.slice(0, 2));
  assert.ok(Math.abs(f.oeeLosses - 10 / 12) < 1e-9, JSON.stringify(f));
});
