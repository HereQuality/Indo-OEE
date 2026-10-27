import React from "react";
import { displayDay, fmtNum, remarkParts } from "../../utils/productionSheet";
import { MFD_STOPPAGE_FIELDS, fmtIdeal, fmtIdealPerHour } from "../../utils/mfdSheet";
import { APQ_COLUMNS, REVIEW_COLUMN, RemarkCell, WithRemark, dash, hm, min, n, pct, pctOver, zeroIfBlank, VENDOR_COLUMN } from "./ProductionEntriesTable";

/**
 * components/Production/mfdColumns.jsx
 * ──────────────────────────────────────
 * The MODULAR FRAME DRILLING table's columns, left to right in the paper
 * sheet's own order and wording, in the shape ProductionEntriesTable draws (see
 * COLUMNS there for what each key means). Actual Quantity — typed on the form's
 * Production Master, though the paper only has ACTUAL OK and Rejected — sits
 * before ACTUAL OK Quantity; Availability / Performance / Quality plus OEE
 * Review sit where they do on every sheet.
 *
 * Hours are shown as the sheet writes them (decimal hours — 10.67 is 10 h 40
 * min). IDEAL Quantity is the sheet's own (Lunch / Tea taken out), shown with
 * no decimals and IDEAL Quantity/Hour with one, as on the paper. Unreported
 * Time, Efficiency and the three OEE figures are each entry's own
 * (utils/mfdSheet.js — combined across the machine's day only on Process
 * Master's 12 h lock), so unlike most sheets they aren't merged across a
 * machine's day: two overlapping entries on one machine keep their own.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// Decimal hours, as the sheet writes them.
const hours = (v) => dash(fmtNum(v));

// Working Status / Reasons For Not Working: a Non Working day names its
// reasons — the ticked ones, then whatever the remarks say (W.OFF and the like).
const workingStatus = (r) => (r.workingMode === "Non Working" ? "Non Working" : "Working");
const notWorkingReasons = (r) =>
  r.workingMode === "Non Working" ? dash([...(r.machineStatus || []), String(r.remarks || "").trim()].filter(Boolean).join(", ")) : "—";

export const MFD_COLUMNS = [
  { key: "date", label: "Date", get: (r) => displayDay(r.date), merge: "date", frozen: "date", tone: "date" },
  {
    key: "machine",
    label: "MC NO.",
    get: (r, c, d, ctx) => ctx.machineName[r.machine] || "—",
    merge: "machineDay",
    tone: "machine",
    frozen: "machine",
  },
  { key: "operator", label: "Operator", get: (r) => dash(r.operator), tone: "operator" },
  { key: "workingStatus", label: "Working Status", get: workingStatus, align: "text-center" },
  { key: "notWorkingReasons", label: "Reasons For Not Working", get: notWorkingReasons, headStyle: { minWidth: 150 } },
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 180 } },
  VENDOR_COLUMN,
  // The Part's own reference figures, copied onto the entry when it was picked.
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo), headStyle: { minWidth: 120 } },
  { key: "operation", label: "Process", get: (r) => dash(r.operation), align: "text-center" },
  { key: "noOfHoles", label: "No. of Holes in One Piece", get: (r) => min(r.noOfHoles), align: "text-center" },
  { key: "strokeRequired", label: "Stroke Required for One Piece", get: (r) => min(r.strokeRequired), align: "text-center" },
  // Typed per entry (prefilled from the Part), so not a grey "calc" column.
  { key: "cycle", label: "Total Cycle Time (Sec)", get: (r) => min(r.totalCycleSec), align: "text-center" },
  { key: "on", label: "Machine Time ON", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine Time OFF", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "settingOn", label: "Setting Time ON", get: (r) => dash(r.settingOnTime), align: "text-center" },
  { key: "settingOff", label: "Setting Time OFF", get: (r) => dash(r.settingOffTime), align: "text-center" },
  { key: "shift", label: "Machine Shift Time (Hour)", get: (r, c) => hours(c.shiftHours), align: "text-center", tone: "calc" },
  { key: "idealQty", label: "IDEAL Quantity", get: (r, c) => dash(fmtIdeal(c.idealQtyExact)), align: "text-center", tone: "calc" },
  { key: "idealQtyPerHour", label: "IDEAL Quantity/Hour", get: (r, c) => dash(fmtIdealPerHour(c.idealQtyPerHour)), align: "text-center", tone: "calc" },
  { key: "actualQty", label: "Actual Quantity", get: (r, c) => n(c.actualQty), align: "text-center" },
  { key: "okQty", label: "ACTUAL OK Quantity", get: (r) => min(r.okQty), align: "text-center" },
  { key: "rejectedQty", label: "Rejected Quantity", get: (r, c) => n(c.rejectedQty), align: "text-center", tone: "calc" },
  { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-center", tone: "calc" },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
  {
    key: "downtime",
    label: "Downtime (min)",
    expandable: true,
    summary: {
      key: "totalStoppage",
      label: "Total stoppage (Min)",
      get: (r, c) => n(c.totalStoppageMin),
      align: "text-center",
      tone: "calc",
    },
    columns: MFD_STOPPAGE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      get: (r) => {
        const value = zeroIfBlank(r[f.key]);
        return f.key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "effective", label: "Effective Machine Run Time (Hour)", get: (r, c) => hours(c.effectiveHours), align: "text-center", tone: "calc" },
  { key: "unreported", label: "Unreported Time (Min)", get: (r, c, d) => n(d.unreportedMin), align: "text-center", tone: "day" },
  { key: "efficiency", label: "Efficiency (%)", get: (r, c) => pct(c.efficiency), align: "text-center", tone: "calc" },
  { key: "oeeLosses", label: "OEE considering losses (%)", get: (r, c, d) => pctOver(d.oeeLosses), align: "text-center", tone: "oee" },
  { key: "oeeLunch", label: "OEE not considering losses, but lunch (%)", get: (r, c, d) => pctOver(d.oeeLunch), align: "text-center", tone: "oee" },
  {
    key: "oeeLunchCot",
    label: "OEE not considering losses, but lunch & COT (%)",
    get: (r, c, d) => pctOver(d.oeeLunchCot),
    align: "text-center",
    tone: "oee",
  },
  ...APQ_COLUMNS,
  REVIEW_COLUMN,
  {
    key: "remarks",
    label: "REMARKS",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
