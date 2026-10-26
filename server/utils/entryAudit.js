const AuditLog = require("../models/AuditLog");
const User = require("../models/user.model");
const Operator = require("../models/Operator");
const RoleMaster = require("../models/RoleMaster");
const { machineNamesFor } = require("./machineNames");
const { STOPPAGE_KEYS } = require("../models/ProductionEntry");
const { CYCLE_OP_FIELDS, SPM_OP_FIELDS, RIVET_OP_FIELDS, SPM_REFERENCE_FIELDS } = require("../models/Item");
const { entryMetrics, metricsOver100, METRIC_LABELS } = require("./oeeMetrics");
const { actorOf, adminRecipients } = require("./adminAccess");
const { createNotificationForMany } = require("../services/notification.service");

/**
 * utils/entryAudit.js
 * ─────────────────────
 * What every sheet's saveRow / deleteRow / unlockRow does besides saving:
 *
 *  - reviewFor: works out the entry's Availability / Performance / Quality
 *    (utils/oeeMetrics.js) from what's about to be saved, and whether it now
 *    needs Admin review — any of the three above 100% → "pending". Saved in
 *    the same write as the entry itself, so the two can't disagree.
 *      · An entry already approved (or rejected) stays that way as long as
 *        the over-100% figures are exactly what was reviewed — an edit that
 *        changes none of them (say, a remark) doesn't reopen it. Any change
 *        to them sends it back to "pending".
 *      · Back at or under 100% everywhere → the review flag is cleared.
 *  - logEntrySave / logEntryDelete / logEntryUnlock: the AuditLog rows —
 *    each changed field old → new, plus "flagged"/"cleared" when the review
 *    state moves, with the figures at that moment.
 *
 * Logging never fails the save it describes: an error is reported and the
 * save goes through, the same rule ItemLog follows.
 */

const SHEET_LABELS = { cnc: "CNC", vmc: "VMC", spm: "SPM", rivet: "RIVET", press: "PRESS", contact: "CONTACT", trobe: "TROBE", spring: "SPRING FOR PINS", powder: "AFTER POWDER COATING", rubber: "RUBBER", injection: "INJECTION MOULDING", embossing: "EMBOSSING", bpc: "BEFORE POWDER COATING", printing: "PRINTING", rawCasting: "RAW CASTING" };
// MODULAR FRAME DRILLING (sheet key "mfd").
SHEET_LABELS.mfd = "MODULAR FRAME DRILLING";
// FINAL ASSEMBLY (sheet key "finalAssembly").
SHEET_LABELS.finalAssembly = "FINAL ASSEMBLY";
// MODULAR FRAME ASSEMBLY (sheet key "mfa").
SHEET_LABELS.mfa = "MODULAR FRAME ASSEMBLY";

const STOPPAGE_LABELS = {
  plannedDownMin: "Planned Down Time (min)",
  setupMin: "Setup Time (min)",
  noManPowerMin: "No Man Power (min)",
  materialShiftingMin: "Material Shifting (min)",
  noMaterialMin: "No Material (min)",
  bdMechMin: "B.D. Mech. (min)",
  bdEleMin: "B.D. Ele. (min)",
  noPowerMin: "No Power (min)",
  lunchMin: "Lunch / Rest (min)",
  otherMin: "Other (min)",
};

