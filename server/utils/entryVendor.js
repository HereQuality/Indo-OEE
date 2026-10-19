"use strict";
/**
 * utils/entryVendor.js
 * ──────────────────────
 * The optional Vendor Name every sheet's entry can carry (entryCommon.js).
 * Vendor Master ticks the processes each vendor is used in, and a process's
 * entry form offers only those vendors — so a save checks the same: the
 * vendor must exist, be active and be ticked for the entry's process. An entry
 * that already had that very vendor stays editable after the vendor is
 * deactivated or unticked. The vendor's name is stored alongside, so the
 * entry still reads right if the vendor is renamed or removed later.
 */
const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
const Machine = require("../models/Machine");

const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
const fail = (message) => Object.assign(new Error(message), { status: 400 });

// The process a machine belongs to (Machine.process), or null.
const machineProcess = async (machineId) =>
  mongoose.isValidObjectId(machineId) ? (await Machine.findById(machineId).select("process").lean())?.process || null : null;

// { set, unset } for the entry's update from body.vendor — nothing when the
// request doesn't mention it, unset when it's blank. Throws a 400 for a vendor
// this process's form wouldn't have offered. `processOf` is the entry's process
// id, or a function that looks it up — called only when a new vendor is picked.
const vendorFields = async (body, existing, processOf) => {
  if (body.vendor === undefined) return { set: {}, unset: {} };
  if (isBlank(body.vendor)) return { set: {}, unset: { vendor: "", vendorName: "" } };
  const vendor = mongoose.isValidObjectId(body.vendor) ? await Vendor.findById(body.vendor).select("name isActive processes").lean() : null;
  if (!vendor) throw fail("Vendor not found");
  const unchanged = !!existing && String(existing.vendor) === String(body.vendor);
  if (!unchanged) {
    if (!vendor.isActive) throw fail(`Vendor ${vendor.name} is inactive`);
    const processId = typeof processOf === "function" ? await processOf() : processOf;
    if (!(vendor.processes || []).some((p) => String(p) === String(processId))) {
      throw fail(`Vendor ${vendor.name} isn't used in this process — tick the process for it in Vendor Master`);
    }
  }
  return { set: { vendor: vendor._id, vendorName: vendor.name }, unset: {} };
};

module.exports = { vendorFields, machineProcess };
