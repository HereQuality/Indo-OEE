import React from "react";
import { displayDay, remarkParts } from "../../utils/productionSheet";
import { DEFECT_FIELDS, POWDER_IDLE_FIELDS } from "../../utils/powderCoatingSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, MACHINE_STATUS_COLUMN, RemarkCell, WithRemark, dash, hm, min, n, pct, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/powderCoatingColumns.jsx
 * ─────────────────────────────────────────────────
 * The After Powder Coating table's columns, in that sheet's own order and
 * wording, in the shape ProductionEntriesTable draws (see COLUMNS there for
 * what each key means) — except Worker Name, which sits right after Date:
 * it's this sheet's row key (where every other sheet has MC No.), so it's
 * the frozen, merged column. Planned Operator Shift is shown because every
 * entry carries it (locked in Process Master, like every process), and
 * Availability / Performance / Quality plus OEE Review sit where they do on
 * every sheet, next to the sheet's own two Productivity columns.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

export const POWDER_COLUMNS = [
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
  { ...MACHINE_STATUS_COLUMN, label: "Working Status" },
  { key: "on", label: "Inspection Start Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Inspection End Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Inspection Working Hours (hr:min)", get: (r, c) => hm(c.shiftHours), align: "text-center", tone: "calc" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Standard Inspection Time per Piece (Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "actualQty", label: "Total Qty", get: (r) => min(r.actualQty), align: "text-center" },
  { key: "okQty", label: "OK Qty", get: (r, c) => n(c.okQty), align: "text-center", tone: "calc" },
  {
    key: "defects",
    label: "Types of Defect / Rework",
    expandable: true,
    summary: {
      key: "totalDefect",
      label: "Total Defect / Rework",
      get: (r, c) => n(c.totalDefect),
      align: "text-center",
      tone: "calc",
    },
    columns: DEFECT_FIELDS.map((f) => ({ key: f.key, label: f.label, get: (r) => zeroIfBlank(r[f.key]), align: "text-center" })),
  },
  { key: "idealQty", label: "Ideal Inspection Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "Ideal Inspection Quantity/Hour", get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "otherActivity", label: "Other Activity Carried Out", get: (r) => dash(r.otherActivity), headStyle: { minWidth: 140 } },
  { key: "otherActivityMin", label: "Time in Other Activity (min)", get: (r) => zeroIfBlank(r.otherActivityMin), align: "text-center" },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "idle",
    label: "Idle Time (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total Idle Time (min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-center",
      tone: "calc",
    },
    columns: POWDER_IDLE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: "Ideal Inspection Time (hr:min)", get: (r, c) => hm(c.effectiveHours), align: "text-center", tone: "calc" },
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
    label: "Productivity without considering Lunch, Tea, etc. (%)",
    get: (r, c, d) => pct(d.productivity),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  {
    key: "productivityLunch",
    label: "Productivity considering Lunch, Tea, etc. (%)",
    get: (r, c, d) => pct(d.productivityLunch),
    align: "text-center",
    tone: "oee",
    merge: "machineDay",
  },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Reason/Remarks for Rejection/Rework",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
