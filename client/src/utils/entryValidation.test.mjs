// Run: npm test   (bundles this with Vite's esbuild, then node:test — no extra deps)
import test from "node:test";
import assert from "node:assert/strict";
import { bookedRanges, fmt12, overlapErrors, timeInterval, validateEntry } from "./entryValidation.js";

const entry = (o = {}) => ({ date: "2026-09-25", machine: "m1", machineOnTime: "08:00", machineOffTime: "12:00", ...o });
const offError = (o, opts) => validateEntry(entry(o), opts).machineOffTime;

test("OFF must be after ON", () => {
  assert.equal(offError({}), undefined);
  assert.equal(offError({ machineOffTime: "08:00" }), "Machine OFF Time must be after Machine ON Time");
  assert.equal(offError({ machineOffTime: "07:55" }), "Machine OFF Time must be after Machine ON Time");
  assert.equal(offError({ machineOffTime: "08:05" }), undefined);
  assert.equal(offError({ machineOnTime: "23:00", machineOffTime: "06:00" }), "Machine OFF Time must be after Machine ON Time", "no more overnight entries");
});

test("blank and invalid times keep their own messages", () => {
  assert.equal(offError({ machineOffTime: "" }), "Machine OFF Time is required");
  assert.equal(offError({ machineOffTime: "25:99" }), "Enter a valid time");
  assert.equal(validateEntry(entry({ machineOnTime: "" })).machineOnTime, "Machine ON Time is required");
  assert.equal(validateEntry(entry({ machineOnTime: "" })).machineOffTime, undefined, "no order complaint without a start");
});

test("an older row keeps saving while its times are untouched, and the rule returns when they change", () => {
  const saved = { machineOnTime: "22:00", machineOffTime: "06:00" };
  const legacy = { machineOnTime: "22:00", machineOffTime: "06:00" };
  assert.equal(offError(legacy, { saved }), undefined);
  assert.equal(offError({ ...legacy, machineOffTime: "05:00" }, { saved }), "Machine OFF Time must be after Machine ON Time");
});

test("fmt12 / timeInterval", () => {
  assert.equal(fmt12(0), "12:00 AM");
  assert.equal(fmt12(480), "8:00 AM");
  assert.equal(fmt12(720), "12:00 PM");
  assert.equal(fmt12(1439), "11:59 PM");
  assert.deepEqual(timeInterval("08:00", "12:30"), { start: 480, end: 750 });
  assert.deepEqual(timeInterval("22:00", "06:00"), { start: 1320, end: 1800 });
  assert.equal(timeInterval("", "12:00"), null);
});

