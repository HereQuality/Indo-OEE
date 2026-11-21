// utils/companyMetrics.js: the dashboard's business figures by month and year.
const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeMetrics, monthsWithFigures, aggregate, METRIC_KEYS } = require("./companyMetrics");

const docs = [
  { year: 2026, month: 1, values: { sales: 100, salary: 10, onTimeDelivery: 90, customerComplaints: 2 } },
  { year: 2026, month: 2, values: { sales: 300, salary: 20, onTimeDelivery: 80 } },
  { year: 2026, month: 3, values: { customerComplaints: 1 } },
  { year: 2025, month: 12, values: { sales: 50, salary: 5 } },
];

test("sums money and counts, averages percentages and ratios, and skips blank months", () => {
  const m = summarizeMetrics(docs, 2026);
  assert.equal(m.sales.year, 400);
  assert.equal(m.sales.prevYear, 50);
  assert.equal(m.sales.monthsWithData, 2);
  assert.deepEqual(m.sales.months.slice(0, 4), [100, 300, null, null]);
  assert.equal(m.onTimeDelivery.year, 85);
  assert.equal(m.customerComplaints.year, 3);
  assert.equal(m.electricityBill.year, null);
  assert.equal(m.electricityBill.prevYear, null);
});

test("labour productivity is sales ÷ salary per month, averaged over the months that have both", () => {
  const m = summarizeMetrics(docs, 2026);
  assert.deepEqual(m.labourProductivity.months.slice(0, 3), [10, 15, null]);
  assert.equal(m.labourProductivity.year, 12.5);
  assert.equal(m.labourProductivity.prevYear, 10);
});

test("a month counts as having figures when any metric is set; aggregate of nothing is null", () => {
  assert.deepEqual(monthsWithFigures(docs, 2026).slice(0, 4), [true, true, true, false]);
  assert.equal(aggregate("sum", [null, undefined]), null);
  assert.equal(aggregate("avg", [2, null, 4]), 3);
  assert.ok(METRIC_KEYS.includes("sales") && !METRIC_KEYS.includes("labourProductivity"));
});
