const mongoose = require("mongoose");

/**
 * models/WorkOrder.js
 * ────────────────────────────
 * A work order: its Work Order No. and the part (see models/Item.js) it makes.
 * A data entry sheet that offers work orders (the VMC sheet) lets the operator
 * pick the work order instead of hunting for the part — the part's Drawing No.,
 * Setup No. and program then fill in from it.
 *
 * An entry keeps its own copy of the Work Order No. (`workOrderNo`) next to the
 * link, so renumbering or removing a work order here never rewrites entries
 * that were already saved.
 */
const WorkOrderSchema = new mongoose.Schema(
  {
    workOrderNo: {
      type: String,
      required: [true, "Work Order No. is required"],
      trim: true,
      maxlength: [40, "Work Order No. must be 40 characters or fewer"],
    },
    // The part this work order makes — decides which data entry page offers it
    // (a sheet lists the work orders of the parts it runs).
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: [true, "Part is required"],
    },
    // Optional: how many pieces the work order is for.
    orderQty: { type: Number, min: [0, "Order Quantity cannot be negative"] },
    remarks: { type: String, trim: true, maxlength: [300, "Remarks must be 300 characters or fewer"], default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// "wo-101" and "WO-101" are the same work order.
WorkOrderSchema.index({ workOrderNo: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.model("WorkOrder", WorkOrderSchema);
