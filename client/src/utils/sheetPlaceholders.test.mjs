import test from "node:test";
import assert from "node:assert/strict";
import { withPlaceholders, isPlaceholder } from "./sheetPlaceholders.js";

const machines = [{ _id: "m1", machineName: "7A" }, { _id: "m2", machineName: "7B" }];
const rankOf = (id) => ({ m1: 0, m2: 1 })[id] ?? 99;
const row = (id, date, machine, slot = 1) => ({ _id: id, date, machine, slot });

test("every listed day gets a row per machine that has no entry, in machine order", () => {
  const rows = [row("a", "2026-11-19", "m2"), row("b", "2026-11-18", "m1", 1), row("c", "2026-11-18", "m1", 2)];
  const out = withPlaceholders(rows, { dates: ["2026-11-19", "2026-11-18", "2026-11-17"], machines, rankOf });
  assert.deepEqual(
    out.map((r) => [r.date, r.machine, isPlaceholder(r) ? "ph" : r._id]),
    [
      ["2026-11-19", "m1", "ph"], ["2026-11-19", "m2", "a"],
      ["2026-11-18", "m1", "b"], ["2026-11-18", "m1", "c"], ["2026-11-18", "m2", "ph"],
      ["2026-11-17", "m1", "ph"], ["2026-11-17", "m2", "ph"],
    ],
  );
  assert.equal(out[0]._id, "ph|2026-11-19|m1");
});

test("a worker sheet (no machines) gets one row per empty day; a day with entries none", () => {
  const rows = [row("a", "2026-11-19", "w1")];
  const out = withPlaceholders(rows, { dates: ["2026-11-19", "2026-11-18"], machines: [] });
  assert.deepEqual(out.map((r) => [r.date, isPlaceholder(r)]), [["2026-11-19", false], ["2026-11-18", true]]);
});

test("nothing is added while a filter narrows the view, or when the server lists no days", () => {
  const rows = [row("a", "2026-11-19", "m1")];
  assert.equal(withPlaceholders(rows, { dates: ["2026-11-19"], machines, rankOf, enabled: false }), rows);
  assert.equal(withPlaceholders(rows, { dates: [], machines, rankOf }), rows);
});
