import React from "react";
import { displayDay, remarkParts } from "../../utils/productionSheet";
import { MFA_IDLE_FIELDS, MFA_LABELS } from "../../utils/mfaSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, min, n, pct, pctOver, zeroIfBlank } from "./ProductionEntriesTable";

/**
 * components/Production/mfaColumns.jsx
 * ──────────────────────────────────────
 * The MODULAR FRAME ASSEMBLY table's columns, in that paper sheet's own order,
 * in the shape ProductionEntriesTable draws (see COLUMNS there for what each
 * key means) — except Worker Name, which sits right after Date: it's this
 * sheet's row key (where every other sheet has MC No.), so it's the frozen,
 * merged column, as on RAW CASTING. The timing columns take their words from
 * MFA_LABELS (utils/mfaSheet.js). Hours are shown as decimal hours; Ideal
 * Assembly Quantity is not rounded down. Every entry's Unreported Time and two
 * Productivity figures are its own (not merged across the worker's day). The
 * app's usual Planned Operator Shift, Availability / Performance / Quality and
 * OEE Review columns are added. No Vendor Name, no Challan No.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// Decimal hours as the sheet shows them (9.42, 2.67).
const hours = (v) => n(v);

export const MFA_COLUMNS = [
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
  { key: "workingMode", label: "Working Status", get: (r) => (r.workingMode === "Non Working" ? "Non Working" : "Working") },
  {
    key: "machineStatus",
    label: "Reasons For Not Working",
    get: (r) => ((r.machineStatus || []).length ? r.machineStatus.join(", ") : "—"),
    headStyle: { minWidth: 150 },
  },
  { key: "on", label: MFA_LABELS.start, get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: MFA_LABELS.end, get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: MFA_LABELS.hours, get: (r, c) => hours(c.shiftHours), align: "text-center", tone: "calc" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: `${MFA_LABELS.cycle} (in Sec)`, get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "totalQty", label: "TOTAL QTY", get: (r) => min(r.actualQty), align: "text-center" },
  { key: "okQty", label: "OK QTY", get: (r) => min(r.okQty), align: "text-center" },
  // Rejected = TOTAL − OK; no reason split on this sheet (Remarks only).
  { key: "rejectedQty", label: "Rejected QTY", get: (r, c) => zeroIfBlank(c.rejectedQty), align: "text-center", tone: "calc" },
  { key: "idealQty", label: MFA_LABELS.idealQty, get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: MFA_LABELS.idealQtyPerHour, get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "otherActivity", label: "Other Activity Carried Out", get: (r) => dash(r.otherActivity), headStyle: { minWidth: 140 } },
  { key: "otherActivityMin", label: "Time consume in Other Activity (min)", get: (r) => zeroIfBlank(r.otherActivityMin), align: "text-center" },
  { key: "plannedShift", label: "Planned Operator Shift (Hours)", get: (r) => hours(r.plannedOperatorShiftHours === "" ? null : r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "idle",
    label: "Idle Time (Min)",
    expandable: true,
    summary: { key: "totalStoppage", label: "Total Idle Time (Min)", get: (r, c) => n(c.totalStoppageMin), align: "text-center", tone: "calc" },
    columns: MFA_IDLE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: MFA_LABELS.effective, get: (r, c) => hours(c.effectiveHours), align: "text-center", tone: "calc" },
  // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
  { key: "unreported", label: "Unreported Time (min)", get: (r, c, d) => n(d.unreportedMin), align: "text-center", tone: "day" },
  ...APQ_COLUMNS,
  { key: "productivity", label: "Productivity without considering Lunch, tea, etc. (%)", get: (r, c, d) => pctOver(d.productivity), align: "text-center", tone: "oee" },
  { key: "productivityLunch", label: "Productivity Considering Lunch, tea, etc. (%)", get: (r, c, d) => pctOver(d.productivityLunch), align: "text-center", tone: "oee" },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Remarks",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
