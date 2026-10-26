// Run: npm test   (bundles this with Vite's esbuild, then node:test — no extra deps)
// The MODULAR FRAME ASSEMBLY sheet's adapter (utils/mfaSheet.js), rules
// (utils/mfaValidation.js) and the shared pieces it plugs into.
import test from "node:test";
import assert from "node:assert/strict";
import { MFA_LABELS, MFA_MAX_ENTRIES_PER_DAY, isMfaProcess, mfaDayCalc, mfaRowCalc } from "./mfaSheet.js";
import { validateMfaEntry } from "./mfaValidation.js";
import { isMfdProcess } from "./mfdSheet.js";
import { isFinalAssemblyProcess } from "./finalAssemblySheet.js";
import { isRawCastingProcess } from "./rawCastingSheet.js";
import { isEmbossingProcess } from "./embossingSheet.js";
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
import { slotsFullErrors } from "./entryValidation.js";
import { isWorkerProcess, stoppageKeysFor } from "./processDashboard.js";
import { spanMinutes } from "./productionSheet.js";

// The paper sheet's eight worker rows (pasted by the user 2026-10-26); its nine
// day-only rows ("Other machining Work" / W.OFF) have no worker. Row 1's date
// is written MM-DD (05-13-2024). Ideal and Unreported are as the paper rounds
// them where it does (row 1: 788.37 and 13.3).
// [date, item, worker, start, end, std, total, ok, ideal (dp), idealPerHour, lunch,
//  effective (hr), unreported (dp), productivity %, productivity considering lunch %]
const PAPER = [
  ["2024-05-13", "24 PIN FRAME", "PRATIKSHA", "08:30", "17:55", 43, 728, 390, [788.37, 2], 83.72093023, 30, 8.695555556, [13.3, 1], 92.34, 97.52],
  ["2024-05-14", "24 PIN FRAME", "PRATIKSHA", "08:10", "10:50", 80, 192, 140, [120, 6], 45, 0, 4.266666667, [-96, 6], 160.0, 160.0],
  ["2024-05-14", "24 PIN FRAME", "PRATIKSHA", "10:50", "11:24", 80, 140, 140, [25.5, 6], 45, 0, 3.111111111, [-152.6666667, 6], 549.02, 549.02],
  ["2024-05-11", "24 PIN FRAME", "ANJALI", "08:15", "17:55", 80, 180, 180, [435, 6], 45, 30, 4, [310, 6], 41.38, 43.64],
  ["2024-05-28", "10 PIN FRAME ASSEMBLY", "MEENA", "16:30", "19:00", 170, 40, 40, [52.94117647, 6], 21.17647059, 0, 1.888888889, [36.66666667, 6], 75.56, 75.56],
  ["2024-05-28", "24 PIN FRAME ASSEMBLY", "JINKAL", "16:30", "17:10", 80, 35, 35, [30, 6], 45, 0, 0.7777777778, [-6.666666667, 6], 116.67, 116.67],
  ["2024-05-28", "24 PIN FRAMEASSEMBLY", "POONAM", "16:40", "17:30", 80, 49, 49, [37.5, 6], 45, 0, 1.088888889, [-15.33333333, 6], 130.67, 130.67],
  ["2024-05-28", "10 PIN FRAME ASSEMBLY", "POONAM", "17:35", "17:55", 170, 12, 12, [7.058823529, 6], 21.17647059, 0, 0.5666666667, [-14, 6], 170.0, 170.0],
].map(([date, item, worker, on, off, std, total, ok, ideal, idealPerHour, lunch, eff, unrep, prod, prodLunch]) => ({
  date, item, worker, on, off, std, total, ok, ideal, idealPerHour, lunch, eff, unrep, prod, prodLunch,
}));

