// Run: npm test   (bundles this with Vite's esbuild, then node:test — no extra deps)
// The RAW CASTING sheet's adapter (utils/rawCastingSheet.js), rules
// (utils/rawCastingValidation.js) and the shared pieces it plugs into.
import test from "node:test";
import assert from "node:assert/strict";
import {
  RAW_CASTING_DEFECTS,
  RAW_CASTING_MAX_ENTRIES_PER_DAY,
  isRawCastingProcess,
  rawCastingDayCalc,
  rawCastingRowCalc,
} from "./rawCastingSheet.js";
import { validateRawCastingEntry } from "./rawCastingValidation.js";
import { isPowderCoatingProcess } from "./powderCoatingSheet.js";
import { isBpcProcess } from "./bpcSheet.js";
import { isPrintingProcess } from "./printingSheet.js";
import { isInjectionProcess } from "./injectionSheet.js";
import { isRubberProcess } from "./rubberSheet.js";
import { isSpringProcess } from "./springSheet.js";
import { isContactProcess } from "./contactSheet.js";
import { isTrobeProcess } from "./trobeSheet.js";
import { isPressProcess } from "./pressSheet.js";
import { isRivetProcess } from "./rivetSheet.js";
import { isSpmProcess } from "./spmSheet.js";
import { isCncProcess, isVmcProcess } from "./vmcSheet.js";
import { MAX_ENTRIES_PER_DAY, slotsFullErrors } from "./entryValidation.js";
import { isWorkerProcess, stoppageKeysFor, summarize } from "./processDashboard.js";
import { spanMinutes } from "./productionSheet.js";

