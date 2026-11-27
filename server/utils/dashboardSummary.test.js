const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeRows } = require("./dashboardSummary");
const { buildMessage, dailyPeriod, weeklyPeriod, istNow, to12h } = require("../jobs/summaryMail");

const cnc = (o) => ({
  sheet: "cnc", processId: "p1", processName: "CNC", date: "2026-11-18", machine: "m1",
  machineOnTime: "08:00", machineOffTime: "16:00", plannedOperatorShiftHours: 8, itemName: "Bracket", totalCycleSec: 60,
  okQty: 400, actualQty: 420, lunchMin: 30, ...o,
});

test("OK Qty, Total and Rejected add up; OEE counts each machine-day once", () => {
  const rows = [
    cnc({ _id: "a", slot: 1 }),
    cnc({ _id: "b", slot: 2, okQty: 100, actualQty: 100 }), // same machine-day as a
    cnc({ _id: "c", machine: "m2", okQty: 200, actualQty: 250, rejectedQty: 50 }),
    { sheet: "rubber", processId: "p2", processName: "RUBBER", date: "2026-11-18", worker: "w1", machineOnTime: "09:00", machineOffTime: "17:00", plannedOperatorShiftHours: 8, itemName: "Grommet", totalCycleSec: 30, okQty: 500, actualQty: 520 },
  ];
  const s = summarizeRows(rows, { from: "2026-11-18", to: "2026-11-18" });
  assert.equal(s.entries, 4);
  assert.equal(s.okQty, 1200);
  assert.equal(s.totalQty, 1290);
  assert.equal(s.rejectedQty, 90);
  assert.equal(s.machineDays, 3);
  assert.ok(s.oee > 0 && s.oee < 2, `oee ${s.oee}`);
  assert.deepEqual(s.processes.map((p) => [p.processName, p.okQty, p.machineDays]), [["CNC", 700, 2], ["RUBBER", 500, 1]]);
  // The CNC day m1 is one figure for its two entries, m2 another.
  assert.equal(s.processes[0].entries, 3);
  // Machines within a process, and the period's days.
  assert.deepEqual(s.processes[0].machines.map((m) => [m.ownerId, m.entries, m.okQty]), [["m1", 2, 500], ["m2", 1, 200]]);
  assert.deepEqual(s.byDate.map((d) => [d.date, d.entries]), [["2026-11-18", 4]]);
  // A / P / Q over the totals: two 8 h shifts of CNC with 30 min lunch each.
  assert.ok(s.availability > 0 && s.availability <= 1, `availability ${s.availability}`);
  assert.ok(s.quality > 0.9 && s.quality < 1, `quality ${s.quality}`);
  assert.ok(s.availableMin > 0 && s.operatingMin > 0 && s.idealQty > 0);
});

test("no rows gives zeros and no OEE", () => {
  const s = summarizeRows([], { from: "2026-11-18", to: "2026-11-18" });
  assert.equal(s.okQty, 0);
  assert.equal(s.oee, null);
  assert.equal(s.availability, null);
  assert.deepEqual(s.processes, []);
  assert.deepEqual(s.byDate, []);
});

test("the PDF report builds", async () => {
  const { buildOeeReportPdf } = require("./oeeReportPdf");
  const s = summarizeRows([cnc({ _id: "a" }), cnc({ _id: "b", date: "2026-11-17" })], { from: "2026-11-17", to: "2026-11-18" });
  const pdf = await buildOeeReportPdf(s, { processLabel: "CNC" });
  assert.ok(Buffer.isBuffer(pdf) && pdf.length > 2000);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
});

test("the message names the period and lists every process", () => {
  const s = summarizeRows([cnc({ _id: "a" })], { from: "2026-11-18", to: "2026-11-18" });
  const m = buildMessage("daily", s);
  assert.equal(m.subject, "Daily production summary — 18/11/2026");
  assert.match(m.html, /CNC/);
  assert.match(m.text, /OK 400/);
  const w = buildMessage("weekly", summarizeRows([], { from: "2026-11-09", to: "2026-11-15" }));
  assert.equal(w.subject, "Weekly production summary — 09/11/2026 to 15/11/2026");
  assert.match(w.html, /No entries were saved/);
});

test("a daily mail covers the previous day — Monday's covers Saturday and Sunday; a weekly one the previous Monday to Sunday", () => {
  // 2026-11-19 is a Thursday: sent Monday–Saturday, Thursday's mail is Wednesday in full.
  assert.deepEqual(dailyPeriod("2026-11-19"), { from: "2026-11-18", to: "2026-11-18" });
  // Monday 16th: nothing went out on Sunday, so it covers Saturday 14th and Sunday 15th.
  assert.deepEqual(dailyPeriod("2026-11-16"), { from: "2026-11-14", to: "2026-11-15" });
  // Tuesday 17th is back to one day.
  assert.deepEqual(dailyPeriod("2026-11-17"), { from: "2026-11-16", to: "2026-11-16" });
  // Sent every day, Monday's covers Sunday only.
  assert.deepEqual(dailyPeriod("2026-11-16", [0, 1, 2, 3, 4, 5, 6]), { from: "2026-11-15", to: "2026-11-15" });
  // Sent on Mondays only, it covers the whole previous week.
  assert.deepEqual(dailyPeriod("2026-11-16", [1]), { from: "2026-11-09", to: "2026-11-15" });
  // 2026-11-19 is a Thursday: the previous full week is Mon 9 – Sun 15.
  assert.deepEqual(weeklyPeriod("2026-11-19"), { from: "2026-11-09", to: "2026-11-15" });
  // Sent on a Monday it covers the week that has just ended.
  assert.deepEqual(weeklyPeriod("2026-11-16"), { from: "2026-11-09", to: "2026-11-15" });
  // The clock reads IST: 01:30 UTC is 07:00 IST.
  assert.deepEqual(istNow(new Date("2026-11-19T01:30:00.000Z")), { date: "2026-11-19", hhmm: "07:00", weekday: 4 });
  assert.equal(to12h("18:00"), "6:00 PM");
  assert.equal(to12h("00:05"), "12:05 AM");
});

test("the daily message says it covers the whole day (or each day, on Monday)", () => {
  const s = summarizeRows([cnc({ _id: "a" })], { from: "2026-11-18", to: "2026-11-18" });
  assert.match(buildMessage("daily", s).html, /the whole day, all shifts/);
  const two = summarizeRows([cnc({ _id: "a" })], { from: "2026-11-14", to: "2026-11-15" });
  assert.equal(buildMessage("daily", two).subject, "Daily production summary — 14/11/2026 to 15/11/2026");
  assert.match(buildMessage("daily", two).html, /each day in full, all shifts/);
  assert.match(buildMessage("weekly", s).html, /Monday to Sunday/);
});
