// utils/kpiOkQty.js: OK Qty by month for an objective's processes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { monthsFor, MONTHS } = require("./kpiOkQty");

test("an objective's months add up its processes' months; unknown processes count nothing", () => {
  const byProcess = new Map([
    ["p1", [10, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 7]],
    ["p2", [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  ]);
  assert.deepEqual(monthsFor(byProcess, ["p1", "p2", "p9"]), [11, 2, 8, 0, 0, 0, 0, 0, 0, 0, 0, 7]);
  assert.deepEqual(monthsFor(byProcess, []), Array(MONTHS).fill(0));
  // ObjectId-like values are matched by their string form.
  assert.deepEqual(monthsFor(byProcess, [{ toString: () => "p2" }]), [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
