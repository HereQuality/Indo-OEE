"use strict";

const Machine = require("../models/Machine");

/**
 * Resolves the `machine` field of a ProductionEntry query from the
 * `machine`/`process` filter params used by the Dashboard and OEE reports.
 *
 * Precedence: an explicit machine id is always most specific and wins.
 * Otherwise a process id is resolved to the set of machines tagged with
 * that process. Neither given -> no filter (all entries).
 */
async function resolveMachineFilter({ machine, process }) {
  if (machine) return machine;
  if (process) {
    const machineIds = await Machine.find({ processes: process }).distinct("_id");
    return { $in: machineIds };
  }
  return undefined;
}

module.exports = { resolveMachineFilter };
