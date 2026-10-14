/**
 * utils/plannedShift.js
 * ───────────────────────
 * The Operator Planned Shift a machine's entries must use, from its process
 * (Process Master): locked — the default — is a fixed 12 hours; unlocked
 * (or no process) is null: the hours are typed by hand on each entry.
 *
 * Keep in step with server/utils/plannedShift.js, which enforces this on save.
 */
export const LOCKED_SHIFT_HOURS = 12;

export const shiftSettingOf = (process) => {
  if (!process) return null;
  if (process.plannedShiftLocked === false) return null;
  return { locked: true, hours: LOCKED_SHIFT_HOURS };
};

// The setting for one machine id, given the machine and process lists the
// entry pages already load.
export const shiftSettingForMachine = (machineId, machines = [], processes = []) => {
  const machine = machines.find((m) => String(m._id) === String(machineId));
  if (!machine?.process) return null;
  return shiftSettingOf(processes.find((p) => String(p._id) === String(machine.process)));
};