// The paper sheet's rows (pasted by the user 2026-10-26), as written — the
// 12/05 W.OFF day has no worker and isn't a figure row.
// [date, item, vendor, challan, worker, on, off, std, total, okOnPaper, blow, crack, other,
//  idealQty, idealInspTime, unreported, productivity %, productivity considering lunch %, lunch, otherIdle]
const PAPER = [
  ["2024-05-02", "24 PIN B/O(M)", "Alucast", "", "MANJU", "12:30", "14:30", 30, 218, 215, 0, 0, 3, 240.0, 1.816666667, 11.0, 90.83, 90.83, 0, 0],
  ["2024-05-10", "24 PIN B/O D/C,P/C", "Shivsons", "DC/28", "MANJU", "08:15", "16:00", 36, 686, 668, 5, 13, 0, 775.0, 6.86, 23.4, 88.52, 94.62, 30, 0],
  ["2024-05-10", "24 PIN HOOD H/C S/E,PG-29", "Alucast", "105", "MANJU", "16:00", "19:00", 30, 340, 340, 0, 0, 0, 360.0, 2.833333333, 10, 94.44, 94.44, 0, 0],
  ["2024-05-10", "24 PIN BO ,D/C,P/C", "Shivsons", "DC/28", "ANJU", "08:15", "16:00", 32, 799, 759, 20, 20, 0, 871.88, 7.102222222, 8.866666667, 91.64, 97.96, 30, 0],
  ["2024-05-10", "24 PIN HOOD S/E,PG-21,D/C,P/C", "Dio", "DC-0537", "ANJU", "16:00", "19:00", 25, 400, 380, 20, 0, 0, 432.0, 2.777777778, 13.33333333, 92.59, 92.59, 0, 0],
  ["2024-05-11", "3 PIN B/O S/C,MS", "Dio", "DC-0537", "MANJU", "08:15", "17:00", 38, 744, 681, 0, 63, 0, 828.95, 7.853333333, 23.8, 89.75, 95.19, 30, 0],
  ["2024-05-11", "3 PIN B/O S/C, MS", "Dio", "DC-0537", "ANJU", "08:15", "19:00", 23, 940, 871, 0, 69, 0, 1682.61, 6.005555556, 14.66666667, 55.87, 58.59, 30, 240],
  ["2024-05-13", "24 PIN HOOD S/E,PG-21,D/C P/C", "Dio", "DC-0537", "ANJU", "08:15", "14:30", 40, 478, 478, null, null, null, 562.5, 5.311111111, 26.33333333, 84.98, 92.37, 30, 0],
  ["2024-05-14", "24 PIN B/O,D/C,P/C", "Alucast", "DC/31", "ANJU", "14:10", "17:55", 40, 317, 324, null, 19, null, 337.5, 3.522222222, 13.66666667, 93.93, 93.93, 0, 0],
  ["2024-05-14", "24 PIN HOOD S/E,PG-21,D/C,MS", "Dio", "DC-0541", "MANJU", "17:00", "19:00", 33, 179, 179, null, null, null, 218.18, 1.640833333, 21.55, 82.04, 82.04, 0, 0],
  ["2024-05-15", "24 PIN HOOD S/E,PG-21,D/C,P/C", "Dio", "DC-0541", "MANJU", "08:15", "10:00", 19, 317, 276, 41, null, null, 331.58, 1.673055556, 4.616666667, 95.6, 95.6, 0, 0],
  ["2024-05-15", "16 PIN HOOD S/E,PG-21 D/C MS", "Dio", "DC-0541", "MANJU", "10:10", "16:30", 35, 596, 541, 55, null, null, 651.43, 5.794444444, 2.333333333, 91.49, 99.33, 30, 0],
  ["2024-05-15", "24 PIN HOOD H/C,S/E, PG-29,S/C,MS", "Alucast", "110", "MANJU", "16:10", "18:50", 35, 247, 237, 10, null, null, 274.29, 2.401388889, 15.91666667, 90.05, 90.05, 0, 0],
  ["2024-05-15", "24 PIN HOOD S/E,H/CPG-29 S/C,PC", "Alucast", "110", "ANJU", "08:15", "17:45", 30, 1056, 1020, 32, 4, null, 1140.0, 8.8, 12, 92.63, 97.78, 30, 0],
  ["2024-05-15", "24 PIN B/C HPR (NEW ITEM BIG)", "", "", "ANJU", "17:55", "18:50", 30, 100, 50, 20, 30, null, 110.0, 0.8333333333, 5, 90.91, 90.91, 0, 0],
  ["2024-05-16", "24 PI B/C HPR", "Shivsons", "", "ANJU", "08:30", "10:00", 30, 108, 47, 61, null, null, 180.0, 0.9, 36, 60.0, 60.0, 0, 0],
  ["2024-05-16", "24 PIN B/O,D/C,P/C", "Shivsons", "DC/31", "ANJU", "10:05", "11:55", 25, 235, 200, 15, 20, null, 264.0, 1.631944444, 12.08333333, 89.02, 89.02, 0, 0],
].map(([date, item, vendor, challan, worker, on, off, std, total, okOnPaper, blow, crack, other, ideal, eff, unrep, prod, prodLunch, lunch, otherIdle]) => ({
  date, item, vendor, challan, worker, on, off, std, total, okOnPaper, blow, crack, other, ideal, eff, unrep, prod, prodLunch, lunch, otherIdle,
}));

const defects = (p) => Object.fromEntries([["Blow Holes Casting", p.blow], ["Crack/Damage Casting", p.crack], ["Other", p.other]].filter(([, n]) => n !== null && n !== 0));

// A paper row as the form saves it: Planned typed = the Inspection Working
// Hours (the paper has no Planned column), the process unlocked.
const formRow = (p, o = {}) => ({
  _id: `${p.date}|${p.worker}|${p.on}`,
  date: p.date,
  machine: p.worker,
  itemName: p.item,
  challanNo: p.challan,
  totalCycleSec: p.std,
  machineOnTime: p.on,
  machineOffTime: p.off,
  actualQty: p.total,
  rejectBreakdown: defects(p),
  lunchMin: p.lunch,
  otherMin: p.otherIdle,
  otherMinRemark: p.otherIdle ? "HOOD SAT IN CAGE" : "",
  plannedOperatorShiftHours: spanMinutes(p.on, p.off) / 60,
  ...o,
});
const pct = (v) => Math.round(v * 10000) / 100;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const find = (date, worker, on) => PAPER.find((p) => p.date === date && p.worker === worker && p.on === on);

