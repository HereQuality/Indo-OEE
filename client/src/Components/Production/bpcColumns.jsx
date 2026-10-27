import React from "react";
import { displayDay, fmtNum, remarkParts } from "../../utils/productionSheet";
import { BPC_REJECT_REASONS, BPC_STOPPAGE_FIELDS, rejectSplitTotal } from "../../utils/bpcSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, min, n, pct, pctOver, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/bpcColumns.jsx
 * ──────────────────────────────────────
 * The BEFORE POWDER COATING table's columns, in that paper sheet's own order
 * and wording, in the shape ProductionEntriesTable draws (see COLUMNS there for
 * what each key means) — except Operator, which sits right after Date: it's
 * this sheet's row key (where every other sheet has MC No.), so it's the
 * frozen, merged column, as RUBBER's Worker Name is. Times are shown as decimal
 * hours, as the sheet heads them "(Hours)". Ideal Quantity is not rounded
 * down. The paper has only two OEE columns, and works every row out on its
 * own Machine Shift — so Unreported Time and the two OEE figures are each
 * entry's own (not merged across the operator's day). The app's usual Planned
 * Operator Shift, Availability / Performance / Quality and OEE Review columns
 * are added; there's no Unutilized column.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// Decimal hours as the sheet shows them (6.75, 2.88).
const hours = (v) => n(v);

export const BPC_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "Operator",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || dash(r.operator),
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "itemName", label: "Item Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  VENDOR_COLUMN,
  { key: "workingMode", label: "Working Status", get: (r) => (r.workingMode === "Non Working" ? "Non Working" : "Working") },
  {
    key: "machineStatus",
    label: "Reasons For Not Working",
    get: (r) => ((r.machineStatus || []).length ? r.machineStatus.join(", ") : "—"),
    headStyle: { minWidth: 150 },
  },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Machine Shift Time (Hours)", get: (r, c) => hours(c.shiftHours), align: "text-center", tone: "calc" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Standard Time per Piece (Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "totalQty", label: "TOTAL QTY", get: (r, c) => n(c.actualQty), align: "text-center" },
  { key: "okQty", label: "OK QTY", get: (r) => min(r.okQty), align: "text-center" },
  {
    // Rejected = TOTAL − OK (calc); expands to this sheet's own reasons, "Other"
    // carrying its remark, then their total — the paper's column after them.
    key: "rejectedQty",
    label: "Rejected QTY",
    expandable: true,
    summary: { key: "rejectedQty", label: "Rejected QTY", get: (r, c) => zeroIfBlank(c.rejectedQty), align: "text-center", tone: "calc" },
    columns: [
      ...BPC_REJECT_REASONS.map((reason) => ({
        key: reason,
        label: reason,
        get: (r) => {
          const value = min(r.rejectBreakdown?.[reason]);
          return reason === "Other" ? <WithRemark value={value} row={r} kind="reject" /> : value;
        },
        align: "text-center",
      })),
      { key: "rejectSplitTotal", label: "Total", get: (r) => fmtNum(rejectSplitTotal(r)), align: "text-center", tone: "calc" },
    ],
  },
  { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "Ideal Quantity/Hours", get: (r, c) => n(c.idealQtyPerHour), align: "text-center", tone: "calc" },
  { key: "plannedShift", label: "Planned Operator Shift (Hours)", get: (r) => hours(r.plannedOperatorShiftHours === "" ? null : r.plannedOperatorShiftHours), align: "text-center" },
  ...BPC_STOPPAGE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    get: (r) => {
      const value = zeroIfBlank(r[f.key]);
      return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
    },
    align: "text-center",
  })),
  { key: "totalStoppage", label: "Total Idle Time (Min)", get: (r, c) => n(c.totalStoppageMin), align: "text-center", tone: "calc" },
  { key: "effective", label: "Effective Machine Run Time (hours)", get: (r, c) => hours(c.effectiveHours), align: "text-center", tone: "calc" },
  // Each entry's own (combined across the day only on Process Master's fixed shift) — never merged.
  { key: "unreported", label: "Unreported Time (min)", get: (r, c, d) => n(d.unreportedMin), align: "text-center", tone: "day" },
  ...APQ_COLUMNS,
  { key: "oeeLosses", label: "OEE considering losses (%)", get: (r, c, d) => pctOver(d.oeeLosses), align: "text-center", tone: "oee" },
  { key: "oeeLunch", label: "OEE not considering losses but lunch (%)", get: (r, c, d) => pctOver(d.oeeLunch), align: "text-center", tone: "oee" },
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "Reason/Remarks",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
