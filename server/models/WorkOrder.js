const mongoose = require("mongoose");

/**
 * models/WorkOrder.js
 * ────────────────────────────
 * A work order: its Work Order No., the part (see models/Item.js) it makes, a
 * description of that part, the customer, how many pieces and when they ship.
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
    // Who the work order is for — optional.
    customerName: {
      type: String,
      trim: true,
      maxlength: [120, "Customer Name must be 120 characters or fewer"],
      default: "",
    },
    partDescription: {
      type: String,
      trim: true,
      required: [true, "Part Description is required"],
      maxlength: [300, "Part Description must be 300 characters or fewer"],
    },
    // How many pieces the work order is for — a whole number, at least 1.
    orderQty: {
      type: Number,
      required: [true, "Quantity is required"],
      min: [1, "Quantity must be at least 1"],
      validate: { validator: Number.isInteger, message: "Quantity must be a whole number" },
    },
    // The day the order is due to be dispatched — stored at UTC midnight.
    dispatchDate: { type: Date, required: [true, "Dispatch Date is required"] },
    remarks: { type: String, trim: true, maxlength: [300, "Remarks must be 300 characters or fewer"], default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// "wo-101" and "WO-101" are the same work order.
WorkOrderSchema.index({ workOrderNo: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

module.exports = mongoose.model("WorkOrder", WorkOrderSchema);
