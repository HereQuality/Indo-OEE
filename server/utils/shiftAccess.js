const mongoose = require("mongoose");
const ShiftLockAccess = require("../models/ShiftLockAccess");
const { isAdminUser } = require("./adminAccess");

/**
 * utils/shiftAccess.js
 * ──────────────────────
 * May this request change a process's Operator Planned Shift (the lock and the
 * hours)? Super Admin always. Before a Super Admin has picked anybody, the
 * older rule stands (a Full access user may too). Once a list is saved, only
 * the Operators on it, or those whose role is on it, may.
 */
const isSuperAdmin = (req) => req.user?.roleType === "SuperAdmin";

const canChangeShift = async (req) => {
  if (isSuperAdmin(req)) return true;
  const setting = await ShiftLockAccess.findOne().select("operators roles").lean();
  if (!setting) return isAdminUser(req);
  const me = String(req.user?._id || "");
  const role = String(req.user?.roleId?._id || req.user?.roleId || "");
  return (!!me && (setting.operators || []).some((id) => String(id) === me)) || (!!role && (setting.roles || []).some((id) => String(id) === role));
};

const validOperatorIds = (ids) => Array.isArray(ids) && ids.every((id) => mongoose.isValidObjectId(id));

module.exports = { canChangeShift, isSuperAdmin, validOperatorIds };
