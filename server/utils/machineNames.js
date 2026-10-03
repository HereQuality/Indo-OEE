const Machine = require("../models/Machine");

/**
 * utils/machineNames.js
 * ───────────────────────
 * { machineId: machineName } for the machines the given ids name — whether each is
 * active, deactivated, or deleted from Machine Master (a deleted machine is only
 * hidden, see models/Machine.js). The sheets' machine pickers list active machines
 * only, so an entry made on any other machine needs its name from here to still
 * say which machine it was made on.
 */
const machineNamesFor = async (ids) => {
  const unique = [...new Set((ids || []).map(String))];
  if (!unique.length) return {};
  const machines = await Machine.find({ _id: { $in: unique } }).select("machineName").lean();
  return Object.fromEntries(machines.map((m) => [String(m._id), m.machineName]));
};

module.exports = { machineNamesFor };