const FIELD_LABELS = {
  workingMode: "Machine Working Status",
  date: "Date",
  machine: "Machine No.",
  worker: "Worker Name",
  operator: "Operator",
  workingStatus: "Working Status",
  machineStatus: "Machine Working Status",
  processType: "Process",
  operation: "Operation",
  itemName: "Part Name",
  drawingNo: "Drawing No.",
  setupNo: "Setup No.",
  workOrderNo: "Work Order No.",
  totalCycleSec: "Total Cycle Time (sec)",
  programTimeMin: "Program Time (min)",
  pcsPerProgram: "No. of Piece in One Program",
  standardTimeMin: "Standard Time Taken (min)",
  pcsPerStandardTime: "No. Piece in Standard Time",
  excludedOps: "Unticked Operations",
  machineOnTime: "Machine ON Time",
  machineOffTime: "Machine OFF Time",
  settingOnTime: "Setting ON Time",
  settingOffTime: "Setting OFF Time",
  actualQty: "Actual Quantity",
  okQty: "OK Quantity",
  rejectedQty: "Rejected Quantity",
  rejectReason: "Reject Reason",
  rejectBreakdown: "Reject Reasons",
  plannedOperatorShiftHours: "Planned Operator Shift (hr)",
  remarks: "Remarks",
  rejectOtherRemark: "Remark (Reject Other)",
  otherMinRemark: "Remark (Other Downtime)",
  vendorName: "Vendor Name",
  lessCoatingQty: "Less Powder Coating",
  dotsQty: "Dots",
  missCoatingQty: "Miss Powder Coating",
  otherDefectQty: "Other Defect / Rework",
  otherActivity: "Other Activity Carried Out",
  otherActivityMin: "Other Activity (min)",
  ...STOPPAGE_LABELS,
  ...Object.fromEntries([...CYCLE_OP_FIELDS, ...SPM_OP_FIELDS, ...RIVET_OP_FIELDS, ...SPM_REFERENCE_FIELDS].map((f) => [f.key, f.label])),
};

// Where a sheet's own column heading says something else for the same field.
// RUBBER and AFTER POWDER COATING are worker sheets: their times are a
// worker's start / end, not a machine's ON / OFF.
const SHEET_FIELD_LABELS = {
  spring: { totalCycleSec: "Standard Time per Piece (sec)" },
  // INJECTION MOULDING, in its paper sheet's own words.
  injection: {
    workingMode: "Working Status",
    machineStatus: "Reasons For Not Working",
    itemName: "Item Name",
    totalCycleSec: "Standard Time per Piece (sec)",
    actualQty: "TOTAL QTY",
    okQty: "OK QTY",
    rejectedQty: "Rejected QTY",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
    remarks: "Reason/Remarks for Rejection/Rework",
  },
  // EMBOSSING — the same paper columns as INJECTION MOULDING.
  embossing: {
    workingMode: "Working Status",
    machineStatus: "Reasons For Not Working",
    itemName: "Item Name",
    totalCycleSec: "Standard Time per Piece (sec)",
    actualQty: "TOTAL QTY",
    okQty: "OK QTY",
    rejectedQty: "Rejected QTY",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
    remarks: "Remarks",
  },
  rubber: {
    machineOnTime: "Working Start Time",
    machineOffTime: "Working End Time",
    okQty: "OK Quantity",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
    otherMin: "Others (min)",
  },
  powder: {
    itemName: "Item Name",
    totalCycleSec: "Standard Inspection Time per Piece (sec)",
    machineOnTime: "Inspection Start Time",
    machineOffTime: "Inspection End Time",
    actualQty: "Total Qty",
    otherActivityMin: "Time in Other Activity (min)",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
  },
  // BEFORE POWDER COATING is kept per operator (the worker field), in its
  // paper sheet's own words; its B.D. (Breakdown) box is stored as bdMechMin.
  bpc: {
    worker: "Operator",
    itemName: "Item Name",
    totalCycleSec: "Standard Time per Piece (sec)",
    actualQty: "TOTAL QTY",
    okQty: "OK QTY",
    rejectedQty: "Rejected QTY",
    bdMechMin: "B.D. (Breakdown) (min)",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
    remarks: "Reason/Remarks",
  },
  // PRINTING is kept per operator (the worker field); its MC No. is optional
  // and logged by name. Its paper sheet's own words, its three own downtime
  // columns included.
  printing: {
    worker: "Operator",
    mcName: "MC No.",
    itemName: "Item Name",
    workingMode: "Working Status",
    machineStatus: "Reasons For Not Working",
    totalCycleSec: "Standard Time per Piece (sec)",
    actualQty: "TOTAL QTY",
    okQty: "OK QTY",
    rejectedQty: "Rejected QTY",
    askQueryQcMin: "Ask Query To QC Team (min)",
    emptyBagTuggingMin: "Empty Bag Tugging (min)",
    stockCountingMin: "Stock Counting (min)",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
    remarks: "Reason/Remarks for Rejection/Rework",
  },
  // RAW CASTING is a worker sheet on AFTER POWDER COATING's template; its
  // Types of Defects are its Rejection Master split, Total Defects its rejectedQty.
  rawCasting: {
    itemName: "Item Name",
    challanNo: "Challan No.",
    workingMode: "Working Status",
    machineStatus: "Reasons For Not Working",
    totalCycleSec: "Standard Inspection Time per Piece (sec)",
    machineOnTime: "Inspection Start Time",
    machineOffTime: "Inspection End Time",
    actualQty: "TOTAL QTY",
    okQty: "OK QTY",
    rejectedQty: "Total Defects",
    rejectBreakdown: "Types of Defects",
    otherActivity: "Other Activity Carried Out",
    otherActivityMin: "Time consume in Other Activity (min)",
    lunchMin: "Lunch / Tea / Washroom etc (min)",
    remarks: "Reason/Remarks for Rejection",
  },
};

