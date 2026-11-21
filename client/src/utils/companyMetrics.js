// The Company Level Objective dashboard's business figures — mirrors
// server/utils/companyMetrics.js (keys, labels, units, how a year adds up).
import { fmtPct, fmtQty } from "./kpi";

export const METRICS = [
  { key: "sales", label: "Sales", unit: "₹", agg: "sum", group: "Sales" },
  { key: "targetSales", label: "Target Sales", unit: "₹", agg: "sum", group: "Sales" },
  { key: "orderBooking", label: "Order Booking", unit: "₹", agg: "sum", group: "Sales" },
  { key: "salary", label: "Total Salary", unit: "₹", agg: "sum", group: "Cost" },
  { key: "electricityBill", label: "Electricity Bill", unit: "₹", agg: "sum", group: "Cost" },
  { key: "fgValue", label: "FG (finished goods)", unit: "₹", agg: "avg", group: "Inventory" },
  { key: "rmValue", label: "RM (raw material)", unit: "₹", agg: "avg", group: "Inventory" },
  { key: "wipValue", label: "WIP (semi finished)", unit: "₹", agg: "avg", group: "Inventory" },
  { key: "inventoryTurnover", label: "Inventory Turnover", unit: "ratio", agg: "avg", group: "Inventory" },
  { key: "onTimeDelivery", label: "On Time Delivery", unit: "%", agg: "avg", group: "Service" },
  { key: "customerComplaints", label: "Customer Complaints", unit: "count", agg: "sum", group: "Service" },
];
export const METRIC_GROUPS = [...new Set(METRICS.map((m) => m.group))];
export const metricByKey = (key) => METRICS.find((m) => m.key === key);

// ₹ in the board's short form: 208.98M, 629.46K, 950 — full figure on hover.
export const fmtMoneyShort = (n) => {
  if (n === null || n === undefined || n === "" || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return fmtQty(Math.round(v * 100) / 100);
};
export const fmtMoneyFull = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : `₹ ${fmtQty(Math.round(Number(n)))}`);
export const fmtRatio = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(2));

// A figure in its metric's unit, short (tiles, axes) or full (tables, tooltips).
export const fmtMetric = (metric, n, { full = false } = {}) => {
  if (n === null || n === undefined || n === "" || !Number.isFinite(Number(n))) return "—";
  switch (metric?.unit) {
    case "₹": return full ? fmtMoneyFull(n) : fmtMoneyShort(n);
    case "%": return fmtPct(n);
    case "ratio": return fmtRatio(n);
    default: return fmtQty(n);
  }
};

// The unit shown after an input.
export const unitLabel = (unit) => ({ "₹": "₹", "%": "%", ratio: "times", count: "nos" }[unit] || "");

// Series colours — one per entity, fixed (validated for colour-blind separation).
export const SERIES = {
  sales: "#2563eb",
  orderBooking: "#d97706",
  targetSales: "#64748b",
  salary: "#2563eb",
  electricityBill: "#0891b2",
  fgValue: "#2563eb",
  rmValue: "#d97706",
  wipValue: "#0891b2",
  line: "#2563eb",
  okQty: "#2563eb",
  okQtyMuted: "#93c5fd",
};
