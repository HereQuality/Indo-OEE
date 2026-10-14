/**
 * utils/workingMode.js
 * ──────────────────────
 * Machine Working Status on every entry form is "Working" (the normal entry)
 * or "Non Working" (the machine did not run: only the day, machine, operator,
 * reason and remarks are recorded). "Working" is the default and is stored as
 * nothing at all, so older entries and untouched forms are unchanged; only
 * "Non Working" is written to the entry.
 */
const WORKING_MODES = ["Working", "Non Working"];
const NON_WORKING = "Non Working";

const isNonWorking = (body) => String(body?.workingMode ?? "").trim() === NON_WORKING;

// What a Non Working entry keeps; everything else is blanked before it is saved.
const KEPT = ["_id", "date", "machine", "slot", "operator", "workingMode", "workingStatus", "machineStatus", "remarks"];

const nonWorkingBody = (body) => {
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (KEPT.includes(k)) out[k] = v;
    else if (Array.isArray(v)) out[k] = [];
    else if (v && typeof v === "object") out[k] = {};
    else out[k] = k === "item" ? null : "";
  }
  return out;
};

module.exports = { WORKING_MODES, NON_WORKING, isNonWorking, nonWorkingBody };
