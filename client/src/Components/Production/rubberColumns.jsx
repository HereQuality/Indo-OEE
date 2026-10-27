import React from "react";
import { REJECT_REASONS, displayDay, remarkParts } from "../../utils/productionSheet";
import { RUBBER_STOPPAGE_FIELDS } from "../../utils/rubberSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, MACHINE_STATUS_COLUMN, RemarkCell, WithRemark, dash, hm, min, n, pct, pctOver, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/rubberColumns.jsx
 * ──────────────────────────────────────────
 * The RUBBER table's columns, in that sheet's own order and wording, in the
 * shape ProductionEntriesTable draws (see COLUMNS there for what each key
 * means) — except Worker Name, which sits right after Date: it's this sheet's
 * row key (where every other sheet has MC No.), so it's the frozen, merged
 * column. Planned Operator Shift is shown because every entry carries it
 * (locked in Process Master, like every process), and Availability /
 * Performance / Quality plus OEE Review sit where they do on every sheet,
 * next to the sheet's own two Productivity columns.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

export const RUBBER_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "Worker Name",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || dash(r.operator),
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { ...MACHINE_STATUS_COLUMN, label: "Working Status" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Total Cycle Time (Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "on", label: "Working Start Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Working End Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Worker Shift Time (hr:min)", get: (r, c) => hm(c.shiftHours), align: "text-center", tone: "calc" },
  { key: "idealQty", label: "IDEAL Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "IDEAL Quantity/Hour", get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "actualQty", label: "Actual Quantity", get: (r, c) => n(c.actualQty), align: "text-center", tone: "calc" },
  { key: "okQty", label: "ACTUAL OK Quantity", get: (r) => min(r.okQty), align: "text-center" },
  {
    // Rejected = Actual − OK (calc); expands to the Rejection Master split, "Other" carrying its remark.
    key: "rejectedQty",
    label: "Rejected Quantity",
    expandable: true,
    summary: { key: "rejectedQty", label: "Rejected Quantity", get: (r, c) => zeroIfBlank(c.rejectedQty), align: "text-center", tone: "calc" },
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
    key: "downtime",
    label: "Stoppage (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total stoppage (min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-center",
      tone: "calc",
    },
    columns: RUBBER_STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: "Effective working Time (hr:min)", get: (r, c) => hm(c.effectiveHours), align: "text-center", tone: "calc" },
  {
    key: "unreported",
    label: "Unreported Time (min)",
    get: (r, c, d) => n(d.unreportedMin),
    align: "text-center",
    tone: "day",
    merge: "machineDay",
  },
  ...APQ_COLUMNS,
  {
    key: "productivity",
    label: "Productivity without considering Lunch, tea, etc. (%)",
    get: (r, c, d) => pctOver(d.productivity),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "productivityLunch",
    label: "Productivity Considering Lunch, tea, etc. (%)",
    get: (r, c, d) => pctOver(d.productivityLunch),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "REMARKS",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