test(`all ${PAPER.length} paper rows: Ideal (2 dp, not rounded down), Ideal/Hour, Ideal Inspection Time, Unreported and both Productivity % are exact`, () => {
  for (const p of PAPER) {
    const at = `${p.date} ${p.worker} ${p.on}`;
    const c = rawCastingRowCalc(formRow(p));
    assert.equal(Number(c.idealQty.toFixed(2)), p.ideal, `Ideal ${at}: ${c.idealQty}`);
    assert.equal(c.idealQtyFloor, Math.floor(p.ideal + 1e-9));
    assert.ok(close(c.idealQtyPerHour, 3600 / p.std), `Ideal/Hour ${at}`);
    assert.ok(close(c.effectiveHours, p.eff), `Ideal Inspection Time ${at}: ${c.effectiveHours}`);
    const [d] = rawCastingDayCalc([formRow(p)]);
    assert.ok(close(d.unreportedMin, p.unrep), `Unreported ${at}: ${d.unreportedMin}`);
    assert.equal(pct(d.productivity), p.prod, `Productivity ${at}`);
    assert.equal(pct(d.productivityLunch), p.prodLunch, `Productivity considering Lunch ${at}`);
  }
});

test("OK QTY = TOTAL − Total Defects — the paper's one typo row (ANJU 14/05: OK 324 > TOTAL 317) reads 298", () => {
  for (const p of PAPER) {
    const c = rawCastingRowCalc(formRow(p));
    const want = p.total - (p.blow || 0) - (p.crack || 0) - (p.other || 0);
    assert.equal(c.okQty, want);
    assert.equal(c.totalDefect, want === p.total ? 0 : p.total - want);
    if (p.okOnPaper !== want) assert.deepEqual([p.date, p.worker, p.okOnPaper, c.okQty], ["2024-05-14", "ANJU", 324, 298]);
  }
  // Quality reads the derived OK.
  const typo = rawCastingRowCalc(formRow(find("2024-05-14", "ANJU", "14:10")));
  assert.ok(close(typo.quality, 298 / 317));
});

test("each entry is worked out on its own: MANJU 10/05 keeps 88.52% / 94.62% and 94.44%, not a combined figure", () => {
  const rows = [find("2024-05-10", "MANJU", "16:00"), find("2024-05-10", "MANJU", "08:15")].map((p) => formRow(p));
  // rawCastingDayCalc answers in Start Time order.
  const [morning, evening] = rawCastingDayCalc(rows);
  assert.deepEqual([pct(morning.productivity), pct(morning.productivityLunch)], [88.52, 94.62]);
  assert.deepEqual([pct(evening.productivity), pct(evening.productivityLunch)], [94.44, 94.44]);
  assert.ok(close(morning.unreportedMin, 23.4));
  assert.ok(close(evening.unreportedMin, 10));
  // Overlapping entries of one worker are fine and stay their own too (MANJU 15/05).
  const day15 = rawCastingDayCalc(PAPER.filter((p) => p.date === "2024-05-15" && p.worker === "MANJU").map((p) => formRow(p)));
  assert.deepEqual(day15.map((d) => pct(d.productivity)), [95.6, 91.49, 90.05]);
});

