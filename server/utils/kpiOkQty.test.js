// utils/kpiOkQty.js: OK Qty (and Rejected Qty) by month for an objective's processes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { monthsFor, MONTHS } = require("./kpiOkQty");

const byProcess = new Map([
  ["p1", { ok: [10, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 7], rejected: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3] }],
  ["p2", { ok: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0], rejected: [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
]);

test("an objective's months add up its processes' months; unknown processes count nothing", () => {
  assert.deepEqual(monthsFor(byProcess, ["p1", "p2", "p9"]), [11, 2, 8, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
  assert.deepEqual(monthsFor(byProcess, []), Array(MONTHS).fill(0));
  // ObjectId-like values are matched by their string form.
  assert.deepEqual(monthsFor(byProcess, [{ toString: () => "p2" }]), [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});

test("rejected quantities add up the same way", () => {
  assert.deepEqual(monthsFor(byProcess, ["p1", "p2"], "rejected"), [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3]);
});
