const mongoose = require("mongoose");

/**
 * models/MachineOperator.js
 * ────────────────────────────
 * The shop-floor operator list behind Production Data Entry's "Operator"
 * dropdown. Deliberately separate from models/Operator.js, which owns the
 * platform's people/login records (employeeCode, departments, roles,
 * password) — a MachineOperator is just a name on the shop floor and never
 * logs in, so the two are not interchangeable.
 *
 * Pinned to the pre-existing (empty, unused) "operators" collection — the
 * old MachineOperator model's own name, from before it and this page were
 * removed — via the explicit `collection` option below, so this restores
 * cleanly without colliding with models/Operator.js's "employees" collection.
 */
const MachineOperatorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Operator name is required"],
      trim: true,
      maxlength: [100, "Operator name must be 100 characters or fewer"],
    },
    // The processes this operator works in. The entry forms only offer the
    // operator on machines of these processes. Empty (an operator saved before
    // this field existed) means "not assigned yet": offered everywhere.
    processes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Process" }],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
  },
  { timestamps: true, collection: "operators" },
);

module.exports = mongoose.model("MachineOperator", MachineOperatorSchema);
