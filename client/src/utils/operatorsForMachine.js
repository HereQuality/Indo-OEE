/**
 * utils/operatorsForMachine.js
 * ──────────────────────────────
 * The operators an entry form offers for one machine: those assigned (Operator
 * Master) to the machine's process, plus any not assigned to a process yet.
 * No machine picked, or a machine in no process, offers everyone.
 */
export const operatorsForMachine = (operators = [], machines = [], machineId) => {
  const machine = machines.find((m) => String(m._id) === String(machineId));
  const process = machine?.process && String(machine.process._id || machine.process);
  if (!process) return operators;
  return operators.filter((o) => !o.processes?.length || o.processes.some((p) => String(p._id || p) === process));
};
