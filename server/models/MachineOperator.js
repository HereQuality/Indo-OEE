const mongoose = require("mongoose");

/**
 * Machine Operator Master
 *
 * Machine operators appear in the Production Data Entry dropdown.
 * Name is required; code is optional (used as a short identifier / badge).
 *
 * Pinned to the pre-existing "operators" collection via the explicit
 * `collection` option below so this rename (from the old model name
 * "Operator", freed up for the renamed login/RBAC model of the same name)
 * doesn't touch any existing data.
 */
const MachineOperatorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Operator name is required"],
      trim: true,
      maxlength: [100, "Operator name must be 100 characters or fewer"],
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
