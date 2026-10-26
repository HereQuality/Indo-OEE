import React from "react";
import { STOPPAGE_FIELDS, REJECT_REASONS, displayDay, remarkParts } from "../../utils/productionSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, MACHINE_STATUS_COLUMN, RemarkCell, WithRemark, dash, hm, min, n, pct, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/trobeColumns.jsx
 * ────────────────────────────────────────────
 * The Trobe Data Entry table's columns, left to right in the sheet's own
 * order, in the shape ProductionEntriesTable draws (see COLUMNS there for what
 * each key means) — the plain CNC column set (Working Status,
 * Ideal Quantity/Hours included), but with Actual OK/Rejected
 * Quantity typed directly (RIVET's pattern, no reject reason split) and no
 * named operation breakdown: Total Cycle Time is the entry's own figure,
 * prefilled from the Part.
 *
 * Unlike the CNC table (which drops Planned Down Time — no box on its form —
 * and reorders Lunch / Rest first), Trobe's own stoppage columns are
 * STOPPAGE_FIELDS exactly as given, in its own sheet order: Planned Down
 * Time … Other, Lunch / Rest second-to-last.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

export const TROBE_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "Machine",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || "—",
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "operator", label: "Operator", get: (r) => dash(r.operator), tone: "operator" },
  MACHINE_STATUS_COLUMN,
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo), headStyle: { minWidth: 130 } },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Total Cycle Time (Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Machine Shift Time (hr:min)", get: (r, c) => hm(c.shiftHours), align: "text-center", tone: "calc" },
  { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "Ideal Quantity/Hours", get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "actualQty", label: "Actual Quantity", get: (r, c) => n(c.actualQty), align: "text-center", tone: "calc" },
  { key: "okQty", label: "Actual OK Quantity", get: (r) => min(r.okQty), align: "text-center" },
  {
    // Rejected = Actual − OK (calc); expands to the Rejection Master split, "Other" carrying its remark.
    key: "rejectedQty",
    label: "Rejected Quantity",
    expandable: true,
    summary: { key: "rejectedQty", label: "Rejected Quantity", get: (r, c) => n(c.rejectedQty), align: "text-center", tone: "calc" },
    columns: REJECT_REASONS.map((reason) => ({
      key: reason,
      label: reason,
      get: (r) => {
        const value = min(r.rejectBreakdown?.[reason]);
        return reason === "Other" ? <WithRemark value={value} row={r} kind="reject" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-center", tone: "calc" },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "unutilized",
    label: "Unutilized Machine Time (%)",
    get: (r, c, d) => pct(d.unutilized),
    align: "text-center",
    tone: "day",
    // Combined across every entry of this machine's date (see dayCalc), so
    // it's shown once per machine/date group, same as Unreported Time and
    // the three OEE columns below.
    merge: "machineDay",
  },
  {
    key: "downtime",
    label: "Total Stoppage (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total Stoppage (min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-center",
      tone: "calc",
    },
    columns: STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: "Effective Machine Run Time (hr:min)", get: (r, c) => hm(c.effectiveHours), align: "text-center", tone: "calc" },
  {
    key: "unreported",
    label: "Unreported Time (min)",
    get: (r, c, d) => n(d.unreportedMin),
    align: "text-center",
    tone: "day",
    merge: "machineDay",
  },
  { key: "setupEff", label: "Setup Efficiency (%)", get: (r, c) => pct(c.setupEfficiency), align: "text-center", tone: "calc" },
  ...APQ_COLUMNS,
  { key: "oeeLosses", label: "OEE considering losses (%)", get: (r, c, d) => pct(d.oeeLosses), align: "text-center", tone: "oee", merge: "machineDay" },
  {
    key: "oeeLunch",
    label: "OEE not considering losses but lunch (%)",
    get: (r, c, d) => pct(d.oeeLunch),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "oeeLunchCot",
    label: "OEE not considering losses but lunch and setup time (%)",
    get: (r, c, d) => pct(d.oeeLunchCot),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Remarks",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