test("on Process Master's 12 h lock the worker's day is combined once, as on every other sheet", () => {
  const rows = [find("2024-05-10", "MANJU", "08:15"), find("2024-05-10", "MANJU", "16:00")].map((p) =>
    formRow(p, { plannedOperatorShiftHours: 12, plannedLocked: true }),
  );
  const [a, b] = rawCastingDayCalc(rows);
  assert.equal(a.productivity, b.productivity);
  // 12 h once for the day; 6.86 + 2.8333 h inspected; 30 min lunch.
  assert.ok(close(a.productivity, (6.86 + 2.833333333333333) / 12));
  assert.ok(close(a.productivityLunch, (6.86 + 2.833333333333333) / (12 - 0.5)));
  assert.ok(close(a.unreportedMin, 720 - (6.86 + 2.833333333333333) * 60 - 30));
});

test("Other Activity is off both Productivity figures and counts in Unreported; Other idle lowers neither Productivity", () => {
  const p = find("2024-05-10", "MANJU", "08:15");
  const [d] = rawCastingDayCalc([formRow(p, { otherActivity: "M-SEAL FILING", otherActivityMin: 45 })]);
  assert.ok(close(d.productivity, 6.86 / (7.75 - 0.75)));
  assert.ok(close(d.productivityLunch, 6.86 / (7.75 - 0.75 - 0.5)));
  assert.ok(close(d.unreportedMin, 465 - 6.86 * 60 - 45 - 30));
  const [o] = rawCastingDayCalc([formRow(p, { otherMin: 20, otherMinRemark: "x" })]);
  assert.equal(pct(o.productivity), 88.52);
  assert.ok(close(o.unreportedMin, 23.4 - 20));
});

test("RAW CASTING is never taken for another process, nor another for it", () => {
  const raw = { processName: "RAW CASTING" };
  const others = [
    "CNC", "VMC", "SPM", "RIVET", "PRESS", "CONTACT", "TROBE", "SPRING FOR PINS", "AFTER POWDER COATING", "RUBBER",
    "PRINTING", "INJECTION MOULDING", "BEFORE POWDER COATING", "MODULAR FRAME DRILLING", "MODULAR FRAME ASSEMBLY",
  ].map((processName) => ({ processName }));
  const matchers = [
    isPowderCoatingProcess, isBpcProcess, isPrintingProcess, isInjectionProcess, isRubberProcess, isSpringProcess,
    isContactProcess, isTrobeProcess, isPressProcess, isRivetProcess, isSpmProcess, isCncProcess, isVmcProcess,
  ];
  assert.equal(isRawCastingProcess(raw), true);
  for (const is of matchers) assert.equal(is(raw), false, `${is.name} takes RAW CASTING`);
  for (const o of others) assert.equal(isRawCastingProcess(o), false, `RAW CASTING takes ${o.processName}`);
  // Linked to its page, by the page alone — and not taken for CNC's "/data-entry".
  const linked = { processName: "Anything", dataEntryMenu: "/hqepl/production/raw-casting-data-entry" };
  assert.equal(isRawCastingProcess(linked), true);
  for (const is of matchers) assert.equal(is(linked), false, `${is.name} takes the RAW CASTING page`);
  assert.equal(isRawCastingProcess({ processName: "RAW CASTING", dataEntryMenu: "/hqepl/production/powder-coating-data-entry" }), false);
  // The dashboard reads it as its own worker process (Manage Role's page-by-name
  // fallback is checked on the server: utils/processAccess.test.js).
  assert.equal(isWorkerProcess(raw), true);
  assert.deepEqual(stoppageKeysFor(raw), ["lunchMin", "otherMin"]);
});

test("the dashboard's Rejection by Reason names this sheet's three defects", () => {
  const rows = PAPER.map((p) => ({ ...formRow(p), okQty: rawCastingRowCalc(formRow(p)).okQty, runQtyBasis: "total", calcMode: "perEntry" }));
  const s = summarize(rows);
  const want = { "Blow Holes Casting": 0, "Crack/Damage Casting": 0, Other: 0 };
  for (const p of PAPER) {
    want["Blow Holes Casting"] += p.blow || 0;
    want["Crack/Damage Casting"] += p.crack || 0;
    want.Other += p.other || 0;
  }
  assert.deepEqual(s.rejectByReason, want);
  assert.deepEqual(Object.keys(s.rejectByReason).sort(), [...RAW_CASTING_DEFECTS].sort());
});

