import React from "react";
import { displayDay, fmtNum, remarkParts } from "../../utils/productionSheet";
import { hoursToHm } from "../../utils/shiftHours";
import { PRINTING_STOPPAGE_FIELDS } from "../../utils/printingSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, hm, min, n, pct, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/printingColumns.jsx
 * ────────────────────────────────────────────
 * The PRINTING table's columns, in the paper sheet's own order and wording, in
 * the shape ProductionEntriesTable draws (see COLUMNS there for what each key
 * means): Date | MC No. | Item Name | Operator | Working Status | Reasons For
 * Not Working | Machine ON / OFF Time | Machine Shift Time | Standard Time per
 * Piece | TOTAL / OK / Rejected QTY | Ok Quantity (%) | Ideal Quantity (not
 * rounded) | Ideal Quantity/Hours | the 13 downtime columns behind Total Idle
 * Time | Effective Machine Run Time | Unreported Time | the three OEE | Reason/
 * Remarks for Rejection/Rework — then the app's own: Planned Operator Shift,
 * Availability / Performance / Quality and OEE Review. No Unutilized column.
 *
 * Operator is this sheet's row key (`machine` holds the operator's id): it is
 * merged across the operator's entries of a date, but sits where the sheet puts
 * it, after Item Name, so only Date is frozen. Unreported Time and the three OEE
 * are each entry's own figures (printingDayCalc), so they aren't merged.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// The sheet's hours are decimal (7.75); the clock reading rides along on hover.
const hours = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : <span title={`${hoursToHm(v)} hr:min`}>{fmtNum(v)}</span>);

export const PRINTING_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "mcNo",
    label: "MC No.",
    get: (r, c, d, ctx) => (r.mcMachine ? ctx.machineName[r.mcMachine] || r.mcName || "—" : "—"),
    align: "text-center",
  },
  { key: "itemName", label: "Item Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  {
    key: "machine",
    label: "Operator",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || dash(r.operator),
    merge: "machineDay",
    tone: "machine",
  },
  {
    key: "workingStatus",
    label: "Working Status",
    get: (r) => (r.workingMode === "Non Working" ? "Non Working" : "Working"),
    align: "text-center",
  },
  {
    key: "machineStatus",
    label: "Reasons For Not Working",
    get: (r) => (r.workingMode === "Non Working" && (r.machineStatus || []).length ? r.machineStatus.join(", ") : "—"),
    headStyle: { minWidth: 150 },
  },
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
    columns: PRINTING_STOPPAGE_FIELDS.map((f) => ({
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
  {
    key: "remarks",
    label: "Reason/Remarks for Rejection/ Rework",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
  ...APQ_COLUMNS,
  REVIEW_COLUMN,
];
