const mongoose = require("mongoose");

/**
 * models/AuditLog.js
 * ────────────────────
 * The permanent record of what happened to production entries and process
 * settings: every create / edit / delete of an entry (with each changed
 * field's old and new value), every time an entry's Availability /
 * Performance / Quality goes over 100% (or comes back under), every Admin
 * review decision, and every change to a process's Operator Planned Shift.
 *
 * Append-only by design: the app only ever creates rows here — there is no
 * update or delete route, and the hooks below refuse both, so an ordinary
 * user can't rewrite history through the API.
 */
const actorSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId },
    model: { type: String, enum: ["User", "Operator"] },
    name: { type: String, default: "" },
    role: { type: String, default: "" },
  },
  { _id: false },
);

const AuditLogSchema = new mongoose.Schema(
  {
    // "entry" — a production entry of one of the sheets; "process" — a Process
    // Master record (its Operator Planned Shift setting).
    entityType: { type: String, enum: ["entry", "process"], required: true },
    // Which sheet's collection an entry lives in.
    sheet: { type: String, enum: ["cnc", "vmc", "spm", "rivet", "press", "contact", "trobe", "spring", "powder", "rubber", "injection", "embossing", "bpc", "printing", "rawCasting", "mfd", "finalAssembly", "mfa", null], default: null },
    entity: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Snapshots, so a log still reads correctly after the entry/machine is gone.
    machine: { type: mongoose.Schema.Types.ObjectId, default: null },
    machineName: { type: String, default: "" },
    date: { type: String, default: "" },
    label: { type: String, default: "" },
    action: {
      type: String,
      enum: ["create", "update", "delete", "flagged", "cleared", "approved", "rejected", "unlocked", "setting"],
      required: true,
    },
    changes: {
      type: [{ field: String, label: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed, _id: false }],
      default: [],
    },
    // Availability / Performance / Quality (fractions, 1 = 100%) at the time.
    metrics: {
      availability: { type: Number, default: null },
      performance: { type: Number, default: null },
      quality: { type: Number, default: null },
    },
    // The metric(s) over 100% that triggered a review.
    flagged: { type: [{ metric: String, value: Number, _id: false }], default: undefined },
    remark: { type: String, default: "" },
    actor: { type: actorSchema, default: () => ({}) },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ entityType: 1, entity: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });

const refuse = function refuse(next) {
  next(new Error("Audit log rows can't be changed or deleted"));
};
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete", "findOneAndReplace"]) {
  AuditLogSchema.pre(op, refuse);
}

module.exports = mongoose.model("AuditLog", AuditLogSchema);