// MODULAR FRAME DRILLING, in its paper sheet's own words. Its "Process" column
// (DRILLING, TAPPING, …) is the Part's, stored as `operation`.
SHEET_FIELD_LABELS.mfd = {
  machine: "MC NO.",
  workingMode: "Working Status",
  machineStatus: "Reasons For Not Working",
  operation: "Process",
  totalCycleSec: "Total Cycle Time (sec)",
  machineOnTime: "Machine Time ON",
  machineOffTime: "Machine Time OFF",
  settingOnTime: "Setting Time ON",
  settingOffTime: "Setting Time OFF",
  okQty: "ACTUAL OK Quantity",
  plannedDownMin: "Planned downtime (min)",
  setupMin: "Set-up Time (min)",
  noManPowerMin: "No Manpower (min)",
  lunchMin: "Lunch / Tea / Washroom etc (min)",
  otherMin: "Others (min)",
  remarks: "REMARKS",
};

// FINAL ASSEMBLY words its fields in one place, its model (FA_LABELS).
SHEET_FIELD_LABELS.finalAssembly = require("../models/FinalAssemblyEntry").FA_LABELS;

// MODULAR FRAME ASSEMBLY: a worker sheet on RAW CASTING's template; its timing
// columns are worded in one place, its model (MFA_LABELS).
const { MFA_LABELS } = require("../models/MfaEntry");
SHEET_FIELD_LABELS.mfa = {
  itemName: "Item Name",
  workingMode: "Working Status",
  machineStatus: "Reasons For Not Working",
  totalCycleSec: `${MFA_LABELS.cycle} (sec)`,
  machineOnTime: MFA_LABELS.start,
  machineOffTime: MFA_LABELS.end,
  actualQty: "TOTAL QTY",
  okQty: "OK QTY",
  rejectedQty: "Rejected QTY",
  otherActivity: "Other Activity Carried Out",
  otherActivityMin: "Time consume in Other Activity (min)",
  lunchMin: "Lunch / Tea / Washroom etc (min)",
};

const fieldLabel =(sheet, field) => SHEET_FIELD_LABELS[sheet]?.[field] || FIELD_LABELS[field] || field;

const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && !v.length);

