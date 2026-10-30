const mongoose = require("mongoose");

/**
 * models/ShiftLockAccess.js
 * ───────────────────────────
 * Who may lock / unlock a process's Operator Planned Shift and change its
 * hours — a single document for the whole app (one company), edited by the
 * Super Admin in Production › Processes. Until a Super Admin saves it, the old
 * rule applies (Super Admin or a Full access user); once saved, only the Super
 * Admin and the Operators listed here, or whose role is listed, may.
 */
const ShiftLockAccessSchema = new mongoose.Schema(
  {
    operators: [{ type: mongoose.Schema.Types.ObjectId, ref: "Operator" }],
    roles: [{ type: mongoose.Schema.Types.ObjectId, ref: "RoleMaster" }],
  },
  { timestamps: true },
);

module.exports = mongoose.model("ShiftLockAccess", ShiftLockAccessSchema);
