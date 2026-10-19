const mongoose = require("mongoose");

/**
 * models/Vendor.js
 * ────────────────────────────
 * The vendor list behind the entry forms' type-to-search "Vendor Name" box —
 * a name, the processes it is used in, and an active flag. Modelled on
 * models/MachineOperator.js. A process's form shows the Vendor Name box only
 * while at least one active vendor is ticked for that process, and offers
 * just those vendors.
 *
 * Pinned to its own "vendors" collection via the explicit `collection`
 * option below, so the name never depends on Mongoose's pluralising.
 */
const VendorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Vendor name is required"],
      trim: true,
      maxlength: [100, "Vendor name must be 100 characters or fewer"],
    },
    // The processes whose entry forms offer this vendor. At least one; a vendor
    // in no process is offered nowhere.
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
  { timestamps: true, collection: "vendors" },
);

module.exports = mongoose.model("Vendor", VendorSchema);
