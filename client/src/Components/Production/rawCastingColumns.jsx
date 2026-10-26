import React from "react";
import { displayDay, remarkParts } from "../../utils/productionSheet";
import { RAW_CASTING_DEFECTS, RAW_CASTING_IDLE_FIELDS } from "../../utils/rawCastingSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, min, n, pct, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/rawCastingColumns.jsx
 * ─────────────────────────────────────────────
 * The RAW CASTING table's columns, in that paper sheet's own order and wording,
 * in the shape ProductionEntriesTable draws (see COLUMNS there for what each
 * key means) — except Worker Name, which sits right after Date: it's this
 * sheet's row key (where every other sheet has MC No.), so it's the frozen,
 * merged column, as on AFTER POWDER COATING. Hours are shown as decimal hours,
 * as the sheet heads them "(In Hour)"; Ideal Inspection Quantity is not
 * rounded down. The paper works every row out on its own Working Hours, so
 * Unreported Time and the two Productivity figures are each entry's own (not
 * merged across the worker's day). The app's usual Planned Operator Shift,
 * Availability / Performance / Quality and OEE Review columns are added.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// Decimal hours as the sheet shows them (7.75, 1.82).
const hours = (v) => n(v);

export const RAW_CASTING_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "Worker Name",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || dash(r.operator),
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "itemName", label: "Item Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { key: "challanNo", label: "Challan No.", get: (r) => dash(r.challanNo), align: "text-center" },
  { key: "workingMode", label: "Working Status", get: (r) => (r.workingMode === "Non Working" ? "Non Working" : "Working") },
  {
    key: "machineStatus",
    label: "Reasons For Not Working",
    get: (r) => ((r.machineStatus || []).length ? r.machineStatus.join(", ") : "—"),
    headStyle: { minWidth: 150 },
  },
  { key: "on", label: "Inspection Start Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Inspection End Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Inspection Working Hours", get: (r, c) => hours(c.shiftHours), align: "text-center", tone: "calc" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Standard Inspection Time per Piece (in Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "totalQty", label: "TOTAL QTY", get: (r) => min(r.actualQty), align: "text-center" },
  { key: "okQty", label: "OK QTY", get: (r, c) => n(c.okQty), align: "text-center", tone: "calc" },
  {
    // Total Defects (calc) — expands to the sheet's three Types of Defects.
    key: "defects",
    label: "Types of Defects",
    expandable: true,
    summary: { key: "totalDefect", label: "Total Defects", get: (r, c) => n(c.totalDefect), align: "text-center", tone: "calc" },
    columns: RAW_CASTING_DEFECTS.map((defect) => ({
      key: defect,
      label: defect,
      get: (r) => zeroIfBlank(r.rejectBreakdown?.[defect]),
      align: "text-center",
    })),
  },
  { key: "idealQty", label: "Ideal Inspection Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "Ideal Inspection Quantity/Hour", get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "otherActivity", label: "Other Activity Carried Out", get: (r) => dash(r.otherActivity), headStyle: { minWidth: 140 } },
  { key: "otherActivityMin", label: "Time consume in Other Activity (min)", get: (r) => zeroIfBlank(r.otherActivityMin), align: "text-center" },
  { key: "plannedShift", label: "Planned Operator Shift (Hours)", get: (r) => hours(r.plannedOperatorShiftHours === "" ? null : r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "idle",
    label: "Idle Time (Min)",
    expandable: true,
    summary: { key: "totalStoppage", label: "Total Idle Time (Min)", get: (r, c) => n(c.totalStoppageMin), align: "text-center", tone: "calc" },
    columns: RAW_CASTING_IDLE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: "Ideal Inspection Time (In Hour)", get: (r, c) => hours(c.effectiveHours), align: "text-center", tone: "calc" },
  // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
  { key: "unreported", label: "Unreported Time (min)", get: (r, c, d) => n(d.unreportedMin), align: "text-center", tone: "day" },
  ...APQ_COLUMNS,
  { key: "productivity", label: "Productivity without considering Lunch, tea, etc. (%)", get: (r, c, d) => pct(d.productivity), align: "text-center", tone: "oee" },
  { key: "productivityLunch", label: "Productivity Considering Lunch, tea, etc. (%)", get: (r, c, d) => pct(d.productivityLunch), align: "text-center", tone: "oee" },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Reason/Remarks for Rejection",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
