const test = require("node:test");
const assert = require("node:assert/strict");
const MachineDayStatus = require("../models/MachineDayStatus");
const { _serialize, _isLocked } = require("./machineDayStatus.controller");

test("every reason is planned or unplanned and the 18 sheets are known", () => {
  for (const r of Object.values(MachineDayStatus.REASONS)) assert.ok(["planned", "unplanned"].includes(r.kind));
  assert.equal(MachineDayStatus.SHEETS.length, 18);
  assert.ok(MachineDayStatus.SHEETS.includes("rawCasting"));
});

test("a mark validates its date, reason and remarks length", () => {
  const ok = new MachineDayStatus({ sheet: "vmc", date: "2026-11-20", machine: "m1", reason: "breakdown", remarks: "Spindle" });
  assert.equal(ok.validateSync(), undefined);
  assert.ok(new MachineDayStatus({ sheet: "vmc", date: "20/11/2026", reason: "breakdown" }).validateSync()?.errors.date);
  assert.ok(new MachineDayStatus({ sheet: "nope", date: "2026-11-20", reason: "breakdown" }).validateSync()?.errors.sheet);
  assert.ok(new MachineDayStatus({ sheet: "vmc", date: "2026-11-20", reason: "x" }).validateSync()?.errors.reason);
  assert.ok(new MachineDayStatus({ sheet: "vmc", date: "2026-11-20", reason: "other", remarks: "a".repeat(301) }).validateSync()?.errors.remarks);
});

test("a mark is sent with its label and kind", () => {
  const s = _serialize({ sheet: "cnc", date: "2026-11-20", machine: "", reason: "holiday", remarks: "" });
  assert.equal(s.reasonLabel, "Holiday / plant off");
  assert.equal(s.kind, "planned");
});

test("several reasons: labels join, and any unplanned one makes it a loss", () => {
  const s = _serialize({ sheet: "cnc", date: "2026-11-20", machine: "m1", reason: "holiday", reasons: ["holiday", "power"], remarks: "" });
  assert.equal(s.reasonLabel, "Holiday / plant off, Power cut");
  assert.equal(s.kind, "unplanned");
  assert.deepEqual(_serialize({ reason: "noOrder" }).reasons, ["noOrder"]);
});

test("a mark locks once the IST day it was saved on has passed", () => {
  // Saved 20 Nov 23:00 IST (17:30 UTC): open all that day, locked on the 21st.
  const m = { createdAt: new Date("2026-11-20T17:30:00.000Z") };
  assert.equal(_isLocked(m, "2026-11-20"), false);
  assert.equal(_isLocked(m, "2026-11-21"), true);
  // Saved 21 Nov 00:30 IST (20 Nov 19:00 UTC) belongs to the 21st.
  assert.equal(_isLocked({ createdAt: new Date("2026-11-20T19:00:00.000Z") }, "2026-11-21"), false);
});
