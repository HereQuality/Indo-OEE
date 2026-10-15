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

// Overrides req.body.plannedOperatorShiftHours with the value this entry must
// carry: an edited entry keeps the shift it was saved with (a later change to
// the setting never rewrites it); a new one takes the process's locked hours.
// An unlocked process enforces nothing: the typed value stands. Left alone when the body leaves it blank (clearing a row, or a
// status-only day) and when the machine has no process.
const enforcePlannedShift = async (body, existing) => {
  const typed = body.plannedOperatorShiftHours;
  if (typed === undefined || typed === null || String(typed).trim() === "") return;
  const setting = await settingForMachine(body.machine);
  if (!setting) return;
  const kept = existing?.plannedOperatorShiftHours;
  body.plannedOperatorShiftHours = kept !== undefined && kept !== null && Number.isFinite(Number(kept)) ? Number(kept) : setting.hours;
};

module.exports = { LOCKED_SHIFT_HOURS, lockedHours, settingOf, settingForMachine, enforcePlannedShift };
