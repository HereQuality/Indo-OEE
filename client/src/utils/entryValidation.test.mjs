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
  const saved = { date: "2026-09-25", machine: "m1", machineOnTime: "22:00", machineOffTime: "06:00" };
  const legacy = { machineOnTime: "22:00", machineOffTime: "06:00" };
  assert.equal(offError(legacy, { saved }), undefined);
  assert.equal(offError({ ...legacy, machineOffTime: "05:00" }, { saved }), "Machine OFF Time must be after Machine ON Time");
});

test("fmt12 / timeInterval", () => {
  assert.equal(fmt12(0), "00:00");
  assert.equal(fmt12(480), "08:00");
  assert.equal(fmt12(720), "12:00");
  assert.equal(fmt12(1439), "23:59");
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
  assert.match(e.machineOnTime, /overlaps another entry for this machine on this date \(08:00 – 12:00\)/);
});

test("an entry that runs into the next one is flagged on the OFF box", () => {
  const [e] = overlapErrors([entry({ machineOnTime: "12:00", machineOffTime: "15:00" })], occupied);
  assert.deepEqual(Object.keys(e), ["machineOffTime"]);
  assert.match(e.machineOffTime, /14:00 – 18:00/);
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
  assert.match(grown.machineOffTime, /14:00 – 18:00/);
});

test("an older overlapping row is left alone while its times are untouched", () => {
  const saved = { date: "2026-09-25", machine: "m1", machineOnTime: "10:00", machineOffTime: "13:00" };
  assert.deepEqual(overlapErrors([entry({ machineOnTime: "10:00", machineOffTime: "13:00" })], occupied, { editSlot: 3, saved }), [{}]);
  const [changed] = overlapErrors([entry({ machineOnTime: "10:00", machineOffTime: "13:05" })], occupied, { editSlot: 3, saved });
  assert.ok(changed.machineOnTime);
});

test("bookedRanges lists what the machine already has, minus the row being edited", () => {
  assert.deepEqual(bookedRanges(entry(), occupied), ["08:00 – 12:00", "14:00 – 18:00"]);
  assert.deepEqual(bookedRanges(entry(), occupied, 1), ["14:00 – 18:00"]);
  assert.deepEqual(bookedRanges(entry({ machine: "m9" }), occupied), []);
});

// ── Planned Operator Shift (decimal hours), Lunch / Rest, stoppage ───────────────────
import { hoursToHm, hoursToShiftInput, parseShiftHours } from "./shiftHours";
import { validateEntry as validate } from "./entryValidation";

const block = (o = {}) => ({
  date: "2026-04-06", machine: "m1", operator: "op", itemName: "Part A",
  machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45",
  actualQty: "600", okQty: "590", rejectBreakdown: { "Dimension Out": "10" },
  plannedOperatorShiftHours: "9.00", lunchMin: "", ...o,
});

test("Planned is typed in decimal hours like the sheet, taken to the whole minute", () => {
  // The real RIVET sheet (11/A, 21-06-2025): 5.33, 1 and 0.5 are 5 h 20 min, 1 h and 30 min.
  assert.equal(Math.round(parseShiftHours("5.33").hours * 60), 320);
  assert.equal(parseShiftHours("0.5").hours, 0.5);
  assert.equal(parseShiftHours("1").hours, 1);
  assert.equal(Math.round(parseShiftHours("3.7").hours * 60), 222);
  assert.equal(parseShiftHours("3.5").hours, 3.5);
  assert.equal(parseShiftHours("8.").hours, 8);
  assert.equal(parseShiftHours("").hours, null);
  assert.equal(parseShiftHours("abc").hours, null);
  assert.equal(hoursToHm(3.5), "3:30");
  // What the box shows for a saved shift reads back to the very same minute.
  assert.equal(hoursToShiftInput(320 / 60), "5.33");
  assert.equal(hoursToShiftInput(7.5), "7.5");
  for (let min = 0; min <= 24 * 60; min += 1) {
    assert.equal(Math.round(parseShiftHours(hoursToShiftInput(min / 60)).hours * 60), min);
  }
});

