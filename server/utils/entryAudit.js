const AuditLog = require("../models/AuditLog");
const Machine = require("../models/Machine");
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

const SHEET_LABELS = { cnc: "CNC", vmc: "VMC", spm: "SPM", rivet: "RIVET", press: "PRESS", contact: "CONTACT" };

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
  ...STOPPAGE_LABELS,
  ...Object.fromEntries([...CYCLE_OP_FIELDS, ...SPM_OP_FIELDS, ...RIVET_OP_FIELDS, ...SPM_REFERENCE_FIELDS].map((f) => [f.key, f.label])),
};

const isBlank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && !v.length);

// A stored value as a log shows it: blanks → null, dates → YYYY-MM-DD, lists
// joined, the reject split as "Reason: qty".
const present = (field, v, machineNames) => {
  if (isBlank(v)) return null;
  if (field === "date") return (v instanceof Date ? v : new Date(v)).toISOString().slice(0, 10);
  if (field === "machine") return machineNames[String(v)] || String(v);
  if (Array.isArray(v)) return v.join(", ");
  if (field === "rejectBreakdown") {
    const obj = v instanceof Map ? Object.fromEntries(v) : v;
    const parts = Object.entries(obj || {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => `${k}: ${n}`);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "string") return v.trim();
  return v;
};

const machineNamesOf = async (...ids) => {
  const list = ids.filter(Boolean).map(String);
  if (!list.length) return {};
  const rows = await Machine.find({ _id: { $in: [...new Set(list)] } }).select("machineName").lean();
  return Object.fromEntries(rows.map((m) => [String(m._id), m.machineName]));
};

// Field-by-field old → new over `fields`, in that order.
const diff = (fields, before, after, machineNames) =>
  fields
    .map((field) => {
      const from = present(field, before?.[field], machineNames);
      const to = present(field, after?.[field], machineNames);
      return JSON.stringify(from) === JSON.stringify(to) ? null : { field, label: FIELD_LABELS[field] || field, from, to };
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

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const overText = (over) => over.map((f) => `${METRIC_LABELS[f.metric]} ${pct(f.value)}`).join(", ");

const write = (row) =>
  AuditLog.create(row).catch((error) => console.error("Error writing audit log:", error));

const notifyFlagged = async (req, label, over, sheet, entryId) => {
  try {
    const me = String(req.user?._id || "");
    const recipients = (await adminRecipients()).filter((r) => r.id !== me);
    await createNotificationForMany(
      recipients,
      "OEE above 100% — review needed",
      `${label}: ${overText(over)}`,
      "oeeReview",
      { sheet, entry: String(entryId) },
    );
  } catch (error) {
    console.error("Error notifying admins of an OEE review:", error);
  }
};

// After a save: the create/update row (if anything changed), plus a
// flagged/cleared row when the review state moved.
const logEntrySave = async ({ sheet, req, before, after, fields, review }) => {
  try {
    const names = await machineNamesOf(before?.machine, after?.machine);
    const machineName = names[String(after.machine)] || "";
    const base = {
      entityType: "entry",
      sheet,
      entity: after._id,
      machine: after.machine,
      machineName,
      date: present("date", after.date, {}),
      label: labelOf(sheet, after, machineName),
      actor: await actorOf(req),
    };
    const changes = diff(["date", "machine", ...fields], before, after, names);
    if (!before || changes.length) await write({ ...base, action: before ? "update" : "create", changes, metrics: review?.oee || {} });
    if (review?.transition === "flagged") {
      await write({ ...base, action: "flagged", metrics: review.oee, flagged: review.over, remark: `Over 100%: ${overText(review.over)}` });
      notifyFlagged(req, base.label, review.over, sheet, after._id);
    } else if (review?.transition === "cleared") {
      await write({ ...base, action: "cleared", metrics: review.oee, remark: "Back at or under 100% after an edit — review no longer needed" });
    }
  } catch (error) {
    console.error("Error logging entry save:", error);
  }
};

const logEntryDelete = async ({ sheet, req, before, fields }) => {
  try {
    const names = await machineNamesOf(before.machine);
    const machineName = names[String(before.machine)] || "";
    await write({
      entityType: "entry",
      sheet,
      entity: before._id,
      machine: before.machine,
      machineName,
      date: present("date", before.date, {}),
      label: labelOf(sheet, before, machineName),
      action: "delete",
      changes: diff(["date", "machine", ...fields], before, {}, names),
      metrics: before.oee || {},
      actor: await actorOf(req),
    });
  } catch (error) {
    console.error("Error logging entry delete:", error);
  }
};

const logEntryUnlock = async ({ sheet, req, entry }) => {
  try {
    const names = await machineNamesOf(entry.machine);
    const machineName = names[String(entry.machine)] || "";
    await write({
      entityType: "entry",
      sheet,
      entity: entry._id,
      machine: entry.machine,
      machineName,
      date: present("date", entry.date, {}),
      label: labelOf(sheet, entry, machineName),
      action: "unlocked",
      remark: "Unlocked for 24 hours past the 2-working-day lock",
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
  labelOf,
  machineNamesOf,
  present,
  write,
  overText,
  STOPPAGE_KEYS,
};
