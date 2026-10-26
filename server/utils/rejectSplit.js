const { REJECT_REASONS } = require("../models/ProductionEntry");

/**
 * utils/rejectSplit.js
 * ──────────────────────
 * The CNC sheet's quantity rules, shared by every other machine sheet's
 * controller: Rejected = Actual − OK (never taken from the client), a reject
 * reason has to be one of REJECT_REASONS, and the per-reason split keeps only
 * the reasons that cost pieces. Keep in step with client/src/utils/quantityRules.js.
 */
const fail = (message) => Object.assign(new Error(message), { status: 400 });
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

// Call from a sheet's buildFields once `set` holds the typed actualQty / okQty.
// `reasons`: the sheet's own reject reasons (BEFORE POWDER COATING has its
// own); every other sheet leaves it out and gets the CNC list.
const applyQuantities = (body, set, unset, { reasons = REJECT_REASONS } = {}) => {
  // Rejected = Actual − OK. Both are needed; when either is being cleared the
  // stored Rejected goes with it, and an OK above Actual is refused outright.
  if (body.actualQty !== undefined || body.okQty !== undefined) {
    const actual = "actualQty" in set ? set.actualQty : null;
    const ok = "okQty" in set ? set.okQty : null;
    if (actual === null || ok === null) {
      unset.rejectedQty = "";
    } else if (ok > actual) {
      throw fail("OK Quantity cannot be more than Actual Quantity");
    } else {
      set.rejectedQty = actual - ok;
      delete unset.rejectedQty;
    }
  }
  if (body.rejectReason !== undefined && set.rejectReason && !reasons.includes(set.rejectReason)) {
    throw fail(`"${set.rejectReason}" is not a valid reject reason`);
  }
  if (body.rejectBreakdown !== undefined) {
    // A blank ("" — how a cleared or status-only row is sent) is no split.
    const raw = body.rejectBreakdown === "" ? null : body.rejectBreakdown;
    if (raw !== null && (typeof raw !== "object" || Array.isArray(raw))) throw fail("rejectBreakdown must be an object");
    const split = {};
    for (const [reason, value] of Object.entries(raw || {})) {
      if (!reasons.includes(reason)) throw fail(`"${reason}" is not a valid reject reason`);
      if (isBlank(value)) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw fail(`Rejected quantity for "${reason}" must be 0 or more`);
      if (n > 0) split[reason] = n;
    }
    if (Object.keys(split).length) set.rejectBreakdown = split;
    else unset.rejectBreakdown = "";
  }
};

// For entryRuleError: a message when pieces are rejected as "Other" with no remark.
const rejectOtherError = (body) =>
  Number(body.rejectBreakdown?.Other) > 0 && isBlank(body.rejectOtherRemark)
    ? 'A remark is required when "Other" is used as a reject reason'
    : null;

// Is any reject split typed? (A row with only a split is not an empty row.)
const hasSplit = (doc) => Object.keys(doc?.rejectBreakdown || {}).length > 0;

module.exports = { applyQuantities, rejectOtherError, hasSplit };