test("Planned Operator Shift can't be less than the Machine Shift; 8.75 is 8 h 45 min", () => {
  assert.equal(validate(block({ plannedOperatorShiftHours: "7.30" })).plannedOperatorShiftHours, "Planned Operator Shift can't be less than the Machine Shift (8:00)");
  assert.equal(validate(block({ plannedOperatorShiftHours: "8.75" })).plannedOperatorShiftHours, undefined);
  assert.equal(validate(block({ plannedOperatorShiftHours: "abc" })).plannedOperatorShiftHours, "Enter hours as on the sheet, like 8.5 or 5.33");
  assert.equal(validate(block({ plannedOperatorShiftHours: "8.00" })).plannedOperatorShiftHours, undefined);
});

test("Stoppage is capped by the Machine Shift (08:00–16:00 → 480 min), and less is fine", () => {
  assert.deepEqual(validate(block()), {});
  assert.deepEqual(validate(block({ lunchMin: "20", setupMin: "30" })), {});
  assert.deepEqual(validate(block({ lunchMin: "240", setupMin: "240" })), {}); // exactly 480
  assert.equal(
    validate(block({ lunchMin: "240", setupMin: "241" })).stoppageTotal,
    "Total stoppage is 481 min but the Machine Shift is only 480 min",
  );
});

import { dayCalc } from "./productionSheet";

test("Unreported Time = Planned − Machine Shift − Stoppage in whole minutes (good-part run time plays no part)", () => {
  const row = (o = {}) => ({
    machine: "m1", date: "2026-09-28", itemName: "Part 1", totalCycleSec: 57,
    machineOnTime: "08:00", machineOffTime: "20:00", actualQty: 757, okQty: 753,
    plannedOperatorShiftHours: 14, lunchMin: 30, setupMin: 30, ...o,
  });
  assert.equal(dayCalc([row()])[0].unreportedMin, 60); // 840 − 720 − 60, not 64.65
  assert.equal(dayCalc([row({ plannedOperatorShiftHours: 13 })])[0].unreportedMin, 0); // was −55.35
  assert.equal(dayCalc([row({ okQty: 100 })])[0].unreportedMin, 60);
  // two entries on one date add up
  const both = dayCalc([row(), row({ machineOnTime: "20:00", machineOffTime: "22:00", plannedOperatorShiftHours: 2.5, lunchMin: 0, setupMin: 10 })]);
  assert.equal(both[0].unreportedMin, 60 + (30 - 10));
});

import { isTimeRuleMessage, operatorOverlapErrors } from "./entryValidation";

test("Planned shorter than the Machine Shift is a live (time-rule) warning with a stable message", () => {
  const e = validate(block({ plannedOperatorShiftHours: "7.30" })).plannedOperatorShiftHours;
  assert.equal(e, "Planned Operator Shift can't be less than the Machine Shift (8:00)");
  assert.ok(isTimeRuleMessage(e));
  // typing "7" then "7.3" then "7.30" keeps the very same message, so it toasts once
  assert.equal(validate(block({ plannedOperatorShiftHours: "7" })).plannedOperatorShiftHours, e);
});

