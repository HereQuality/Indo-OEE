import React from "react";
import { displayDay, fmtNum, remarkParts } from "../../utils/productionSheet";
import { INJECTION_STOPPAGE_FIELDS } from "../../utils/injectionSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, hm, min, n, pct, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/injectionColumns.jsx
 * ────────────────────────────────────────────
 * The INJECTION MOULDING table's columns, left to right in the paper sheet's
 * own order and wording, in the shape ProductionEntriesTable draws (see
 * COLUMNS there for what each key means). Its sheet has no Drawing No.,
 * Setting ON/OFF, Unutilized Machine Time or Setup Efficiency columns, so
 * neither does this table; Planned Operator Shift is shown because the entry
 * carries it (Process Master's lock, or typed), and Availability /
 * Performance / Quality plus OEE Review sit where they do on every sheet.
 *
 * Hours are shown as the sheet writes them (decimal hours — 9.5 is 9 h 30 min).
 * Ideal Quantity is the sheet's own, not rounded down (2 decimals). Unreported
 * Time and the three OEE figures are each entry's own (utils/injectionSheet.js
 * — combined across the machine's day only on Process Master's 12 h lock), so
 * unlike most sheets they aren't merged across a machine's day.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// Decimal hours, as the sheet writes them.
const hours = (v) => dash(fmtNum(v));

// Working Status / Reasons For Not Working: a Non Working day names its
// reasons — the ticked ones, then whatever the remarks say (W.OFF and the like).
const workingStatus = (r) => {
  if (r.workingMode === "Non Working") return "Non Working";
  const status = String(r.workingStatus || "").trim();
  return status && status !== "PRESENT" ? status : "Working";
};
const notWorkingReasons = (r) =>
  r.workingMode === "Non Working" ? dash([...(r.machineStatus || []), String(r.remarks || "").trim()].filter(Boolean).join(", ")) : "—";

export const INJECTION_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "MC No.",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || "—",
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "itemName", label: "Item Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { key: "operator", label: "Operator", get: (r) => dash(r.operator), tone: "operator" },
  { key: "workingStatus", label: "Working Status", get: workingStatus, align: "text-center" },
  { key: "notWorkingReasons", label: "Reasons For Not Working", get: notWorkingReasons, headStyle: { minWidth: 150 } },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Machine Shift Time (Hours)", get: (r, c) => hours(c.shiftHours), align: "text-center", tone: "calc" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Standard Time per Piece (in Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "totalQty", label: "TOTAL QTY.", get: (r, c) => n(c.actualQty), align: "text-center" },
  { key: "okQty", label: "OK QTY.", get: (r) => min(r.okQty), align: "text-center" },
  { key: "rejectedQty", label: "Rejected QTY", get: (r, c) => n(c.rejectedQty), align: "text-center", tone: "calc" },
  { key: "pctOk", label: "Ok Quantity (%)", get: (r, c) => pct(c.pctOk), align: "text-center", tone: "calc" },
  { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQtyExact), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "Ideal Quantity/Hours", get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "downtime",
    label: "Idle Time (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total Idle Time (Min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-center",
      tone: "calc",
    },
    columns: INJECTION_STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: "Effective Machine Run Time (hours)", get: (r, c) => hours(c.effectiveHours), align: "text-center", tone: "calc" },
  { key: "unreported", label: "Unreported Time (min)", get: (r, c, d) => n(d.unreportedMin), align: "text-center", tone: "day" },
  { key: "oeeLosses", label: "OEE considering losses (%)", get: (r, c, d) => pct(d.oeeLosses), align: "text-center", tone: "oee" },
  { key: "oeeLunch", label: "OEE not considering losses but lunch (%)", get: (r, c, d) => pct(d.oeeLunch), align: "text-center", tone: "oee" },
  {
    key: "oeeLunchCot",
    label: "OEE not considering losses but lunch and COT (%)",
    get: (r, c, d) => pct(d.oeeLunchCot),
    align: "text-center",
    tone: "oee",
  },
  ...APQ_COLUMNS,
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Reason/Remarks for Rejection/ Rework",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
