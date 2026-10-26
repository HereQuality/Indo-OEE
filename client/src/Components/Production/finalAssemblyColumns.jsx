import React from "react";
import { displayDay, fmtNum, remarkParts } from "../../utils/productionSheet";
import { FA_DEFECT_REASONS, FA_IDLE_FIELDS, FA_LABELS as L } from "../../utils/finalAssemblySheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, min, n, pct, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/finalAssemblyColumns.jsx
 * ────────────────────────────────────────────────
 * The FINAL ASSEMBLY table's columns, in that paper sheet's own order, in the
 * shape ProductionEntriesTable draws (see COLUMNS there for what each key
 * means) — except Worker Name, which sits right after Date: it's this sheet's
 * row key, so it's the frozen, merged column (as on AFTER POWDER COATING).
 * Labels come from FA_LABELS (utils/finalAssemblySheet.js), one place. Hours
 * are decimal as on the paper; Ideal Quantity is not rounded down (blank
 * without a Standard Time). Every entry's Unreported and two Productivity
 * figures are its own (not merged across the worker's day). The app's usual
 * Planned Operator Shift, Availability / Performance / Quality and OEE Review
 * columns are added.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

export const FINAL_ASSEMBLY_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: L.worker,
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || dash(r.operator),
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "itemName", label: L.itemName, get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { key: "workingMode", label: L.workingStatus, get: (r) => (r.workingMode === "Non Working" ? "Non Working" : "Working") },
  { key: "machineStatus", label: L.reasons, get: (r) => ((r.machineStatus || []).length ? r.machineStatus.join(", ") : "—"), headStyle: { minWidth: 150 } },
  { key: "on", label: L.start, get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: L.end, get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: L.hours, get: (r, c) => n(c.shiftHours), align: "text-center", tone: "calc" },
  // Typed per entry (prefilled from the Part, optional), so not a grey "calc" column.
  { key: "cycle", label: L.std, get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "actualQty", label: L.totalQty, get: (r) => min(r.actualQty), align: "text-center" },
  { key: "okQty", label: L.okQty, get: (r, c) => n(c.okQty), align: "text-center", tone: "calc" },
  {
    // Rejected QTY = Total Defects; expands to the four Types of Defects ("Other"
    // carrying its remark), then Total Defects — the paper's columns after it.
    key: "rejectedQty",
    label: L.rejectedQty,
    expandable: true,
    summary: { key: "rejectedQty", label: L.rejectedQty, get: (r, c) => zeroIfBlank(c.totalDefect), align: "text-center", tone: "calc" },
    columns: [
      ...FA_DEFECT_REASONS.map((reason) => ({
        key: reason,
        label: reason,
        get: (r) => {
          const value = zeroIfBlank(r.rejectBreakdown?.[reason]);
          return reason === "Other" ? <WithRemark value={value} row={r} kind="reject" /> : value;
        },
        align: "text-center",
      })),
      { key: "totalDefect", label: L.totalDefects, get: (r, c) => fmtNum(c.totalDefect ?? 0), align: "text-center", tone: "calc" },
    ],
  },
  { key: "idealQty", label: L.idealQty, get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: L.idealQtyPerHour, get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "otherActivity", label: L.otherActivity, get: (r) => dash(r.otherActivity), headStyle: { minWidth: 140 } },
  { key: "otherActivityMin", label: L.otherActivityMin, get: (r) => zeroIfBlank(r.otherActivityMin), align: "text-center" },
  { key: "plannedShift", label: "Planned Operator Shift (Hours)", get: (r) => n(r.plannedOperatorShiftHours === "" ? null : r.plannedOperatorShiftHours), align: "text-center" },
  ...FA_IDLE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    get: (r) => {
      const value = zeroIfBlank(r[f.key]);
      return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
    },
    align: "text-center",
  })),
  { key: "totalStoppage", label: L.totalIdle, get: (r, c) => n(c.totalStoppageMin), align: "text-center", tone: "calc" },
  { key: "effective", label: L.effective, get: (r, c) => n(c.effectiveHours), align: "text-center", tone: "calc" },
  // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
  { key: "unreported", label: L.unreported, get: (r, c, d) => n(d.unreportedMin), align: "text-center", tone: "day" },
  ...APQ_COLUMNS,
  { key: "productivity", label: L.productivity, get: (r, c, d) => pct(d.productivity), align: "text-center", tone: "oee" },
  { key: "productivityLunch", label: L.productivityLunch, get: (r, c, d) => pct(d.productivityLunch), align: "text-center", tone: "oee" },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: L.remarks,
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