// A stored value as a log shows it: blanks → null, dates → YYYY-MM-DD, lists
// joined, the reject split as "Reason: qty".
const present = (field, v, machineNames) => {
  if (isBlank(v)) return null;
  if (field === "date") return (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10);
  if (field === "machine" || field === "worker") return machineNames[String(v)] || String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (field === "rejectBreakdown") {
    const obj = v instanceof Map ? Object.fromEntries(v) : v;
    const parts = Object.entries(obj || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}: ${n}`);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "string") return v.trim();
  return v;
};

// Machine names (or, for After Powder Coating, worker names) by id.
const machineNamesOf = (...ids) => machineNamesFor(ids.filter(Boolean));

// What an entry is made on: its machine — or, on the After Powder Coating
// sheet, which has none, its worker. Logged in the machine's place.
const keyOf = (entry) => entry?.machine ?? entry?.worker;

// Field-by-field old → new over `fields`, in that order, labelled the way
// `sheet` itself words them.
const diff = (sheet, fields, before, after, machineNames) =>
  fields
    .map((field) => {
      const from = present(field, before?.[field], machineNames);
      const to = present(field, after?.[field], machineNames);
      return JSON.stringify(from) === JSON.stringify(to) ? null : { field, label: fieldLabel(sheet, field), from, to };
    })
    .filter(Boolean);

const dmy = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const labelOf = (sheet, entry, machineName) =>
  [SHEET_LABELS[sheet], machineName, dmy(present("date", entry?.date, {})), entry?.slot ? `Entry ${entry.slot}` : ""].filter(Boolean).join(" · ");

const round = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const sameFlags = (a = [], b = []) =>
  a.length === b.length && a.every((f) => b.some((g) => g.metric === f.metric && round(g.value) === round(f.value)));

// The entry as it will be once `set`/`unset` are applied over `before`.
const merged = (before, set, unset) => {
  const doc = { ...(before || {}), ...set };
  for (const k of Object.keys(unset || {})) delete doc[k];
  return doc;
};

// { set, unset, transition, oee, over } — the oee/review fields to write with
// this save, and whether the review state moved ("flagged" | "cleared" | null).
const reviewFor = (sheet, before, set, unset) => {
  const after = merged(before, set, unset);
  const oee = Object.fromEntries(Object.entries(entryMetrics(sheet, after)).map(([k, v]) => [k, round(v)]));
  const over = metricsOver100(oee).map((f) => ({ metric: f.metric, value: round(f.value) }));
  const prev = before?.review || null;

  if (!over.length) {
    return { set: { oee }, unset: prev ? { review: "" } : {}, transition: prev ? "cleared" : null, oee, over };
  }
  // Same figures as already flagged / reviewed — leave the review as it is.
  if (prev && sameFlags(prev.flagged, over)) return { set: { oee }, unset: {}, transition: null, oee, over };
  return {
    set: { oee, review: { status: "pending", flagged: over, flaggedAt: new Date(), remark: "" } },
    unset: {},
    transition: "flagged",
    oee,
    over,
  };
};

// Who did each entry, for the data entry sheets' "Entered By" column. The audit
// log has it exactly — the actor of the entry's create row is who entered it,
// the newest create / update row who saved it last — so that is what is used;
// an entry from before the log existed falls back to the account stamped on it
// as its last saver (updatedBy), and has no `enteredBy`. Adds
// `enteredBy` / `savedBy` ({ name, role, at }) and drops the raw updatedBy ids.
// Never fails the sheet it decorates: on an error the rows go out without them.
const withAuthors = async (sheet, rows) => {
  try {
    if (!rows.length) return rows;
    const logs = await AuditLog.find({ entityType: "entry", sheet, entity: { $in: rows.map((r) => r._id) }, action: { $in: ["create", "update"] } })
      .select("entity action actor createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .lean();
    const byEntry = {};
    for (const l of logs) {
      const e = (byEntry[String(l.entity)] ||= {});
      e.saved ||= l; // newest first
      if (l.action === "create") e.created = l;
    }
    const person = (l) => (l?.actor?.name ? { name: l.actor.name, role: l.actor.role || "", at: l.createdAt } : null);

    // Entries with no log row: whoever is stamped as their last saver.
    const stamped = rows.filter((r) => !byEntry[String(r._id)]?.saved && r.updatedBy);
    const idsOf = (model) => [...new Set(stamped.filter((r) => r.updatedByModel === model).map((r) => String(r.updatedBy)))];
    const [users, operators] = await Promise.all([
      idsOf("User").length ? User.find({ _id: { $in: idsOf("User") } }).select("name username").lean() : [],
      idsOf("Operator").length ? Operator.find({ _id: { $in: idsOf("Operator") } }).select("employeeName name username roleId").lean() : [],
    ]);
    const roles = operators.length ? await RoleMaster.find({ _id: { $in: operators.map((o) => o.roleId).filter(Boolean) } }).select("roleName").lean() : [];
    const roleName = Object.fromEntries(roles.map((r) => [String(r._id), r.roleName]));
    const known = {
      ...Object.fromEntries(users.map((u) => [String(u._id), { name: u.name || u.username || "", role: "Super Admin" }])),
      ...Object.fromEntries(operators.map((o) => [String(o._id), { name: o.employeeName || o.name || o.username || "", role: roleName[String(o.roleId)] || "" }])),
    };

    return rows.map(({ updatedBy, updatedByModel, ...row }) => {
      const e = byEntry[String(row._id)] || {};
      const fallback = updatedBy && known[String(updatedBy)]?.name ? { ...known[String(updatedBy)], at: row.updatedAt || null } : null;
      return { ...row, enteredBy: person(e.created), savedBy: person(e.saved) || fallback };
    });
  } catch (error) {
    console.error("Error adding who entered each row:", error);
    return rows.map(({ updatedBy, updatedByModel, ...row }) => row);
  }
};

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const overText = (over) => over.map((f) => `${METRIC_LABELS[f.metric]} ${pct(f.value)}`).join(", ");

const write = (row) =>
  AuditLog.create(row).catch((error) => console.error("Error writing audit log:", error));

const notifyFlagged = async (req, label, over, sheet, entryId, date) => {
  try {
    const me = String(req.user?._id || "");
    const recipients = (await adminRecipients()).filter((r) => r.id !== me);
    await createNotificationForMany(
      recipients,
      "OEE above 100% — review needed",
      `${label}: ${overText(over)}`,
      "oeeReview",
      { sheet, entry: String(entryId), date },
    );
  } catch (error) {
    console.error("Error notifying admins of an OEE review:", error);
  }
};

// After a save: the create/update row (if anything changed), plus a
// flagged/cleared row when the review state moved.
const logEntrySave = async ({ sheet, req, before, after, fields, review }) => {
  try {
    const names = await machineNamesOf(keyOf(before), keyOf(after));
    const machineName = names[String(keyOf(after))] || "";
    const base = {
      entityType: "entry",
      sheet,
      entity: after._id,
      machine: keyOf(after),
      machineName,
      date: present("date", after.date, {}),
      label: labelOf(sheet, after, machineName),
      actor: await actorOf(req),
    };
    const changes = diff(sheet, ["date", "machine", ...fields], before, after, names);
    if (!before || changes.length) await write({ ...base, action: before ? "update" : "create", changes, metrics: review?.oee || {} });
    if (review?.transition === "flagged") {
      await write({ ...base, action: "flagged", metrics: review.oee, flagged: review.over, remark: `Over 100%: ${overText(review.over)}` });
      notifyFlagged(req, base.label, review.over, sheet, after._id, base.date);
    } else if (review?.transition === "cleared") {
      await write({ ...base, action: "cleared", metrics: review.oee, remark: "Back at or under 100% after an edit — review no longer needed" });
    }
  } catch (error) {
    console.error("Error logging entry save:", error);
  }
};

const logEntryDelete = async ({ sheet, req, before, fields }) => {
  try {
    const names = await machineNamesOf(keyOf(before));
    const machineName = names[String(keyOf(before))] || "";
    await write({
      entityType: "entry",
      sheet,
      entity: before._id,
      machine: keyOf(before),
      machineName,
      date: present("date", before.date, {}),
      label: labelOf(sheet, before, machineName),
      action: "delete",
      changes: diff(sheet, ["date", "machine", ...fields], before, {}, names),
      metrics: before.oee || {},
      actor: await actorOf(req),
    });
  } catch (error) {
    console.error("Error logging entry delete:", error);
  }
};

const logEntryUnlock = async ({ sheet, req, entry, remark = "Unlocked for 24 hours past the 2-working-day lock" }) => {
  try {
    const names = await machineNamesOf(keyOf(entry));
    const machineName = names[String(keyOf(entry))] || "";
    await write({
      entityType: "entry",
      sheet,
      entity: entry._id,
      machine: keyOf(entry),
      machineName,
      date: present("date", entry.date, {}),
      label: labelOf(sheet, entry, machineName),
      action: "unlocked",
      remark,
      actor: await actorOf(req),
    });
  } catch (error) {
    console.error("Error logging entry unlock:", error);
  }
};

module.exports = {
  SHEET_LABELS,
  FIELD_LABELS,
  reviewFor,
  logEntrySave,
  logEntryDelete,
  logEntryUnlock,
  withAuthors,
  labelOf,
  machineNamesOf,
  keyOf,
  present,
  write,
  overText,
  STOPPAGE_KEYS,
};
