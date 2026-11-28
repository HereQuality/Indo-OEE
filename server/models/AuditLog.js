const mongoose = require("mongoose");

/**
 * models/AuditLog.js
 * ────────────────────
 * The permanent record of what happened in the app — the audit trail: who
 * created / edited / deleted / unlocked / marked what, and when, in every
 * module. It began as the production entries' log (every create / edit /
 * delete of an entry with each changed field's old and new value, every time
 * an entry's Availability / Performance / Quality went over 100% or came back
 * under, every Admin review decision, every change to a process's Operator
 * Planned Shift) and now takes a row from every master, setting, sign-in and
 * Not-running mark as well (utils/auditTrail.js writes them), every backup
 * taken or downloaded, and — through middlewares/auditCatchAll.middleware.js
 * — any other change made through the API that no module logged itself.
 * Shown on Administration › Logs (client pages/Logs.jsx).
 *
 * Append-only by design: the app only ever creates rows here — there is no
 * update or delete route, and the hooks below refuse both, so an ordinary
 * user can't rewrite history through the API.
 *
 * ENTITY_TYPES / ACTIONS and their labels are exported so the read API
 * (controllers/auditTrail.controller.js), the clients and the tests share one
 * list. MODULE_LABELS is also stamped on each row (`module`) so an export
 * reads right even if a label is reworded later.
 */

// Which module a row belongs to, in the order the filter lists them.
const MODULE_LABELS = {
  entry: "Data Entry",
  process: "Process Master",
  notRunning: "Not running marks",
  machine: "Machine Master",
  item: "Part Master",
  operator: "Employees",
  role: "Roles",
  permissions: "Manage Role",
  workOrder: "Work Orders",
  vendor: "Vendor Master",
  department: "Departments",
  company: "Company",
  holiday: "Company Holidays",
  weeklyOff: "Weekly Off",
  team: "Teams",
  machineOperator: "Machine Operators",
  kpiObjective: "KPI",
  companyObjective: "Company Level Objective",
  companyMonthly: "Company Level Objective (monthly)",
  summaryMail: "Summary Email",
  backup: "Database backup",
  shiftAccess: "Shift Access",
  auth: "Sign in / Sign out",
  maintenance: "Maintenance Mode",
  announcement: "Announcement",
  menu: "Menu Master",
  menuGroup: "Menu Group",
  profile: "Profile",
  page: "Pages & screens",
  ticket: "Support tickets",
  appUpdate: "App Update",
  notification: "Notifications",
  other: "Other",
};

const ACTION_LABELS = {
  create: "Created",
  update: "Edited",
  delete: "Deleted",
  unlocked: "Unlocked",
  flagged: "Over 100%",
  cleared: "Back under 100%",
  approved: "Approved",
  rejected: "Rejected",
  setting: "Setting changed",
  marked: "Marked Not running",
  unmarked: "Not running undone",
  login: "Signed in",
  loginFailed: "Sign-in failed",
  logout: "Signed out",
  passwordChange: "Password changed",
  passwordReset: "Password reset",
  impersonate: "Signed in as another user",
  blocked: "Blocked",
  unblocked: "Unblocked",
  sent: "Sent",
  import: "Imported",
  download: "Downloaded",
  view: "Opened page",
  error: "Error",
  other: "Other",
};

const ENTITY_TYPES = Object.keys(MODULE_LABELS);
const ACTIONS = Object.keys(ACTION_LABELS);

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
    // The module the record belongs to — "entry" a production entry of one of
    // the sheets, "process" a Process Master record, and so on (MODULE_LABELS).
    entityType: { type: String, enum: ENTITY_TYPES, required: true },
    // MODULE_LABELS[entityType] at the time of writing.
    module: { type: String, default: "" },
    // Which sheet's collection an entry (or Not running mark) lives in.
    sheet: { type: String, enum: ["cnc", "vmc", "spm", "rivet", "press", "contact", "trobe", "spring", "powder", "rubber", "injection", "embossing", "bpc", "printing", "rawCasting", "mfd", "finalAssembly", "mfa", null], default: null },
    // The record's id. Not required: a failed sign-in for an unknown username has none.
    entity: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Snapshots, so a log still reads correctly after the entry/machine is gone.
    machine: { type: mongoose.Schema.Types.ObjectId, default: null },
    machineName: { type: String, default: "" },
    date: { type: String, default: "" },
    label: { type: String, default: "" },
    action: { type: String, enum: ACTIONS, required: true },
    changes: {
      type: [{ field: String, label: String, from: mongoose.Schema.Types.Mixed, to: mongoose.Schema.Types.Mixed, _id: false }],
      default: [],
    },
    // Availability / Performance / Quality and the OEE figures (fractions, 1 = 100%) at the time.
    metrics: {
      availability: { type: Number, default: null },
      performance: { type: Number, default: null },
      quality: { type: Number, default: null },
      oeeLosses: { type: Number, default: undefined },
      oeeLunch: { type: Number, default: undefined },
      oeeLunchCot: { type: Number, default: undefined },
      productivity: { type: Number, default: undefined },
      productivityLunch: { type: Number, default: undefined },
    },
    // The metric(s) over 100% that triggered a review.
    flagged: { type: [{ metric: String, value: Number, _id: false }], default: undefined },
    remark: { type: String, default: "" },
    actor: { type: actorSchema, default: () => ({}) },
    // Where the request came from: the web client or the phone / tablet app, and its address.
    // "system" = no request behind it (the daily backup, a scheduled mail).
    client: { type: String, enum: ["web", "app", "system", ""], default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    // The API call that caused the row (no query string) and how it ended.
    // statusCode is 0 for rows written before the response was sent.
    method: { type: String, default: "" },
    path: { type: String, default: "" },
    statusCode: { type: Number, default: 0 },
    success: { type: Boolean, default: true },
    // Everything a person might search for, lowercased and joined: the label, who did it,
    // the remark, the machine and each change's label / old / new value.
    search: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

AuditLogSchema.index({ entityType: 1, entity: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, createdAt: -1 });
AuditLogSchema.index({ "actor.id": 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ sheet: 1, date: 1, machine: 1, createdAt: -1 });
AuditLogSchema.index({ success: 1, createdAt: -1 });

const refuse = function refuse(next) {
  next(new Error("Audit log rows can't be changed or deleted"));
};
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "deleteOne", "deleteMany", "findOneAndDelete", "findOneAndReplace"]) {
  AuditLogSchema.pre(op, refuse);
}

module.exports = mongoose.model("AuditLog", AuditLogSchema);
module.exports.MODULE_LABELS = MODULE_LABELS;
module.exports.ACTION_LABELS = ACTION_LABELS;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
module.exports.ACTIONS = ACTIONS;
