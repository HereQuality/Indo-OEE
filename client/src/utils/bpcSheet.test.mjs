// Run: npm test   (bundles this with Vite's esbuild, then node:test — no extra deps)
// The BEFORE POWDER COATING sheet's adapter (utils/bpcSheet.js), rules
// (utils/bpcValidation.js) and the shared pieces it extends.
import test from "node:test";
import assert from "node:assert/strict";
import { BPC_REJECT_REASONS, BPC_MAX_ENTRIES_PER_DAY, bpcDayCalc, bpcRowCalc, isBpcProcess, rejectSplitTotal } from "./bpcSheet.js";
import { validateBpcEntry } from "./bpcValidation.js";
import { isPowderCoatingProcess } from "./powderCoatingSheet.js";
import { quantityFormValues, rejectPayload } from "./quantityRules.js";
import { MAX_ENTRIES_PER_DAY, slotsFullErrors } from "./entryValidation.js";
import { isWorkerProcess, stoppageKeysFor } from "./processDashboard.js";
import { spanMinutes } from "./productionSheet.js";

// Rows from the paper sheet, as the form saves them: no runQtyBasis on the row
// (the adapter adds it), Planned typed = the Machine Shift (unlocked process).
const PAPER = [
  { on: "08:15", off: "15:00", std: 27, total: 796, ok: 795, lunch: 30, oee: [88.44, 95.52], unrep: 16.8, eff: 5.97, ideal: 900 },
  { on: "15:00", off: "18:00", std: 30, total: 345, ok: 286, lunch: 0, oee: [95.83, 95.83], unrep: 7.5, eff: 2.875, ideal: 360 },
  { on: "15:00", off: "16:00", std: 35, total: 90, ok: 90, lunch: 0, oee: [87.5, 87.5], unrep: 7.5, eff: 0.875, ideal: 102.8571429 },
  { on: "11:15", off: "13:45", std: 40, total: 150, ok: 150, lunch: 30, oee: [66.67, 83.33], unrep: 20, eff: 1.666666667, ideal: 225 },
  { on: "10:00", off: "14:40", std: 16, total: 913, ok: 0, lunch: 30, oee: [86.95, 97.39], unrep: 6.533333333, eff: 4.057777778, ideal: 1050 },
  { on: "09:15", off: "11:00", std: 13, total: 452, ok: 452, lunch: 0, oee: [93.27, 93.27], unrep: 7.066666667, eff: 1.632222222, ideal: 484.6153846 },
];
const formRow = (p, o = {}) => ({
  _id: `${p.on}-${p.off}`,
  date: "2026-05-13",
  machine: "op1",
  itemName: "BODY",
  totalCycleSec: p.std,
  machineOnTime: p.on,
  machineOffTime: p.off,
  actualQty: p.total,
  okQty: p.ok,
  lunchMin: p.lunch,
  plannedOperatorShiftHours: spanMinutes(p.on, p.off) / 60,
  ...o,
});
const pct = (v) => Math.round(v * 10000) / 100;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("every paper row: Ideal not rounded down, Ideal/Hours = 3600 ÷ Std, Effective on TOTAL QTY", () => {
  for (const p of PAPER) {
    const c = bpcRowCalc(formRow(p));
    assert.ok(close(c.idealQty, p.ideal, 1e-6), `Ideal ${p.on}: ${c.idealQty}`);
    assert.equal(c.idealQtyFloor, Math.floor(p.ideal + 1e-9));
    assert.ok(close(c.idealQtyPerHour, 3600 / p.std), `Ideal/Hours ${p.on}`);
    assert.ok(close(c.effectiveHours, p.eff), `Effective ${p.on}: ${c.effectiveHours}`);
    assert.equal(c.rejectedQty, p.total - p.ok);
  }
});

test("every paper row: the two OEE columns and Unreported Time are the entry's own", () => {
  // All six on one operator's date: each still gets its own figures (unlocked).
  const rows = PAPER.map((p) => formRow(p));
  const day = bpcDayCalc(rows);
  const byId = Object.fromEntries(
    [...rows].sort((a, b) => spanMinutes("00:00", a.machineOnTime) - spanMinutes("00:00", b.machineOnTime)).map((r, i) => [r._id, day[i]]),
  );
  for (const p of PAPER) {
    const d = byId[`${p.on}-${p.off}`];
    assert.deepEqual([pct(d.oeeLosses), pct(d.oeeLunch)], p.oee, `OEE ${p.on}`);
    assert.ok(close(d.unreportedMin, p.unrep, 1e-6), `Unreported ${p.on}: ${d.unreportedMin}`);
  }
});

test("OEE considering losses leaves Lunch out of the losses, takes Setup / B.D. / Other off", () => {
  // 08:00–12:00, 20 s, 600 pcs = 3.333 h; Setup 10, B.D. 20, Other 6, Lunch 30.
  const r = formRow({ on: "08:00", off: "12:00", std: 20, total: 600, ok: 600, lunch: 30 }, { setupMin: 10, bdMechMin: 20, otherMin: 6 });
  const [d] = bpcDayCalc([r]);
  assert.ok(close(d.oeeLosses, (600 * 20) / 3600 / (4 - 36 / 60)));
  assert.ok(close(d.oeeLunch, (600 * 20) / 3600 / (4 - 30 / 60)));
  // Unreported = 240 − 200 − (10 + 20 + 30 + 6).
  assert.ok(close(d.unreportedMin, 240 - 200 - 66));
  assert.equal(bpcRowCalc(r).totalStoppageMin, 66, "Total Idle Time counts B.D. (bdMechMin)");
});