const valid = (o = {}) => ({ ...formRow(find("2024-05-10", "MANJU", "08:15")), plannedOperatorShiftHours: "7.75", ...o });

test("a paper row is valid as typed; the defects can't add up to more than TOTAL QTY", () => {
  assert.deepEqual(validateRawCastingEntry(valid()), {});
  assert.deepEqual(validateRawCastingEntry(valid({ rejectBreakdown: { Other: "3" } })), {}, '"Other" needs no remark');
  assert.match(validateRawCastingEntry(valid({ actualQty: 10 })).rejectBreakdown, /Total Defects \(18\) can't be more than TOTAL QTY \(10\)/);
  assert.match(validateRawCastingEntry(valid({ rejectBreakdown: { Other: "1.5" } })).rejectBreakdown, /whole numbers/);
});

test("required fields are named in the sheet's words; a Non Working day needs only Date and Worker", () => {
  const e = validateRawCastingEntry({ date: "2024-05-10", machine: "w1" });
  assert.equal(e.itemName, "Item Name is required");
  assert.equal(e.totalCycleSec, "Standard Inspection Time per Piece is required");
  assert.equal(e.machineOnTime, "Inspection Start Time is required");
  assert.equal(e.machineOffTime, "Inspection End Time is required");
  assert.equal(e.actualQty, "TOTAL QTY is required");
  assert.equal(e.plannedOperatorShiftHours, "Planned Operator Shift is required");
  assert.equal(validateRawCastingEntry({ date: "2024-05-10" }).machine, "Worker Name is required");
  assert.deepEqual(validateRawCastingEntry({ date: "2024-05-12", machine: "w1", workingMode: "Non Working", remarks: "W.OFF" }), {});
});

test("TOTAL above Ideal is allowed (OEE Review); Planned and Idle + Other Activity stay within their limits", () => {
  assert.deepEqual(validateRawCastingEntry(valid({ actualQty: 900, rejectBreakdown: {} })), {});
  assert.match(validateRawCastingEntry(valid({ plannedOperatorShiftHours: "7.5" })).plannedOperatorShiftHours, /can't be less than the Inspection Working Hours \(7:45\)/);
  assert.match(
    validateRawCastingEntry(valid({ lunchMin: 300, otherMin: 100, otherMinRemark: "x", otherActivityMin: 66, otherActivity: "Packing" })).stoppageTotal,
    /Idle Time \+ Other Activity is 466 min but the Inspection Working Hours are only 465 min/,
  );
  assert.match(validateRawCastingEntry(valid({ otherMin: 5 })).otherMinRemark, /Remark is required/);
  assert.match(validateRawCastingEntry(valid({ otherActivityMin: 5 })).otherActivity, /Say what the other activity was/);
});

test(`up to ${RAW_CASTING_MAX_ENTRIES_PER_DAY} entries a day per worker; other sheets keep ${MAX_ENTRIES_PER_DAY}`, () => {
  const block = { date: "2024-05-15", machine: "w1" };
  const occupied = (n) => ({ "w1|2024-05-15": Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "10:10", machineOffTime: "16:30" })) });
  assert.deepEqual(slotsFullErrors([block], occupied(RAW_CASTING_MAX_ENTRIES_PER_DAY - 1), { max: RAW_CASTING_MAX_ENTRIES_PER_DAY })[0], {});
  assert.match(
    slotsFullErrors([block], occupied(RAW_CASTING_MAX_ENTRIES_PER_DAY), { max: RAW_CASTING_MAX_ENTRIES_PER_DAY, who: () => "MANJU" })[0].machine,
    new RegExp(`MANJU already has ${RAW_CASTING_MAX_ENTRIES_PER_DAY} entries`),
  );
});
