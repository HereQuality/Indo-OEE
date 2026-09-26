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