test("on Process Master's 12 h lock the operator's day is combined once", () => {
  const rows = PAPER.slice(0, 2).map((p) => formRow(p, { plannedOperatorShiftHours: 12, plannedLocked: true }));
  const [a, b] = bpcDayCalc(rows);
  assert.equal(a.oeeLosses, b.oeeLosses);
  assert.ok(close(a.oeeLunch, (5.97 + 2.875) / (12 - 0.5)));
});

test("BEFORE POWDER COATING is told apart from AFTER POWDER COATING", () => {
  const bpc = { processName: "BEFORE POWDER COATING" };
  const apc = { processName: "AFTER POWDER COATING" };
  assert.equal(isBpcProcess(bpc), true);
  assert.equal(isBpcProcess(apc), false);
  assert.equal(isPowderCoatingProcess(bpc), false);
  assert.equal(isPowderCoatingProcess(apc), true);
  const linked = { processName: "Anything", dataEntryMenu: "/hqepl/production/before-powder-coating-data-entry" };
  assert.equal(isBpcProcess(linked), true);
  assert.equal(isPowderCoatingProcess(linked), false);
  assert.equal(isWorkerProcess(bpc), true, "per operator on the dashboard");
  assert.deepEqual(stoppageKeysFor(bpc), ["setupMin", "bdMechMin", "lunchMin", "otherMin"]);
});

test("the Rejection Master keeps this sheet's own reasons; every other sheet keeps the CNC list", () => {
  const row = { actualQty: 10, okQty: 4, rejectedQty: 6, rejectBreakdown: { "Blow Holes Casting": 2, "TAP Broken Casting": 3, Other: 1 } };
  assert.deepEqual(quantityFormValues(row, BPC_REJECT_REASONS).rejectBreakdown, row.rejectBreakdown);
  assert.deepEqual(quantityFormValues(row).rejectBreakdown, { Other: 1 }, "the CNC list has only Other in common");
  assert.equal(rejectSplitTotal(row), 6);
  const payload = rejectPayload({ rejectBreakdown: { "Crack/Damage Casting": "4", Threading: "" }, rejectOtherRemark: "x" });
  assert.deepEqual(payload, { rejectBreakdown: { "Crack/Damage Casting": 4 }, rejectReason: "Crack/Damage Casting", rejectOtherRemark: "" });
});

const valid = (o = {}) => ({ ...formRow(PAPER[0]), plannedOperatorShiftHours: "6.75", rejectBreakdown: { "Blow Holes Casting": "1" }, ...o });

test("a paper row is valid as typed; the split must add up and Other needs a remark", () => {
  assert.deepEqual(validateBpcEntry(valid()), {});
  assert.match(validateBpcEntry(valid({ rejectBreakdown: {} })).rejectBreakdown, /1 of 1 rejected piece/);
  assert.deepEqual(validateBpcEntry(valid({ rejectBreakdown: { Other: "1" }, rejectOtherRemark: "chipped" })), {});
  assert.match(validateBpcEntry(valid({ rejectBreakdown: { Other: "1" } })).rejectOtherRemark, /Remark is required/);
});

test("required fields are named in the sheet's words", () => {
  const e = validateBpcEntry({ date: "2026-05-13", machine: "op1" });
  assert.equal(e.itemName, "Item Name is required");
  assert.equal(e.totalCycleSec, "Standard Time per Piece is required");
  assert.equal(e.machineOnTime, "Machine ON Time is required");
  assert.equal(e.actualQty, "TOTAL QTY is required");
  assert.equal(e.okQty, "OK QTY is required");
  assert.equal(validateBpcEntry({ date: "2026-05-13" }).machine, "Operator is required");
  assert.deepEqual(validateBpcEntry({ date: "2026-05-13", machine: "op1", workingMode: "Non Working" }), {});
});

test("TOTAL above Ideal is allowed (OEE Review); Planned and Idle Time stay within their limits", () => {
  assert.deepEqual(validateBpcEntry(valid({ actualQty: 950, okQty: 950, rejectBreakdown: {} })), {});
  assert.match(validateBpcEntry(valid({ plannedOperatorShiftHours: "6.5" })).plannedOperatorShiftHours, /can't be less than the Machine Shift Time \(6:45\)/);
  assert.match(validateBpcEntry(valid({ setupMin: 200, bdMechMin: 176 })).stoppageTotal, /Total Idle Time is 406 min but the Machine Shift Time is only 405 min/);
  assert.match(validateBpcEntry(valid({ otherMin: 5 })).otherMinRemark, /Remark is required/);
  assert.match(validateBpcEntry(valid({ okQty: 800 })).okQty, /OK can't be more than TOTAL QTY \(796\)/);
});

test(`up to ${BPC_MAX_ENTRIES_PER_DAY} entries a day per operator (the paper has six); other sheets keep ${MAX_ENTRIES_PER_DAY}`, () => {
  assert.ok(BPC_MAX_ENTRIES_PER_DAY >= 6);
  const occupied = { "op1|2026-05-13": Array.from({ length: 5 }, (_, i) => ({ slot: i + 1, machineOnTime: "", machineOffTime: "" })) };
  const block = { date: "2026-05-13", machine: "op1" };
  assert.deepEqual(slotsFullErrors([block], occupied, { max: BPC_MAX_ENTRIES_PER_DAY })[0], {}, "a sixth is fine");
  assert.match(slotsFullErrors([block], occupied)[0].machine, /already has 3 entries/, "the default is unchanged");
  const full = { "op1|2026-05-13": Array.from({ length: BPC_MAX_ENTRIES_PER_DAY }, (_, i) => ({ slot: i + 1 })) };
  assert.match(slotsFullErrors([block], full, { max: BPC_MAX_ENTRIES_PER_DAY, who: () => "SUREKHA" })[0].machine, new RegExp(`SUREKHA already has ${BPC_MAX_ENTRIES_PER_DAY} entries`));
});
