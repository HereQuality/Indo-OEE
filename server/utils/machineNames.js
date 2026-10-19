const Machine = require("../models/Machine");
const MachineOperator = require("../models/MachineOperator");

/**
 * utils/machineNames.js
 * ───────────────────────
 * { machineId: machineName } for the machines the given ids name — whether each is
 * active, deactivated, or deleted from Machine Master (a deleted machine is only
 * hidden, see models/Machine.js). The sheets' machine pickers list active machines
 * only, so an entry made on any other machine needs its name from here to still
 * say which machine it was made on.
 *
 * An After Powder Coating entry has a worker (an Operator Master name) where
 * every other sheet has a machine, and that worker's id is passed here in the
 * machine's place — so an id that isn't a machine is looked up as a worker.
 */
const machineNamesFor = async (ids) => {
  const unique = [...new Set((ids || []).map(String))];
  if (!unique.length) return {};
  const machines = await Machine.find({ _id: { $in: unique } }).select("machineName").lean();
  const names = Object.fromEntries(machines.map((m) => [String(m._id), m.machineName]));
  const rest = unique.filter((id) => !names[id]);
  if (rest.length) {
    const workers = await MachineOperator.find({ _id: { $in: rest } }).select("name").lean();
    for (const w of workers) names[String(w._id)] = w.name;
  }
  return names;
};

module.exports = { machineNamesFor };
