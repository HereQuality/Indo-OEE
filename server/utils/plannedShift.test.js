// The Operator Planned Shift rule (utils/plannedShift.js) as a process is
// locked, unlocked and locked again — what every sheet's saveRow applies, with
// Machine / Process stood in for (no database is touched):  node --test utils/
const test = require("node:test");
const assert = require("node:assert/strict");

const Machine = require("../models/Machine");
const Process = require("../models/Process");
const { enforcePlannedShift, enforcePlannedShiftForProcess } = require("./plannedShift");

const MACHINE = "64b0c0ffee0000000000bbbb";
const PROCESS = "64b0c0ffee0000000000cccc";
// The machine's process as Process Master has it right now.
let setting = null;

const found = (doc) => ({ select: () => ({ lean: async () => doc }) });
const originals = { machine: Machine.findById, process: Process.findById };
test.before(() => {
  Machine.findById = () => found({ _id: MACHINE, process: PROCESS });
  Process.findById = () => found(setting);
});
test.after(() => {
  Machine.findById = originals.machine;
  Process.findById = originals.process;
});

// The hours a save ends up with: `typed` as the form sent it, `saved` the
// entry's own hours before this save (undefined for a new entry).
const save = async (typed, saved) => {
  const body = { machine: MACHINE, plannedOperatorShiftHours: typed };
  await enforcePlannedShift(body, saved === undefined ? null : { plannedOperatorShiftHours: saved });
  return body.plannedOperatorShiftHours;
};

const SHEET = 10.416667; // 10:25 typed as 10.25 — the Machine Shift on the sheet

test("locked at 12 h: a new entry gets 12 h, whatever was typed", async () => {
  setting = { plannedShiftLocked: true, plannedShiftHours: 12 };
  assert.equal(await save(SHEET), 12);
});

test("still locked: editing a saved entry keeps its 12 h — a typed change is ignored", async () => {
  setting = { plannedShiftLocked: true, plannedShiftHours: 12 };
  assert.equal(await save(SHEET, 12), 12);
});

test("unlocked: editing that entry takes the hours typed, so it can match the sheet", async () => {
  setting = { plannedShiftLocked: false, plannedShiftHours: 12 };
  assert.equal(await save(SHEET, 12), SHEET);
  assert.equal(await save(12, 12), 12, "left as it was, it stays 12 h");
});

test("unlocked: a new entry takes the hours typed", async () => {
  setting = { plannedShiftLocked: false, plannedShiftHours: 12 };
  assert.equal(await save(SHEET), SHEET);
});

test("locked again: an entry edited while unlocked keeps its own hours, not the lock's", async () => {
  setting = { plannedShiftLocked: true, plannedShiftHours: 12 };
  assert.equal(await save(12, SHEET), SHEET);
});

test("changing the locked hours never rewrites a saved entry; only new ones take them", async () => {
  setting = { plannedShiftLocked: true, plannedShiftHours: 8 };
  assert.equal(await save(8, 12), 12);
  assert.equal(await save(12), 8);
});

// After Powder Coating has no machine: the same rule, read straight off its process.
const saveOnProcess = async (typed, saved) => {
  const body = { plannedOperatorShiftHours: typed };
  await enforcePlannedShiftForProcess(body, saved === undefined ? null : { plannedOperatorShiftHours: saved }, PROCESS);
  return body.plannedOperatorShiftHours;
};

test("an entry made straight on a process follows that process's lock the same way", async () => {
  setting = { plannedShiftLocked: true, plannedShiftHours: 12 };
  assert.equal(await saveOnProcess(1), 12, "new, locked → 12 h");
  assert.equal(await saveOnProcess(1, 12), 12, "edited, locked → keeps its 12 h");
  setting = { plannedShiftLocked: false, plannedShiftHours: 12 };
  assert.equal(await saveOnProcess(1, 12), 1, "edited, unlocked → the hours typed");
});
