"use strict";
/**
 * utils/companyMetrics.js
 * ─────────────────────────
 * The business figures the Company Level Objective dashboard shows beside OK
 * Qty — the same set as the company's Power BI board: sales, salary,
 * electricity, order booking, inventory, FG / RM / WIP, on-time delivery,
 * customer complaints. One figure per metric per month (models/CompanyMonthly.js),
 * typed on the page or loaded from Excel.
 *
 *   unit  "₹" money · "%" · "ratio" · "count"
 *   agg   how a year (or any span of months) is summarised: "sum" or "avg"
 *
 * Labour productivity is not stored: it is Sales ÷ Salary for each month.
 */
const METRICS = [
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

const METRIC_KEYS = METRICS.map((m) => m.key);
const METRIC_BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

// Sum or average of the non-null figures; null when there are none.
const aggregate = (agg, values) => {
  const have = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (!have.length) return null;
  const sum = have.reduce((a, b) => a + b, 0);
  return agg === "avg" ? sum / have.length : sum;
};

// Sales ÷ Salary for a month; null unless both are there and salary > 0.
const labourProductivity = (sales, salary) =>
  sales !== null && sales !== undefined && salary > 0 ? sales / salary : null;

/**
 * The year's metrics from its CompanyMonthly docs (and the previous year's, for
 * the comparison):
 *   { sales: { months: [12 × number|null], year, prevYear, monthsWithData }, … ,
 *     labourProductivity: { … } }
 */
const summarizeMetrics = (docs, year) => {
  const row = (y, m) => docs.find((d) => d.year === y && d.month === m)?.values || {};
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  const out = {};
  for (const metric of METRICS) {
    const months = Array.from({ length: 12 }, (_, i) => num(row(year, i + 1)[metric.key]));
    const prevMonths = Array.from({ length: 12 }, (_, i) => num(row(year - 1, i + 1)[metric.key]));
    out[metric.key] = {
      months,
      year: aggregate(metric.agg, months),
      prevYear: aggregate(metric.agg, prevMonths),
      monthsWithData: months.filter((v) => v !== null).length,
    };
  }
  const lp = (y) => Array.from({ length: 12 }, (_, i) => labourProductivity(num(row(y, i + 1).sales), num(row(y, i + 1).salary) ?? 0));
  const lpMonths = lp(year);
  out.labourProductivity = {
    months: lpMonths,
    year: aggregate("avg", lpMonths),
    prevYear: aggregate("avg", lp(year - 1)),
    monthsWithData: lpMonths.filter((v) => v !== null).length,
  };
  return out;
};

// Which months of the year have at least one figure typed or uploaded.
const monthsWithFigures = (docs, year) =>
  Array.from({ length: 12 }, (_, i) => {
    const values = docs.find((d) => d.year === year && d.month === i + 1)?.values || {};
    return METRIC_KEYS.some((k) => values[k] !== null && values[k] !== undefined);
  });

module.exports = { METRICS, METRIC_KEYS, METRIC_BY_KEY, aggregate, labourProductivity, summarizeMetrics, monthsWithFigures };
