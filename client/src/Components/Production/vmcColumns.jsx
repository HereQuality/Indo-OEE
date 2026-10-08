import React from "react";
import { displayDay, remarkParts } from "../../utils/productionSheet";
import { DOWNTIME_LABEL, RemarkCell, WithRemark, dash, hm, min, n, pct, zeroIfBlank } from "./ProductionEntriesTable";

/**
 * components/Production/vmcColumns.jsx
 * ──────────────────────────────────────
 * The VMC Data Entry table's columns, left to right in the sheet's own order,
 * in the shape ProductionEntriesTable draws (see COLUMNS there for what each
 * key means). Calculated cells read `calc`/`day` from utils/vmcSheet.js; the
 * ten stoppage figures fold behind Total Stoppage the way they do on the CNC
 * sheet.
 *
 * Module-level on purpose: the table memoises on the column list, so it has to
 * stay one stable array.
 */

// The sheet's own wording for each downtime column.
const VMC_DOWNTIME_LABEL = {
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

export const VMC_COLUMNS = [
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
  { key: "drawingNo", label: "Drawing No.", get: (r) => dash(r.drawingNo), headStyle: { minWidth: 130 } },
  { key: "programTimeMin", label: "Program Time (min)", get: (r) => min(r.programTimeMin), align: "text-center" },
  { key: "pcsPerProgram", label: "No. of Piece In One Program", get: (r) => min(r.pcsPerProgram), align: "text-center" },
  { key: "cycle", label: "Product Cycle Time (sec)", get: (r, c) => n(c.totalCycleSec), align: "text-center", tone: "calc" },
  { key: "on", label: "Machine ON Time", get: (r) => dash(r.machineOnTime), align: "text-center" },
  { key: "off", label: "Machine OFF Time", get: (r) => dash(r.machineOffTime), align: "text-center" },
  { key: "shift", label: "Machine Shift Time (hr:min)", get: (r, c) => hm(c.shiftHours), align: "text-center", tone: "calc" },
  { key: "idealQty", label: "Ideal Quantity", get: (r, c) => n(c.idealQty), align: "text-center", tone: "calc" },
  { key: "actualQty", label: "Actual Quantity", get: (r, c) => n(c.actualQty), align: "text-center", tone: "calc" },
  { key: "okQty", label: "Actual OK Quantity", get: (r) => min(r.okQty), align: "text-center" },
  { key: "rejectedQty", label: "Rejected Quantity", get: (r) => min(r.rejectedQty), align: "text-center" },
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
    columns: DOWNTIME_ORDER.map((key) => ({
      key,
      label: VMC_DOWNTIME_LABEL[key],
      get: (r) => {
        const value = zeroIfBlank(r[key]);
        return key === "otherMin" ? <WithRemark value={value} row={r} kind="downtime" /> : value;
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
