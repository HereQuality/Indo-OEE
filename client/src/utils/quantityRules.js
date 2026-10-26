import { REJECT_REASONS } from "./productionSheet";
import { cleanSplit } from "./entryValidation";

/**
 * utils/quantityRules.js
 * ────────────────────────
 * The CNC sheet's Production Master / Rejection Master rules, shared by every
 * other machine sheet so they read and save quantities the same way: Actual and
 * OK Quantity are typed, Rejected = Actual − OK, and the Rejection Master split
 * has to account for every rejected piece. Mirrored on the server by
 * server/utils/rejectSplit.js — keep the two in step.
 */
const num = (v) => (v === "" || v === null || v === undefined ? null : Number(v));
const isNum = (v) => v !== null && Number.isFinite(v);
const blank = (v) => v === "" || v === null || v === undefined || String(v).trim() === "";

// Fills errors.actualQty / okQty / rejectBreakdown / rejectOtherRemark for one
// block. `calc` is the sheet's own row calc (for Ideal Quantity); `capByIdeal`
// is false on a sheet that doesn't stop Actual at Ideal (RUBBER).
export const validateQuantities = (v, calc, errors, { capByIdeal = true } = {}) => {
  const actual = num(v.actualQty);
  if (blank(v.actualQty)) errors.actualQty = "Actual Quantity is required";
  else if (!Number.isFinite(actual) || actual < 0) errors.actualQty = "Must be 0 or more";
  else if (capByIdeal && isNum(calc.idealQty) && actual > calc.idealQty) {
    errors.actualQty = `Actual can't be more than Ideal Quantity (${calc.idealQty})`;
  }

  const ok = num(v.okQty);
  if (blank(v.okQty)) errors.okQty = "OK Quantity is required";
  else if (!Number.isFinite(ok) || ok < 0) errors.okQty = "Must be 0 or more";
  else if (isNum(actual) && ok > actual) errors.okQty = `OK can't be more than Actual Quantity (${actual})`;

  const rejectedKnown = isNum(actual) && isNum(ok) && ok <= actual;
  const rejected = rejectedKnown ? actual - ok : 0;
  const split = cleanSplit(v.rejectBreakdown);
  const splitTotal = Object.values(split).reduce((s, n) => s + n, 0);
  if (Object.values(v.rejectBreakdown || {}).some((n) => !blank(n) && (!Number.isFinite(Number(n)) || Number(n) < 0))) {
    errors.rejectBreakdown = "Rejected quantities must be 0 or more";
  } else if (rejectedKnown && splitTotal < rejected) {
    errors.rejectBreakdown = `${rejected - splitTotal} of ${rejected} rejected piece(s) still have no reason — the boxes must add up to the rejected quantity`;
  } else if (rejectedKnown && splitTotal > rejected) {
    errors.rejectBreakdown =
      rejected > 0
        ? `Split is ${splitTotal - rejected} more than the ${rejected} rejected — the boxes must add up to the rejected quantity`
        : "Nothing was rejected (Actual − OK is 0), so these boxes should be empty";
  }
  if (split.Other > 0 && blank(v.rejectOtherRemark)) {
    errors.rejectOtherRemark = 'Remark is required when "Other" is a reject reason';
  }
};

// Form values for a saved record's quantities. A record saved before Actual
// existed has only OK and Rejected: Actual is their sum, and its rejected
// pieces go against its single reason (or none) so editing it loses nothing.
// `reasons`: the sheet's own reject reasons (BEFORE POWDER COATING has its
// own — utils/bpcSheet.js); every other sheet leaves it out: the CNC list.
export const quantityFormValues = (row, reasons = REJECT_REASONS) => {
  const ok = num(row.okQty);
  const rej = num(row.rejectedQty);
  const stored = num(row.actualQty);
  const actual = isNum(stored) ? stored : isNum(ok) || isNum(rej) ? (ok || 0) + (rej || 0) : "";
  const split = (() => {
    const s = row.rejectBreakdown;
    if (s && Object.keys(s).length) return Object.fromEntries(Object.entries(s).filter(([r]) => reasons.includes(r)));
    return row.rejectReason && reasons.includes(row.rejectReason) && isNum(rej) && rej > 0 ? { [row.rejectReason]: rej } : {};
  })();
  return { actualQty: actual, rejectBreakdown: split };
};

// Request-body fields for the split. rejectedQty is never sent — the server derives it.
export const rejectPayload = (v) => {
  const split = cleanSplit(v.rejectBreakdown);
  const topReason = Object.entries(split).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    rejectBreakdown: split,
    rejectReason: topReason,
    // A remark belongs only to an "Other" that is still in use.
    rejectOtherRemark: split.Other > 0 ? String(v.rejectOtherRemark ?? "").trim() : "",
  };
};

export const hasRejectData = (v) =>
  Object.values(v.rejectBreakdown || {}).some((n) => n !== "" && n !== undefined && n !== null && Number(n) !== 0);