// A paper row as the form saves it: Planned typed = the Assembly Working Hours
// (the paper has no Planned column), the process unlocked.
const formRow = (p, o = {}) => ({
  _id: `${p.date}|${p.worker}|${p.on}`,
  date: p.date,
  machine: p.worker,
  itemName: p.item,
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
const round = (v, dp) => Number(v.toFixed(dp));
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const find = (date, worker, on) => PAPER.find((p) => p.date === date && p.worker === worker && p.on === on);

test(`all ${PAPER.length} worker rows: Ideal (not rounded down), Ideal/Hour, Effective, Unreported and both Productivity % are the paper's`, () => {
  for (const p of PAPER) {
    const at = `${p.date} ${p.worker} ${p.on}`;
    const c = mfaRowCalc(formRow(p));
    assert.equal(round(c.idealQty, p.ideal[1]), round(p.ideal[0], p.ideal[1]), `Ideal ${at}: ${c.idealQty}`);
    assert.equal(c.idealQtyFloor, Math.floor(c.idealQty + 1e-9));
    assert.ok(close(c.idealQtyPerHour, p.idealPerHour), `Ideal/Hour ${at}`);
    assert.ok(close(c.effectiveHours, p.eff), `Effective ${at}: ${c.effectiveHours}`);
    assert.equal(c.rejectedQty, p.total - p.ok, `Rejected ${at}`);
    const [d] = mfaDayCalc([formRow(p)]);
    assert.equal(round(d.unreportedMin, p.unrep[1]), round(p.unrep[0], p.unrep[1]), `Unreported ${at}: ${d.unreportedMin}`);
    assert.equal(pct(d.productivity), p.prod, `Productivity ${at}`);
    assert.equal(pct(d.productivityLunch), p.prodLunch, `Productivity considering Lunch ${at}`);
  }
});

test("each entry is worked out on its own: PRATIKSHA 14/05 keeps 160.00% and 549.02%", () => {
  const rows = [find("2024-05-14", "PRATIKSHA", "10:50"), find("2024-05-14", "PRATIKSHA", "08:10")].map((p) => formRow(p));
  // mfaDayCalc answers in Start Time order.
  const [first, second] = mfaDayCalc(rows);
  assert.deepEqual([pct(first.productivity), pct(first.productivityLunch)], [160, 160]);
  assert.deepEqual([pct(second.productivity), pct(second.productivityLunch)], [549.02, 549.02]);
  assert.ok(close(first.unreportedMin, -96));
  assert.ok(close(second.unreportedMin, -152.6666667, 1e-6));
  // POONAM 28/05's two entries stay their own too: 130.67% and 170.00%.
  const poonam = mfaDayCalc(PAPER.filter((p) => p.worker === "POONAM").map((p) => formRow(p)));
  assert.deepEqual(poonam.map((d) => pct(d.productivity)), [130.67, 170]);
});

test("on Process Master's 12 h lock the worker's day is combined once, as on every other sheet", () => {
  const rows = [find("2024-05-14", "PRATIKSHA", "08:10"), find("2024-05-14", "PRATIKSHA", "10:50")].map((p) =>
    formRow(p, { plannedOperatorShiftHours: 12, plannedLocked: true }),
  );
  const [a, b] = mfaDayCalc(rows);
  assert.equal(a.productivity, b.productivity);
  const eff = 4.266666666666667 + 3.111111111111111;
  assert.ok(close(a.productivity, eff / 12));
  assert.ok(close(a.productivityLunch, eff / 12));
  assert.ok(close(a.unreportedMin, 720 - eff * 60));
});

test("Other Activity is off both Productivity figures and counts in Unreported; Other idle lowers neither Productivity", () => {
  const p = find("2024-05-11", "ANJALI", "08:15");
  const [d] = mfaDayCalc([formRow(p, { otherActivity: "Other machining Work", otherActivityMin: 60 })]);
  const planned = 580 / 60;
  assert.ok(close(d.productivity, 4 / (planned - 1)));
  assert.ok(close(d.productivityLunch, 4 / (planned - 1 - 0.5)));
  assert.ok(close(d.unreportedMin, 580 - 240 - 60 - 30));
  const [o] = mfaDayCalc([formRow(p, { otherMin: 20, otherMinRemark: "x" })]);
  assert.equal(pct(o.productivity), 41.38);
  assert.ok(close(o.unreportedMin, 310 - 20));
});

test("MODULAR FRAME ASSEMBLY is never taken for MODULAR FRAME DRILLING, FINAL ASSEMBLY or any other process — nor they for it", () => {
  const mfa = { processName: "MODULAR FRAME ASSEMBLY" };
  const others = [
    "MODULAR FRAME DRILLING", "FINAL ASSEMBLY", "MODULAR FRAME", "FRAME ASSEMBLY", "ASSEMBLY", "RAW CASTING", "EMBOSSING",
    "CNC", "VMC", "SPM", "RIVET", "PRESS", "CONTACT", "TROBE", "SPRING FOR PINS", "AFTER POWDER COATING", "RUBBER",
    "PRINTING", "INJECTION MOULDING", "BEFORE POWDER COATING",
  ].map((processName) => ({ processName }));
  const matchers = [
    isMfdProcess, isFinalAssemblyProcess, isRawCastingProcess, isEmbossingProcess, isPowderCoatingProcess, isBpcProcess, isPrintingProcess,
    isInjectionProcess, isRubberProcess, isSpringProcess, isContactProcess, isTrobeProcess, isPressProcess, isRivetProcess, isSpmProcess,
    isCncProcess, isVmcProcess,
  ];
  assert.equal(isMfaProcess(mfa), true);
  assert.equal(isMfaProcess({ processName: "Modular  Frame Assembly" }), true);
  for (const is of matchers) assert.equal(is(mfa), false, `${is.name} takes MODULAR FRAME ASSEMBLY`);
  for (const o of others) assert.equal(isMfaProcess(o), false, `MODULAR FRAME ASSEMBLY takes ${o.processName}`);
  assert.equal(isMfdProcess({ processName: "MODULAR FRAME DRILLING" }), true);
  assert.equal(isFinalAssemblyProcess({ processName: "FINAL ASSEMBLY" }), true);
  // Linked to its page, by the page alone.
  const linked = { processName: "Anything", dataEntryMenu: "/hqepl/production/modular-frame-assembly-data-entry" };
  assert.equal(isMfaProcess(linked), true);
  for (const is of matchers) assert.equal(is(linked), false, `${is.name} takes the MODULAR FRAME ASSEMBLY page`);
  assert.equal(isMfaProcess({ processName: "MODULAR FRAME ASSEMBLY", dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry" }), false);
  // The dashboard reads it as its own worker process.
  assert.equal(isWorkerProcess(mfa), true);
  assert.deepEqual(stoppageKeysFor(mfa), ["lunchMin", "otherMin"]);
});

const valid = (o = {}) => ({ ...formRow(find("2024-05-13", "PRATIKSHA", "08:30")), plannedOperatorShiftHours: "9.42", ...o });

test("a paper row is valid as typed — Rejected without any reason split, as on INJECTION MOULDING", () => {
  // 9.42 h is 9 h 25 min, the Assembly Working Hours.
  assert.deepEqual(validateMfaEntry(valid()), {});
  assert.match(validateMfaEntry(valid({ okQty: 800 })).okQty, /OK can't be more than TOTAL QTY \(728\)/);
  assert.match(validateMfaEntry(valid({ actualQty: 728.5 })).actualQty, /whole number/);
});

test("required fields are named in the sheet's words — the assembly labels; a Non Working day needs only Date and Worker", () => {
  const e = validateMfaEntry({ date: "2024-05-13", machine: "w1" });
  assert.equal(e.itemName, "Item Name is required");
  assert.equal(e.totalCycleSec, `${MFA_LABELS.cycle} is required`);
  assert.equal(e.machineOnTime, "Assembly Start Time is required");
  assert.equal(e.machineOffTime, "Assembly End Time is required");
  assert.equal(e.actualQty, "TOTAL QTY is required");
  assert.equal(e.okQty, "OK QTY is required");
  assert.equal(validateMfaEntry({ date: "2024-05-13" }).machine, "Worker Name is required");
  assert.deepEqual(validateMfaEntry({ date: "2024-05-19", machine: "w1", workingMode: "Non Working", remarks: "W.OFF" }), {});
});

test("TOTAL above Ideal is allowed (OEE Review); Planned and Idle + Other Activity stay within their limits", () => {
  // PRATIKSHA 14/05 10:50–11:24: 140 pieces where 25.5 was ideal.
  assert.deepEqual(validateMfaEntry({ ...formRow(find("2024-05-14", "PRATIKSHA", "10:50")), plannedOperatorShiftHours: "0.57" }), {});
  assert.match(validateMfaEntry(valid({ plannedOperatorShiftHours: "9" })).plannedOperatorShiftHours, /can't be less than the Assembly Working Hours \(9:25\)/);
  assert.match(
    validateMfaEntry(valid({ lunchMin: 300, otherMin: 200, otherMinRemark: "x", otherActivityMin: 66, otherActivity: "Machining" })).stoppageTotal,
    /Idle Time \+ Other Activity is 566 min but the Assembly Working Hours are only 565 min/,
  );
  assert.match(validateMfaEntry(valid({ otherMin: 5 })).otherMinRemark, /Remark is required/);
});

test(`up to ${MFA_MAX_ENTRIES_PER_DAY} entries a day per worker`, () => {
  const block = { date: "2024-05-28", machine: "w1" };
  const occupied = (n) => ({ "w1|2024-05-28": Array.from({ length: n }, (_, i) => ({ slot: i + 1, machineOnTime: "16:30", machineOffTime: "17:10" })) });
  assert.deepEqual(slotsFullErrors([block], occupied(MFA_MAX_ENTRIES_PER_DAY - 1), { max: MFA_MAX_ENTRIES_PER_DAY })[0], {});
  assert.match(
    slotsFullErrors([block], occupied(MFA_MAX_ENTRIES_PER_DAY), { max: MFA_MAX_ENTRIES_PER_DAY, who: () => "POONAM" })[0].machine,
    new RegExp(`POONAM already has ${MFA_MAX_ENTRIES_PER_DAY} entries`),
  );
});
