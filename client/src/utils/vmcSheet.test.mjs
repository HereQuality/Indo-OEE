// Run: npm test   (bundles this with Vite's esbuild, then node:test — no extra deps)
import test from "node:test";
import assert from "node:assert/strict";
import { isVmcProcess, programCycleSec, vmcDayCalc, vmcRowCalc } from "./vmcSheet.js";
import { firstVmcError, validateVmcEntry } from "./vmcValidation.js";

// A complete, valid 09:00–17:30 entry: 6 min program, 2 pieces → 180 s cycle → Ideal 170.
const entry = (o = {}) => ({
  date: "2026-09-25",
  machine: "m1",
  operator: "Ramesh",
  itemName: "Bracket",
  programTimeMin: "6",
  pcsPerProgram: "2",
  machineOnTime: "09:00",
  machineOffTime: "17:30",
  okQty: "160",
  rejectedQty: "4",
  plannedOperatorShiftHours: "9.30",
  lunchMin: "30",
  ...o,
});

test("Product Cycle Time is Program Time × 60 ÷ pieces per program", () => {
  assert.equal(programCycleSec({ programTimeMin: "6", pcsPerProgram: "2" }), 180);
  assert.equal(programCycleSec({ programTimeMin: "7.5", pcsPerProgram: "3" }), 150);
  assert.equal(programCycleSec({ programTimeMin: "6", pcsPerProgram: "" }), null);
  assert.equal(programCycleSec({ programTimeMin: "6", pcsPerProgram: "0" }), null);
});

test("row figures follow the CNC formulas off the program's cycle time", () => {
  const c = vmcRowCalc(entry());
  assert.equal(c.totalCycleSec, 180);
  assert.equal(c.shiftHours, 8.5);
  assert.equal(c.idealQty, 170);
  assert.equal(c.idealQtyPerHour, 20);
  assert.equal(c.rejectedQty, 4);
  assert.equal(c.pctOk, 160 / 164);
  assert.equal(c.effectiveHours, (160 * 180) / 3600);
});

test("Ideal Quantity is floored from whole numbers, not a repeating cycle time", () => {
  // 7 min ÷ 9 pcs = 46.666… s; 510 min × 9 ÷ 7 = 655.71 → 655
  assert.equal(vmcRowCalc(entry({ programTimeMin: "7", pcsPerProgram: "9" })).idealQty, 655);
  // 1 min ÷ 3 pcs, an exact 20 s cycle → 510 × 3 = 1530
  assert.equal(vmcRowCalc(entry({ programTimeMin: "1", pcsPerProgram: "3" })).idealQty, 1530);
});

test("a complete entry has no errors", () => {
  assert.deepEqual(validateVmcEntry(entry()), {});
});

test("required fields", () => {
  const errors = validateVmcEntry(
    entry({ operator: "", itemName: "", programTimeMin: "", pcsPerProgram: "", okQty: "", rejectedQty: "", plannedOperatorShiftHours: "" }),
  );
  for (const key of ["operator", "itemName", "programTimeMin", "pcsPerProgram", "okQty", "rejectedQty", "plannedOperatorShiftHours"]) {
    assert.ok(errors[key], `${key} should be required`);
  }
});

test("OK + Rejected can't be more than Ideal Quantity", () => {
  assert.equal(validateVmcEntry(entry({ okQty: "166", rejectedQty: "4" })).okQty, undefined, "170 = Ideal is fine");
  assert.match(validateVmcEntry(entry({ okQty: "167", rejectedQty: "4" })).okQty, /can't be more than Ideal Quantity \(170\)/);
});

test("pieces per program is a whole number, program time more than 0", () => {
  assert.ok(validateVmcEntry(entry({ pcsPerProgram: "2.5" })).pcsPerProgram);
  assert.ok(validateVmcEntry(entry({ pcsPerProgram: "0" })).pcsPerProgram);
  assert.ok(validateVmcEntry(entry({ programTimeMin: "0" })).programTimeMin);
});

test("Setting Time is optional but a pair, OFF after ON", () => {
  assert.equal(validateVmcEntry(entry({ settingOnTime: "09:00", settingOffTime: "09:20" })).settingOffTime, undefined);
  assert.ok(validateVmcEntry(entry({ settingOnTime: "09:00" })).settingOffTime);
  assert.ok(validateVmcEntry(entry({ settingOffTime: "09:20" })).settingOnTime);
  assert.match(validateVmcEntry(entry({ settingOnTime: "09:20", settingOffTime: "09:00" })).settingOffTime, /must be after/);
});

test("stoppage has to fit Planned Operator Shift − Machine Shift, and Others needs a remark", () => {
  // planned 9.30 = 570 min, shift 510 → 60 min allowed
  assert.equal(validateVmcEntry(entry({ lunchMin: "30", setupMin: "30" })).stoppageTotal, undefined);
  assert.match(validateVmcEntry(entry({ lunchMin: "30", setupMin: "31" })).stoppageTotal, /only 60 min is allowed/);
  assert.ok(validateVmcEntry(entry({ otherMin: "5" })).otherMinRemark);
  assert.equal(validateVmcEntry(entry({ otherMin: "5", otherMinRemark: "coolant" })).otherMinRemark, undefined);
});

test("Planned Operator Shift can't be less than the Machine Shift", () => {
  assert.match(validateVmcEntry(entry({ plannedOperatorShiftHours: "8.00" })).plannedOperatorShiftHours, /can't be less than the Machine Shift/);
});

test("Save scrolls to the first problem in form order", () => {
  const list = [{}, validateVmcEntry(entry({ itemName: "", okQty: "" }))];
  assert.deepEqual(firstVmcError(list), { index: 1, field: "itemName" });
  assert.equal(firstVmcError([{}, {}]), null);
});

test("a machine's day shares one Unreported Time and OEE across its entries", () => {
  const a = { ...entry(), _id: "a", machineOnTime: "09:00", machineOffTime: "13:00", plannedOperatorShiftHours: 4.5 };
  const b = { ...entry(), _id: "b", machineOnTime: "14:00", machineOffTime: "18:00", plannedOperatorShiftHours: 4.5 };
  const [ra, rb] = vmcDayCalc([a, b]);
  assert.equal(ra.oeeLosses, rb.oeeLosses);
  assert.equal(ra.unreportedMin, rb.unreportedMin);
  assert.ok(Number.isFinite(ra.oeeLosses));
});

test("a process is VMC when linked to the VMC page — or, while unlinked, when it is named VMC", () => {
  assert.equal(isVmcProcess({ processName: "Line 2", dataEntryMenu: "/hqepl/production/vmc-data-entry" }), true);
  assert.equal(isVmcProcess({ processName: "VMC", dataEntryMenu: null }), true);
  assert.equal(isVmcProcess({ processName: "Old vmc cell" }), true);
  assert.equal(isVmcProcess({ processName: "CNC", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), false);
  assert.equal(isVmcProcess({ processName: "VMC", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), false, "the link wins over the name");
  assert.equal(isVmcProcess({ processName: "PRESS" }), false);
  assert.equal(isVmcProcess(undefined), false);
});
