const Machine = require("../models/Machine");
const Process = require("../models/Process");

/**
 * utils/plannedShift.js
 * ───────────────────────
 * The Operator Planned Shift an entry must use, from its machine's process
 * (Process Master). Locked — the default, and what a process saved before
 * this setting existed reads as — is the hours set on the process (12 unless an Admin changed them); unlocked means the
 * hours are typed by hand on each entry (null, nothing enforced). A machine in
 * no process also has no setting (null).
 *
 * Keep in step with client/src/utils/plannedShift.js.
 */
const LOCKED_SHIFT_HOURS = 12;

const lockedHours = (process) => {
  const h = Number(process?.plannedShiftHours);
  return Number.isFinite(h) && h > 0 && h <= 24 ? h : LOCKED_SHIFT_HOURS;
};

const settingOf = (process) => {
  if (!process) return null;
  if (process.plannedShiftLocked === false) return null;
  return { locked: true, hours: lockedHours(process) };
};

// Hours the save must use, or null when the machine's process has no setting.
const settingForMachine = async (machineId) => {
  const machine = await Machine.findById(machineId).select("process").lean();
  if (!machine?.process) return null;
  return settingOf(await Process.findById(machine.process).select("plannedShiftLocked plannedShiftHours").lean());
};

// Hours the save must use for an entry made straight on a process — the After
// Powder Coating sheet, whose entries have a worker, not a machine.
const settingForProcess = async (processId) =>
  settingOf(await Process.findById(processId).select("plannedShiftLocked plannedShiftHours").lean());

// Overrides body.plannedOperatorShiftHours with the value this entry must
// carry under `setting`: an edited entry keeps the shift it was saved with (a
// later change to the setting never rewrites it); a new one takes the
// process's locked hours. An unlocked process enforces nothing: the typed
// value stands. Left alone when the body leaves it blank (clearing a row, or a
// status-only day) and when there's no setting.
//
// It also sets body.plannedLocked — whether the hours came from the lock — so
// the day figures can count a locked shift once per machine per day (see
// plannedLocked in models/entryCommon.js). Never taken from the request.
const applySetting = (body, existing, setting) => {
  const typed = body.plannedOperatorShiftHours;
  if (typed === undefined || typed === null || String(typed).trim() === "") return;
  if (!setting) {
    body.plannedLocked = false;
    return;
  }
  const kept = existing?.plannedOperatorShiftHours;
  if (kept !== undefined && kept !== null && Number.isFinite(Number(kept))) {
    body.plannedOperatorShiftHours = Number(kept);
    // An entry saved before the flag existed: its hours came from the lock
    // when they are the lock's.
    body.plannedLocked = typeof existing.plannedLocked === "boolean" ? existing.plannedLocked : Number(kept) === setting.hours;
  } else {
    body.plannedOperatorShiftHours = setting.hours;
    body.plannedLocked = true;
  }
};

// The rule for the machine's process — every machine sheet.
const enforcePlannedShift = async (body, existing) => {
  delete body.plannedLocked;
  const typed = body.plannedOperatorShiftHours;
  if (typed === undefined || typed === null || String(typed).trim() === "") return;
  applySetting(body, existing, await settingForMachine(body.machine));
};

// The same rule for an entry saved straight on a process (After Powder Coating).
const enforcePlannedShiftForProcess = async (body, existing, processId) => {
  delete body.plannedLocked;
  const typed = body.plannedOperatorShiftHours;
  if (typed === undefined || typed === null || String(typed).trim() === "") return;
  applySetting(body, existing, await settingForProcess(processId));
};

module.exports = {
  LOCKED_SHIFT_HOURS,
  lockedHours,
  settingOf,
  settingForMachine,
  settingForProcess,
  enforcePlannedShift,
  enforcePlannedShiftForProcess,
};
