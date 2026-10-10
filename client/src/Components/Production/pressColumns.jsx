import React from "react";
import { displayDay, remarkParts } from "../../utils/productionSheet";
import { DOWNTIME_LABEL, RemarkCell, WithRemark, dash, hm, min, n, pct, zeroIfBlank } from "./ProductionEntriesTable";

/**
 * components/Production/pressColumns.jsx
 * ─────────────────────────────────────────
 * The PRESS Data Entry table's columns, left to right exactly as the real
 * "Indo Process 3/10" sheet lists them — unlike CNC/VMC/SPM/RIVET, this sheet
 * has no % OK Quantity or Unutilized Machine Time column, and Setup Efficiency
 * comes before Effective Machine Run Time, not after. Calculated cells read
 * `calc`/`day` from utils/pressSheet.js; the ten stoppage figures fold behind
 * Total Stoppage the way they do on every other sheet.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// The sheet's own wording for each downtime column.
const PRESS_DOWNTIME_LABEL = {
  ...DOWNTIME_LABEL,
  plannedDownMin: "Planned Downtime",
  setupMin: "Set-up Time",
  noManPowerMin: "No Manpower",
  bdMechMin: "B.D. Mech.",
  bdEleMin: "B.D. Ele.",
  lunchMin: "Lunch / Tea / Washroom etc",
  otherMin: "Others",
};
// Sheet order — Planned Downtime first, Others last.
const DOWNTIME_ORDER = [
  "plannedDownMin",
  "setupMin",
  "noManPowerMin",
  "materialShiftingMin",
  "noMaterialMin",
  "bdMechMin",
  "bdEleMin",
  "noPowerMin",
  "lunchMin",
  "otherMin",
];

export const PRESS_COLUMNS = [
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
  { key: "itemName", label: "Part Name", get: (r) => dash(r.itemName), headStyle: { minWidth: 160 } },
  { key: "operation", label: "Operation", get: (r) => dash(r.operation), headStyle: { minWidth: 130 } },
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo), headStyle: { minWidth: 130 } },
  { key: "setupNo", label: "Setup No.", get: (r) => dash(r.setupNo) },
  { key: "standardTimeMin", label: "Standard Time Taken (Min)", get: (r) => min(r.standardTimeMin), align: "text-center" },
  { key: "pcsPerStandardTime", label: "No. Piece in Standard Time", get: (r) => min(r.pcsPerStandardTime), align: "text-center" },
  { key: "cycle", label: "Product Cycle Time (sec)", get: (r, c) => n(c.totalCycleSec), align: "text-center", tone: "calc" },
  { key: "on", label: "Machine Time ON", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine Time OFF", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Machine Shift Time (hr:min)", get: (r, c) => hm(c.shiftHours), align: "text-center", tone: "calc" },
  { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "okQty", label: "Actual OK Quantity", get: (r) => min(r.okQty), align: "text-center" },
  { key: "rejectedQty", label: "Rejected Quantity", get: (r) => min(r.rejectedQty), align: "text-center" },
  { key: "pctOk", label: "% OK Quantity", get: (r, c) => pct(c.pctOk), align: "text-center", tone: "calc" },
  { key: "plannedShift", label: "Planned Operator Shift Time (hr:min)", get: (r) => hm(r.plannedOperatorShiftHours), align: "text-center" },
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
    columns: DOWNTIME_ORDER.map((key) => ({
      key,
      label: PRESS_DOWNTIME_LABEL[key],
      get: (r) => {
        const value = zeroIfBlank(r[key]);
        return key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
      },
      align: "text-center",
    })),
  },
  { key: "setupEff", label: "Setup Efficiency (%)", get: (r, c) => pct(c.setupEfficiency), align: "text-center", tone: "calc" },
  { key: "effective", label: "Effective Machine Run Time (hr:min)", get: (r, c) => hm(c.effectiveHours), align: "text-center", tone: "calc" },
  {
    key: "unreported",
    label: "Unreported Time (min)",
    get: (r, c, d) => n(d.unreportedMin),
    align: "text-center",
    tone: "day",
    merge: "machineDay",
  },
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
  {
    key: "remarks",
    label: "Remarks",
    get: (r) => <RemarkCell parts={remarkParts(r).filter((p) => p.key === "general")} />,
    align: "text-center",
  },
];
