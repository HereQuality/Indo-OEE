// Availability / Performance / Quality, checked against hand-worked examples,
// and against the browser's own copy (client/src/utils/productionSheet.js):
//   node --test utils/
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { entryMetrics, metricsOver100, CYCLE_SEC } = require("./oeeMetrics");

const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} ≠ ${expected}`);

// 08:00–20:00 = 720 min run, 12 h planned, 30 min lunch, 30 min setup + 60 min
// breakdown, 60 s cycle, 500 made of which 490 OK.
//   Planned Production = 720 − 30 (lunch)          = 690 min
//   Operating          = 720 − (30 + 30 + 60)       = 600 min
//   Availability       = 600 ÷ 690                  = 86.96%
//   Performance        = 60 s × 500 ÷ 60 ÷ 600 min  = 83.33%
//   Quality            = 490 ÷ 500                  = 98.00%
const CNC = {
  itemName: "Bracket",
  machineOnTime: "08:00",
  machineOffTime: "20:00",
  plannedOperatorShiftHours: 12,
  lunchMin: 30,
  setupMin: 30,
  bdMechMin: 60,
  totalCycleSec: 60,
  actualQty: 500,
  okQty: 490,
};

test("CNC: the hand-worked example", () => {
  const m = entryMetrics("cnc", CNC);
  close(m.availability, 600 / 690, "availability");
  close(m.performance, 500 / 600, "performance");
  close(m.quality, 0.98, "quality");
  assert.deepEqual(metricsOver100(m), []);
});

test("Planned Downtime is a planned stop (doesn't lower Availability); a breakdown is not", () => {
  const planned = entryMetrics("cnc", { ...CNC, setupMin: 0, bdMechMin: 0, plannedDownMin: 60 });
  // planned production 720 − 30 − 60 = 630; operating 720 − 90 = 630 → 100%
  close(planned.availability, 1, "planned downtime");
  const breakdown = entryMetrics("cnc", { ...CNC, setupMin: 0, bdMechMin: 60 });
  close(breakdown.availability, 630 / 690, "breakdown");
});

test("VMC: 6 min program for 2 pieces = 180 s cycle; this entry runs over 100% Performance", () => {
  // 09:00–17:30 = 510 min, lunch 30 → operating 480 min; 164 made × 180 s = 492 min of work.
  const vmc = { itemName: "Bracket", machineOnTime: "09:00", machineOffTime: "17:30", plannedOperatorShiftHours: 9.5, lunchMin: 30, programTimeMin: 6, pcsPerProgram: 2, okQty: 160, rejectedQty: 4 };
  assert.equal(CYCLE_SEC.vmc(vmc), 180);
  const m = entryMetrics("vmc", vmc);
  close(m.availability, 480 / 540, "availability");
  close(m.performance, 492 / 480, "performance");
  close(m.quality, 160 / 164, "quality");
  assert.deepEqual(metricsOver100(m).map((f) => f.metric), ["performance"]);
});

test("each sheet's cycle time: unticked operations come off, program/standard time per piece", () => {
  assert.equal(CYCLE_SEC.spm({ totalCycleSec: 40, loadingSec: 5, excludedOps: ["loadingSec"] }), 35);
  assert.equal(CYCLE_SEC.rivet({ totalCycleSec: 30, rivetProcessSec: 12, excludedOps: ["rivetProcessSec"] }), 18);
  assert.equal(CYCLE_SEC.cnc({ totalCycleSec: 50, drillingSec: 8, excludedOps: ["drillingSec"] }), 42);
  assert.equal(CYCLE_SEC.press({ standardTimeMin: 10, pcsPerStandardTime: 20 }), 30);
  assert.equal(CYCLE_SEC.contact({ totalCycleSec: 25.35 }), 25.35);
});

test("missing data gives null, never a division by zero", () => {
  const none = entryMetrics("cnc", { itemName: "Bracket", okQty: 10 });
  assert.deepEqual(none, { availability: null, performance: null, quality: null });
  // No part → no cycle time → no Performance (Availability still works).
  const noPart = entryMetrics("cnc", { ...CNC, itemName: "" });
  assert.equal(noPart.performance, null);
  assert.ok(noPart.availability > 0);
  // Nothing produced → no Quality; stoppage filling the whole run → no Performance.
  assert.equal(entryMetrics("cnc", { ...CNC, actualQty: 0, okQty: 0 }).quality, null);
  assert.equal(entryMetrics("cnc", { ...CNC, setupMin: 690, bdMechMin: 0 }).performance, null);
  // Contact status-only day (ABSENT etc.): no times at all.
  assert.deepEqual(entryMetrics("contact", { workingStatus: "ABSENT" }), { availability: null, performance: null, quality: null });
});

test("an entry with no Planned Operator Shift (the oldest rows) measures against its Machine Shift", () => {
  const m = entryMetrics("cnc", { ...CNC, plannedOperatorShiftHours: "" });
  close(m.availability, 600 / 690, "same as a 12 h plan on a 12 h run");
});

test("values above 100% are kept as they are, not capped", () => {
  // Machine ran 13 h against a 12 h plan.
  const m = entryMetrics("cnc", { ...CNC, machineOffTime: "21:00", setupMin: 0, bdMechMin: 0, lunchMin: 0 });
  close(m.availability, 780 / 720, "availability over 100%");
  assert.deepEqual(metricsOver100(m).map((f) => f.metric), ["availability"]);
  // Exactly 100% is not over.
  assert.deepEqual(metricsOver100({ availability: 1, performance: 1, quality: 1 }), []);
});

test("the browser's formulas (client/src/utils/productionSheet.js) give the same figures", async () => {
  const client = await import(pathToFileURL(path.resolve(__dirname, "../../client/src/utils/productionSheet.js")).href);
  const cases = [
    ["cnc", CNC],
    ["cnc", { ...CNC, plannedDownMin: 45, noPowerMin: 15 }],
    ["vmc", { itemName: "Bracket", machineOnTime: "09:00", machineOffTime: "17:30", plannedOperatorShiftHours: 9.5, lunchMin: 30, programTimeMin: 6, pcsPerProgram: 2, okQty: 160, rejectedQty: 4 }],
    ["press", { itemName: "Lid", machineOnTime: "07:00", machineOffTime: "15:00", plannedOperatorShiftHours: 12, lunchMin: 30, standardTimeMin: 10, pcsPerStandardTime: 20, okQty: 800, rejectedQty: 10 }],
    ["contact", { itemName: "Pin", machineOnTime: "08:00", machineOffTime: "20:00", plannedOperatorShiftHours: 12, lunchMin: 45, totalCycleSec: 25.35, okQty: 1500, rejectedQty: 20 }],
  ];
  for (const [sheet, row] of cases) {
    const server = entryMetrics(sheet, row);
    // Each sheet's adapter hands rowCalc its own cycle time in totalCycleSec.
    const calc = client.rowCalc({ ...row, totalCycleSec: CYCLE_SEC[sheet](row), excludedOps: [] });
    for (const k of ["availability", "performance", "quality"]) close(calc[k], server[k], `${sheet} ${k}`);
  }
});