test("one operator can't be on two machines at overlapping times on a date", () => {
  const mine = { date: "2026-09-28", machine: "m2", operator: "Asha", machineOnTime: "10:00", machineOffTime: "14:00" };
  const saved = { "Asha|2026-09-28": [{ machine: "m1", machineName: "7A", slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" }] };
  const [err] = operatorOverlapErrors([mine], saved);
  assert.equal(err.machineOnTime, "Operator Asha is already on machine 7A from 08:00 – 12:00 on this date — an operator can't run two machines at the same time");
  assert.ok(isTimeRuleMessage(err.machineOnTime));
  // runs into it from before -> the OFF box is flagged
  assert.ok(operatorOverlapErrors([{ ...mine, machineOnTime: "06:00", machineOffTime: "09:00" }], saved)[0].machineOffTime);
  // touching, another operator, another date, the same machine: all fine
  assert.deepEqual(operatorOverlapErrors([{ ...mine, machineOnTime: "12:00", machineOffTime: "16:00" }], saved), [{}]);
  assert.deepEqual(operatorOverlapErrors([{ ...mine, operator: "Ravi" }], saved), [{}]);
  assert.deepEqual(operatorOverlapErrors([{ ...mine, date: "2026-09-29" }], saved), [{}]);
  assert.deepEqual(operatorOverlapErrors([{ ...mine, machine: "m1" }], saved), [{}]);
  // editing that very row is not "another" entry
  assert.deepEqual(operatorOverlapErrors([{ ...mine, machine: "m1", machineOnTime: "09:00", machineOffTime: "11:00" }], saved, { editing: { machine: "m1", slot: 1 } }), [{}]);
  // two blocks of the same form, same operator, different machines, overlapping
  const a = { ...mine, machine: "m1", machineOnTime: "08:00", machineOffTime: "12:00" };
  const both = operatorOverlapErrors([a, mine], {}, { machineName: (id) => ({ m1: "7A", m2: "7B" })[id] });
  assert.ok(both[0].machineOffTime && both[1].machineOnTime); // each is flagged on the box that runs into the other
  // an older row that already breaks it stays editable while its times and operator are untouched
  assert.deepEqual(operatorOverlapErrors([mine], saved, { saved: { date: "2026-09-28", machine: "m2", machineOnTime: "10:00", machineOffTime: "14:00", operator: "Asha" } }), [{}]);
});

// ── Edit: moving a row to another date (or machine) ─────────────────────────
import { isEndBeforeStartMessage, isLiveMessage, slotsFullErrors, timesUnchanged } from "./entryValidation";

test("timesUnchanged also compares the date and the machine", () => {
  const saved = { date: "2026-09-25", machine: "m1", machineOnTime: "08:00", machineOffTime: "12:00" };
  assert.equal(timesUnchanged(entry(), saved), true);
  assert.equal(timesUnchanged(entry({ date: "2026-09-26" }), saved), false);
  assert.equal(timesUnchanged(entry({ machine: "m2" }), saved), false);
  assert.equal(timesUnchanged(entry(), null), false);
});

test("an older overnight row moved to another date gets the OFF-after-ON rule again", () => {
  const saved = { date: "2026-09-25", machine: "m1", machineOnTime: "22:00", machineOffTime: "06:00" };
  const legacy = { machineOnTime: "22:00", machineOffTime: "06:00" };
  assert.equal(offError(legacy, { saved }), undefined);
  assert.equal(offError({ ...legacy, date: "2026-09-26" }, { saved }), "Machine OFF Time must be after Machine ON Time");
});

test("editing: changing only the Date still checks the new date's entries", () => {
  // The row was slot 1 on the 24th, 08:00–12:00; the 25th already has slot 1 at the same time.
  const saved = { date: "2026-09-24", machine: "m1", machineOnTime: "08:00", machineOffTime: "12:00" };
  const [moved] = overlapErrors([entry({ machineOnTime: "08:00", machineOffTime: "12:00" })], occupied, { editSlot: 1, saved });
  assert.match(moved.machineOnTime, /overlaps another entry for this machine on this date \(08:00 – 12:00\)/);
  // On its own saved date its slot is still itself.
  const home = { ...saved, date: "2026-09-25" };
  assert.deepEqual(overlapErrors([entry({ machineOnTime: "09:00", machineOffTime: "11:00" })], occupied, { editSlot: 1, saved: home }), [{}]);
});

test("the 'Already booked' hint hides the edited row only on its own saved date and machine", () => {
  const home = { date: "2026-09-25", machine: "m1", machineOnTime: "08:00", machineOffTime: "12:00" };
  assert.deepEqual(bookedRanges(entry(), occupied, 1, home), ["14:00 – 18:00"]);
  const elsewhere = { ...home, date: "2026-09-24" };
  assert.deepEqual(bookedRanges(entry(), occupied, 1, elsewhere), ["08:00 – 12:00", "14:00 – 18:00"]);
});

test("editing: changing only the Date still checks the operator's other machines that day", () => {
  const theirs = { "Asha|2026-09-29": [{ machine: "m1", machineName: "7A", slot: 1, machineOnTime: "10:00", machineOffTime: "12:00" }] };
  const row = { date: "2026-09-29", machine: "m2", operator: "Asha", machineOnTime: "10:00", machineOffTime: "14:00" };
  const saved = { ...row, date: "2026-09-28" };
  const [err] = operatorOverlapErrors([row], theirs, { editing: { machine: "m2", slot: 1 }, saved });
  assert.match(err.machineOnTime, /already on machine 7A/);
  // Untouched on its own date, it stays editable.
  assert.deepEqual(operatorOverlapErrors([{ ...row, date: "2026-09-28" }], { "Asha|2026-09-28": theirs["Asha|2026-09-29"] }, { editing: { machine: "m2", slot: 1 }, saved }), [{}]);
});

// ── End before Start, in every sheet's words ───────────────────────────────
import { validateRubberEntry, RUBBER_TIME_WORDS } from "./rubberValidation";
import { validatePowderEntry, POWDER_TIME_WORDS } from "./powderCoatingValidation";
import { validateVmcEntry } from "./vmcValidation";

const worker = (o = {}) => ({
  date: "2026-10-20", machine: "w1", itemName: "Seal", totalCycleSec: "30",
  machineOnTime: "09:00", machineOffTime: "10:00", okQty: "100", actualQty: "100",
  plannedOperatorShiftHours: "8.00", ...o,
});

test("End before Start is a live time-rule message on the worker sheets too", () => {
  const rubber = validateRubberEntry(worker({ machineOffTime: "08:00" }));
  assert.equal(rubber.machineOffTime, "Working End Time must be after Working Start Time");
  assert.ok(isTimeRuleMessage(rubber.machineOffTime));
  assert.ok(isEndBeforeStartMessage(rubber.machineOffTime));
  const powder = validatePowderEntry(worker({ machineOffTime: "08:00" }));
  assert.equal(powder.machineOffTime, "Inspection End Time must be after Inspection Start Time");
  assert.ok(isTimeRuleMessage(powder.machineOffTime));
});

test("End before Start doesn't also claim the Planned shift is shorter than a wrapped-round 23 h shift", () => {
  assert.equal(validateRubberEntry(worker({ machineOffTime: "08:00" })).plannedOperatorShiftHours, undefined);
  assert.equal(validatePowderEntry(worker({ machineOffTime: "08:00" })).plannedOperatorShiftHours, undefined);
  assert.equal(validate(block({ machineOffTime: "07:00" })).plannedOperatorShiftHours, undefined);
  assert.equal(validateVmcEntry({ ...block({ machineOffTime: "07:00" }), rejectedQty: "0" }).plannedOperatorShiftHours, undefined);
  // With the times in order the rule is as before.
  assert.equal(
    validateRubberEntry(worker({ machineOffTime: "18:00", plannedOperatorShiftHours: "8.00" })).plannedOperatorShiftHours,
    "Planned Operator Shift can't be less than the Worker Shift Time (9:00)",
  );
});

test("the overlap message uses the worker sheet's own wording", () => {
  const taken = { "w1|2026-10-20": [{ slot: 1, machineOnTime: "08:00", machineOffTime: "12:00" }] };
  const [r] = overlapErrors([worker()], taken, { words: RUBBER_TIME_WORDS });
  assert.equal(r.machineOnTime, "Working Start Time overlaps another entry for this worker on this date (08:00 – 12:00)");
  assert.ok(isTimeRuleMessage(r.machineOnTime));
  const [p] = overlapErrors([worker({ machineOnTime: "07:00" })], taken, { words: POWDER_TIME_WORDS });
  assert.match(p.machineOffTime, /^Inspection End Time overlaps another entry for this worker/);
});

// ── A 4th entry for a machine/worker on a date ─────────────────────────────
const full = {
  "m1|2026-09-25": [
    { slot: 1, machineOnTime: "06:00", machineOffTime: "08:00" },
    { slot: 2, machineOnTime: "08:00", machineOffTime: "10:00" },
    { slot: 3, machineOnTime: "", machineOffTime: "" },
  ],
};

test("a machine with 3 saved entries that date is flagged on the Machine box, in the server's words", () => {
  const [e] = slotsFullErrors([entry()], full);
  assert.equal(e.machine, "This machine already has 3 entries on 25/09/2026 — edit one of them instead");
  assert.ok(isLiveMessage(e.machine));
  assert.ok(!isTimeRuleMessage(e.machine), "said on the box, not toasted");
  assert.deepEqual(slotsFullErrors([entry({ date: "2026-09-26" })], full), [{}]);
  assert.deepEqual(slotsFullErrors([entry({ machine: "" })], full), [{}]);
  // A worker sheet names the worker.
  assert.match(slotsFullErrors([entry()], full, { who: () => "Asha" })[0].machine, /^Asha already has 3 entries/);
});

test("earlier blocks of the same form count toward the 3", () => {
  const two = { "m1|2026-09-25": full["m1|2026-09-25"].slice(0, 2) };
  const errs = slotsFullErrors([entry(), entry({ machineOnTime: "13:00", machineOffTime: "14:00" })], two);
  assert.deepEqual(errs[0], {});
  assert.ok(errs[1].machine);
});

test("editing: a row on its own date is one of the 3; moved onto a full date it can't go", () => {
  const home = { date: "2026-09-25", machine: "m1", machineOnTime: "08:00", machineOffTime: "10:00" };
  assert.deepEqual(slotsFullErrors([entry()], full, { editSlot: 2, saved: home }), [{}]);
  const [moved] = slotsFullErrors([entry()], full, { editSlot: 1, saved: { ...home, date: "2026-09-24" } });
  assert.equal(moved.date, "This machine already has 3 entries on 25/09/2026 — can't move this entry there");
});

test("a typed time that isn't one is said under the box before Save", () => {
  assert.ok(isLiveMessage("Enter a valid time"));
  assert.ok(!isLiveMessage("Machine ON Time is required"));
});

// A locked Planned is the machine's whole day: three entries on a 12 h lock
// are a 12 h day, not 36 h. Typed hours are each entry's own share and add up.
// The real RIVET day (11/A, 21-06-2025, RAJU), as CNC rows.
test("a locked 12 h counts once per machine per day; typed Planned adds up like the sheet", () => {
  const rivetDay = (planned, plannedLocked) => [
    { itemName: "A", totalCycleSec: 40, machineOnTime: "08:10", machineOffTime: "13:30", okQty: 197, actualQty: 197, plannedOperatorShiftHours: planned[0], plannedLocked, setupMin: 5, materialShiftingMin: 35, lunchMin: 30, otherMin: 120 },
    { itemName: "B", totalCycleSec: 20, machineOnTime: "13:30", machineOffTime: "14:30", okQty: 60, actualQty: 60, plannedOperatorShiftHours: planned[1], plannedLocked, setupMin: 5, materialShiftingMin: 10, otherMin: 20 },
    { itemName: "C", totalCycleSec: 30, machineOnTime: "14:30", machineOffTime: "15:00", okQty: 50, actualQty: 50, plannedOperatorShiftHours: planned[2], plannedLocked, setupMin: 5, materialShiftingMin: 5 },
  ];
  const close = (a, b) => assert.ok(Math.abs(a - b) < 0.006, `${a} ≈ ${b}`);

  // Typed as on the sheet (5.33 / 1 / 0.5): the paper's own figures.
  const typed = dayCalc(rivetDay([320 / 60, 1, 0.5], false))[0];
  close(typed.unreportedMin, -1.33);
  close(typed.oeeLosses, 1.0076);
  close(typed.oeeLunch, 0.464);
  close(typed.oeeLunchCot, 0.4831);

  // Locked at 12 h: 12 h for the day (720 − 176.33 effective − 235 stoppage), not 36 h.
  const locked = dayCalc(rivetDay([12, 12, 12], true))[0];
  close(locked.unreportedMin, 720 - 176.333 - 235);
  close(locked.oeeLosses, 2.93889 / (12 - 235 / 60));

  // A single locked entry reads exactly as before.
  const one = rivetDay([12], true).slice(0, 1);
  close(dayCalc(one)[0].unreportedMin, dayCalc(one.map((r) => ({ ...r, plannedLocked: undefined })))[0].unreportedMin);
  // Locked entries whose runs add up past 12 h count their runs instead.
  const long = dayCalc([
    { itemName: "A", totalCycleSec: 60, machineOnTime: "06:00", machineOffTime: "14:00", okQty: 1, actualQty: 1, plannedOperatorShiftHours: 12, plannedLocked: true },
    { itemName: "B", totalCycleSec: 60, machineOnTime: "14:00", machineOffTime: "21:00", okQty: 1, actualQty: 1, plannedOperatorShiftHours: 12, plannedLocked: true },
  ])[0];
  close(long.unreportedMin, 15 * 60 - 2); // 15 h of runs, 2 × 60 s effective
});