const occupied = {
  "m1|2026-09-25": [
    { slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" },
    { slot: 2, machineOnTime: "14:00", machineOffTime: "18:00" },
  ],
};

test("an entry that starts inside a saved one is flagged on the ON box, with the clash named", () => {
  const [e] = overlapErrors([entry({ machineOnTime: "10:00", machineOffTime: "13:00" })], occupied);
  assert.deepEqual(Object.keys(e), ["machineOnTime"]);
  assert.match(e.machineOnTime, /overlaps another entry for this machine on this date \(8:00 AM – 12:00 PM\)/);
});

test("an entry that runs into the next one is flagged on the OFF box", () => {
  const [e] = overlapErrors([entry({ machineOnTime: "12:00", machineOffTime: "15:00" })], occupied);
  assert.deepEqual(Object.keys(e), ["machineOffTime"]);
  assert.match(e.machineOffTime, /2:00 PM – 6:00 PM/);
});

test("fitting exactly between two entries, touching both, is allowed", () => {
  assert.deepEqual(overlapErrors([entry({ machineOnTime: "12:00", machineOffTime: "14:00" })], occupied), [{}]);
});

test("other machines, other dates and unfinished times never conflict", () => {
  assert.deepEqual(overlapErrors([entry({ machine: "m2", machineOnTime: "09:00", machineOffTime: "10:00" })], occupied), [{}]);
  assert.deepEqual(overlapErrors([entry({ date: "2026-09-26", machineOnTime: "09:00", machineOffTime: "10:00" })], occupied), [{}]);
  assert.deepEqual(overlapErrors([entry({ machineOffTime: "" })], occupied), [{}]);
  assert.deepEqual(overlapErrors([entry({ machine: "" })], occupied), [{}]);
});

test("two blocks of one form can't overlap each other either (both are flagged)", () => {
  const list = [
    entry({ machineOnTime: "08:00", machineOffTime: "10:00" }),
    entry({ machineOnTime: "09:00", machineOffTime: "11:00" }),
    entry({ machine: "m2", machineOnTime: "09:00", machineOffTime: "11:00" }),
  ];
  const errs = overlapErrors(list, {});
  assert.ok(errs[0].machineOffTime, "the first runs into the second");
  assert.ok(errs[1].machineOnTime, "the second starts inside the first");
  assert.deepEqual(errs[2], {}, "a different machine is independent");
});

test("editing: the row's own slot is not 'another entry', but its neighbours still are", () => {
  assert.deepEqual(overlapErrors([entry({ machineOnTime: "09:00", machineOffTime: "11:00" })], occupied, { editSlot: 1 }), [{}]);
  const [grown] = overlapErrors([entry({ machineOnTime: "09:00", machineOffTime: "15:00" })], occupied, { editSlot: 1 });
  assert.match(grown.machineOffTime, /2:00 PM – 6:00 PM/);
});

test("an older overlapping row is left alone while its times are untouched", () => {
  const saved = { machineOnTime: "10:00", machineOffTime: "13:00" };
  assert.deepEqual(overlapErrors([entry({ machineOnTime: "10:00", machineOffTime: "13:00" })], occupied, { editSlot: 3, saved }), [{}]);
  const [changed] = overlapErrors([entry({ machineOnTime: "10:00", machineOffTime: "13:05" })], occupied, { editSlot: 3, saved });
  assert.ok(changed.machineOnTime);
});

test("bookedRanges lists what the machine already has, minus the row being edited", () => {
  assert.deepEqual(bookedRanges(entry(), occupied), ["8:00 AM – 12:00 PM", "2:00 PM – 6:00 PM"]);
  assert.deepEqual(bookedRanges(entry(), occupied, 1), ["2:00 PM – 6:00 PM"]);
  assert.deepEqual(bookedRanges(entry({ machine: "m9" }), occupied), []);
});

// ── Planned Operator Shift (H.MM), Lunch / Rest, stoppage ───────────────────
import { hoursToHm, hoursToHmInput, parseHm } from "./shiftHours";
import { validateEntry as validate } from "./entryValidation";

const block = (o = {}) => ({
  date: "2026-04-06", machine: "m1", operator: "op", itemName: "Part A",
  machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45",
  actualQty: "600", okQty: "590", rejectBreakdown: { "Dimension Out": "10" },
  plannedOperatorShiftHours: "9.00", lunchMin: "", ...o,
});

test("H.MM: 60 minutes to the hour, one minute digit is tens of minutes", () => {
  assert.equal(parseHm("3.30").hours, 3.5);
  assert.equal(parseHm("3.5").hours, 3 + 50 / 60);
  assert.equal(parseHm("3").hours, 3);
  assert.equal(parseHm("3.75").minutesTooBig, true);
  assert.equal(parseHm("").hours, null);
  assert.equal(hoursToHm(3.5), "3:30");
  assert.equal(hoursToHmInput(7.5), "7.30");
});

test("Planned Operator Shift can't be less than the Machine Shift, and its minutes stop at 59", () => {
  assert.equal(validate(block({ plannedOperatorShiftHours: "7.30" })).plannedOperatorShiftHours, "Planned Operator Shift (7:30) can't be less than Machine Shift (8:00)");
  assert.equal(validate(block({ plannedOperatorShiftHours: "8.75" })).plannedOperatorShiftHours, "Minutes must be 00–59 (3.30 means 3 h 30 min)");
  assert.equal(validate(block({ plannedOperatorShiftHours: "8.00" })).plannedOperatorShiftHours, undefined);
});

test("Stoppage sits inside the ON–OFF window: allowed = Machine Shift − Effective Run Time (480 − 442.5 → 37 min)", () => {
  assert.deepEqual(validate(block()), {});
  assert.deepEqual(validate(block({ lunchMin: "20", setupMin: "17" })), {}); // exactly the 37, and less is fine
  assert.equal(
    validate(block({ lunchMin: "20", setupMin: "18" })).stoppageTotal,
    "Total stoppage is 38 min but only 37 min is allowed (Machine Shift − Effective Run Time)",
  );
  // Planned Operator Shift no longer widens it, so Unreported Time can't go negative
  assert.ok(validate(block({ plannedOperatorShiftHours: "13.00", lunchMin: "60" })).stoppageTotal);
});
