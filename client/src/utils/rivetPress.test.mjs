import test from "node:test";
import assert from "node:assert/strict";
import { validateRivetEntry } from "./rivetValidation";
import { validatePressEntry } from "./pressValidation";

// 09:00–10:00 = 3600 s. RIVET: 30 s cycle -> Ideal 120. PRESS: 1 min for 2 pieces -> Ideal 120.
const rivet = (o = {}) => ({
  date: "2026-10-20", machine: "m1", operator: "Raju", processType: "Rivet", itemName: "Seal", totalCycleSec: "30",
  machineOnTime: "09:00", machineOffTime: "10:00", plannedOperatorShiftHours: "8.00",
  actualQty: "100", okQty: "90", rejectBreakdown: {}, rejectOtherRemark: "", ...o,
});
const press = (o = {}) => ({
  date: "2026-10-20", machine: "m1", operator: "Raju", itemName: "Seal", standardTimeMin: "1", pcsPerStandardTime: "2",
  machineOnTime: "09:00", machineOffTime: "10:00", plannedOperatorShiftHours: "8.00",
  actualQty: "100", okQty: "90", rejectBreakdown: {}, rejectOtherRemark: "", ...o,
});

for (const [name, validate, make] of [["RIVET", validateRivetEntry, rivet], ["PRESS", validatePressEntry, press]]) {
  test(`${name}: Actual and OK are typed; Rejected is Actual − OK and is not asked for`, () => {
    assert.equal(validate(make({ rejectBreakdown: { "Tool Mark": "10" } })).rejectedQty, undefined);
    assert.equal(validate(make({ actualQty: "" })).actualQty, "Actual Quantity is required");
    assert.equal(validate(make({ okQty: "" })).okQty, "OK Quantity is required");
  });

  test(`${name}: Actual can't be more than Ideal Quantity (OK + Rejected no longer the rule)`, () => {
    const e = validate(make({ actualQty: "121", okQty: "121" }));
    assert.match(e.actualQty, /Actual can't be more than Ideal Quantity \(120\)/);
    assert.equal(validate(make({ actualQty: "120", okQty: "120" })).actualQty, undefined);
  });

  test(`${name}: OK can't be more than Actual`, () => {
    assert.match(validate(make({ actualQty: "50", okQty: "60" })).okQty, /OK can't be more than Actual Quantity \(50\)/);
  });

  test(`${name}: the Rejection Master split has to add up to Actual − OK`, () => {
    // 100 − 90 = 10 rejected, nothing split yet
    assert.match(validate(make()).rejectBreakdown, /10 of 10 rejected piece\(s\) still have no reason/);
    assert.equal(validate(make({ rejectBreakdown: { "Tool Mark": "10" } })).rejectBreakdown, undefined);
    assert.match(validate(make({ rejectBreakdown: { "Tool Mark": "4" } })).rejectBreakdown, /6 of 10/);
    assert.match(validate(make({ rejectBreakdown: { "Tool Mark": "12" } })).rejectBreakdown, /2 more than the 10 rejected/);
  });

  test(`${name}: "Other" needs a remark`, () => {
    const split = { Other: "10" };
    assert.match(validate(make({ rejectBreakdown: split })).rejectOtherRemark, /Remark is required/);
    assert.equal(validate(make({ rejectBreakdown: split, rejectOtherRemark: "Cracked" })).rejectOtherRemark, undefined);
  });
}
