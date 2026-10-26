"use strict";
/**
 * utils/itemDiff.js
 * ───────────────────
 * What changed on a part (Item) between two saves — the rows of the Part
 * Master's edit history (models/ItemLog.js). Pure: no database. The caller does
 * the one lookup it needs (process names and Data Entry Pages) and passes it in.
 *
 * A change is { field, label, from, to }, listed in the order the Part form shows
 * the fields. Values are kept the way a person reads them: a blank is null (so ""
 * and "not set" are not a change, nor is stray whitespace), Status reads
 * Active/Inactive, a process reads as its name. Diffing against nothing gives a
 * part's whole record — {} → part is what was created, part → {} what was deleted.
 */
const { CYCLE_OP_FIELDS } = require("../models/Item");

const STATUS_ACTIVE = "Active";
const STATUS_INACTIVE = "Inactive";

// SPRING FOR PINS and AFTER POWDER COATING call their one cycle-time box by
// their own names on the Part and entry forms. A process is told apart the way
// the client does (utils/springSheet.js, utils/powderCoatingSheet.js): by its
// Data Entry Page, or by its name while it isn't linked to one.
const TOTAL_CYCLE_LABEL = "Total Cycle Time (sec)";
const CYCLE_LABELS = [
  { page: /\/spring-data-entry\/?$/, name: /\bspring\b/i, label: "Standard Time per Piece (Sec)" },
  // INJECTION MOULDING (utils/injectionSheet.js).
  { page: /\/injection-moulding-data-entry\/?$/, name: /\binjection\b/i, label: "Standard Time per Piece (Sec)" },
  // EMBOSSING (utils/embossingSheet.js).
  { page: /\/embossing-data-entry\/?$/, name: /\bembossing\b/i, label: "Standard Time per Piece (Sec)" },
  // PRINTING (utils/printingSheet.js).
  { page: /\/printing-data-entry\/?$/, name: /\bprinting\b/i, label: "Standard Time per Piece (Sec)" },
  // BEFORE POWDER COATING (utils/bpcSheet.js) — ahead of AFTER POWDER COATING,
  // whose name pattern it also matches.
  { page: /\/before-powder-coating-data-entry\/?$/, name: /before\s*powder\s*coating/i, label: "Standard Time per Piece (Sec)" },
  // FINAL ASSEMBLY (utils/finalAssemblySheet.js) — optional there (PACKING has none).
  { page: /\/final-assembly-data-entry\/?$/, name: /\bfinal\s*assembly\b/i, label: "Standard Time per Piece (Sec)" },
  { page: /\/powder-coating-data-entry\/?$/, name: /powder\s*coating/i, label: "Standard Inspection Time per Piece (Sec)" },
  // RAW CASTING (utils/rawCastingSheet.js) — an inspection sheet like AFTER POWDER COATING.
  { page: /\/raw-casting-data-entry\/?$/, name: /\braw\s*casting\b/i, label: "Standard Inspection Time per Piece (Sec)" },
  // MODULAR FRAME ASSEMBLY (utils/mfaSheet.js) — worded in its model (MFA_LABELS).
  { page: /\/modular-frame-assembly-data-entry\/?$/, name: /\bmodular\s*frame\s*assembly\b/i, label: `${require("../models/MfaEntry").MFA_LABELS.cycle} (Sec)` },
];
const cycleLabel = (processId, processNames, processPages) => {
  const page = processPages[processId] || "";
  const name = processNames[processId] || "";
  const own = CYCLE_LABELS.find((c) => (page ? c.page.test(page) : c.name.test(name)));
  return own ? own.label : TOTAL_CYCLE_LABEL;
};

// The fields worth a history row, in form order. The two "Other Operation" boxes
// share a label on the sheet; the second is told apart here as the Part form does.
const LOGGED_FIELDS = [
  { key: "itemName", label: "Part Name" },
  { key: "process", label: "Process" },
  { key: "drawingNo", label: "Drawing No." },
  { key: "setupNo", label: "Setup No." },
  { key: "programTimeMin", label: "Program Time (min)" },
  { key: "pcsPerProgram", label: "No. of Piece In One Program" },
  ...CYCLE_OP_FIELDS.map((f) => ({ key: f.key, label: f.key === "otherOp2Sec" ? "Other Operation 2 (sec)" : f.label })),
  { key: "totalCycleSec", label: TOTAL_CYCLE_LABEL },
  // Op 1…Op 5 of parts saved before the named operation boxes existed.
  { key: "cycleOpsSec", label: "Operation times, old format (sec)" },
  { key: "isActive", label: "Status" },
];

const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc) || {};
const isBlank = (v) => v === undefined || v === null || v === "" || (typeof v === "number" && Number.isNaN(v));

// A field's value in a form that compares with ===/JSON: blank → null, a process
// → its id as a string, Status → boolean, text trimmed.
const normalize = (key, v) => {
  if (key === "cycleOpsSec") {
    const ops = Array.isArray(v) ? v.map((n) => (isBlank(n) ? null : Number(n))) : [];
    return ops.length ? ops : null;
  }
  if (isBlank(v)) return null;
  if (key === "isActive") return !!v;
  if (key === "process") return String(v);
  if (typeof v === "string") return v.trim() || null;
  return v;
};

// …and the same value as the history shows it.
const present = (key, v, processNames) => {
  if (v === null) return null;
  if (key === "isActive") return v ? STATUS_ACTIVE : STATUS_INACTIVE;
  if (key === "process") return processNames[v] || "Deleted process";
  if (key === "cycleOpsSec") return v.map((n) => (n === null ? "—" : n)).join(", ");
  return v;
};

/**
 * @param {object} before  the part as it was ({} for a part that didn't exist)
 * @param {object} after   the part as it is  ({} for one that no longer does)
 * @param {Object<string,string>} processNames  process id → name, for the ids in either
 * @param {Object<string,string>} processPages  process id → its Data Entry Page, for the same ids
 */
const diffItem = (before, after, processNames = {}, processPages = {}) => {
  const a = plain(before);
  const b = plain(after);
  // The cycle time is named after the process the part is in now — or was in,
  // for one that was deleted or taken out of its process.
  const processId = normalize("process", b.process) ?? normalize("process", a.process);
  return LOGGED_FIELDS.flatMap(({ key, label }) => {
    const from = normalize(key, a[key]);
    const to = normalize(key, b[key]);
    if (JSON.stringify(from) === JSON.stringify(to)) return [];
    const shown = key === "totalCycleSec" ? cycleLabel(processId, processNames, processPages) : label;
    return [{ field: key, label: shown, from: present(key, from, processNames), to: present(key, to, processNames) }];
  });
};

// What an edit is called in the history: one that only switched Status is a
// deactivate or a restore, anything else is an update.
const updateAction = (changes) => {
  if (changes.length === 1 && changes[0].field === "isActive") return changes[0].to === STATUS_INACTIVE ? "deactivate" : "restore";
  return "update";
};

// How the part is named on its history rows.
const partLabel = (doc) => {
  const d = plain(doc);
  return { itemName: d.itemName || "", drawingNo: d.drawingNo || "", setupNo: d.setupNo || "" };
};

module.exports = { LOGGED_FIELDS, STATUS_ACTIVE, STATUS_INACTIVE, diffItem, updateAction, partLabel };
