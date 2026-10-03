const mongoose = require("mongoose");

/**
 * models/ItemLog.js
 * ────────────────────────────
 * The Part Master's edit history: one row each time a part is created, edited,
 * deactivated, brought back or deleted — who did it, when, and the old → new
 * value of every field that changed (what counts as a change is worked out in
 * utils/itemDiff.js).
 *
 * Rows are only ever added, never edited, and they outlive the part: a deleted
 * part's history stays, so the part's name, drawing no. and setup no. are copied
 * onto each row. Values are stored the way a person reads them — a process by
 * its name, Status as Active/Inactive — so an old row still reads right after a
 * process is renamed.
 *
 *   create      every field the part was created with (from = null)
 *   update      the fields that changed
 *   deactivate  an edit whose only change was Status → Inactive (also what the
 *               first delete does)
 *   restore     an edit whose only change was Status → Active
 *   delete      every field the part had when it was removed (to = null)
 */
const ITEM_LOG_ACTIONS = ["create", "update", "deactivate", "restore", "delete"];

const ChangeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    label: { type: String, required: true },
    // A number, a string or null (blank).
    from: { type: mongoose.Schema.Types.Mixed, default: null },
    to: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const ItemLogSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: "Item", required: true },
    // What the part was called when this happened (after an edit, its new name).
    itemName: { type: String, trim: true, default: "" },
    drawingNo: { type: String, trim: true, default: "" },
    setupNo: { type: String, trim: true, default: "" },
    action: { type: String, enum: ITEM_LOG_ACTIONS, required: true },
    changes: { type: [ChangeSchema], default: [] },
    // Who did it — a Super Admin (User) or an Operator, by name as well as id so
    // the row still reads right if that account is later removed.
    actor: {
      id: { type: mongoose.Schema.Types.ObjectId },
      model: { type: String, enum: ["User", "Operator"] },
      name: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

ItemLogSchema.index({ item: 1, createdAt: -1 });
ItemLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ItemLog", ItemLogSchema);
module.exports.ITEM_LOG_ACTIONS = ITEM_LOG_ACTIONS;
