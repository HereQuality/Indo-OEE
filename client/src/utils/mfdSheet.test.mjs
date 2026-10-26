import test from "node:test";
import assert from "node:assert/strict";
import { dayCalc, spanMinutes } from "./productionSheet.js";
import { MFD_MAX_SLOTS, fmtIdeal, fmtIdealPerHour, isMfdProcess, mfdDayCalc, mfdRowCalc } from "./mfdSheet.js";
import { validateMfdEntry } from "./mfdValidation.js";
import { qtyNotice } from "./limitNotice.js";
import { summarize } from "./processDashboard.js";
import { isCncProcess, isVmcProcess } from "./vmcSheet.js";
import { isSpmProcess } from "./spmSheet.js";
import { isRivetProcess } from "./rivetSheet.js";
import { isPressProcess } from "./pressSheet.js";
import { isContactProcess } from "./contactSheet.js";
import { isTrobeProcess } from "./trobeSheet.js";
import { isSpringProcess } from "./springSheet.js";
import { isPowderCoatingProcess } from "./powderCoatingSheet.js";
import { isRubberProcess } from "./rubberSheet.js";
import { isInjectionProcess } from "./injectionSheet.js";
import { isBpcProcess } from "./bpcSheet.js";
import { isPrintingProcess } from "./printingSheet.js";

/*
 * The MODULAR FRAME DRILLING sheet — its adapter (utils/mfdSheet.js), its form
 * rules (utils/mfdValidation.js) and the dashboard's per-entry figures, against
 * all 19 rows of the paper sheet (pasted by the user 2026-10-26).
 *
 * Every figure on the paper matches except the ones built on Effective Machine
 * Run Time: the paper's Excel works Effective out as (OK + Cycle) × Cycle ÷ 3600
 * — a spreadsheet slip — and the user chose the standard rule, OK × Cycle ÷ 3600.
 * So IDEAL Quantity and IDEAL Quantity/Hour are checked against the paper
 * exactly; Effective, Unreported, Efficiency and the three OEE against the
 * standard formula worked out here; and one test shows the paper's own figures
 * come back when its (OK + Cycle) Effective is put through the same formulas.
 */

// [Date, MC NO., Operator, Part Name, Drawing No., Process, Holes, Stroke, Total
//  Cycle Time (s), ON, OFF, ACTUAL OK, Rejected, downtime, the paper's own figures]
const PAPER = [
  ["10-05-2024","4/B","VISHAL","24 PIN FRAME BIG","IE0726","DRILLING",1,1,20,"14:50","15:25",75,0,{},{"shift":0.58,"ideal":105,"idealHr":180,"total":0,"eff":0.53,"unrep":3.33,"effcy":90.48,"oee":[90.48,90.48,90.48]}],
  ["10-05-2024","4/B","VISHAL","24 PIN FRAME BIG","IE0726","DRILLING",2,2,50,"08:15","18:55",99,0,{"materialShiftingMin":115,"lunchMin":30},{"shift":10.67,"ideal":732,"idealHr":68.6,"total":145,"eff":2.07,"unrep":370.83,"effcy":19.4,"oee":[25.08,20.36,20.36]}],
  ["10-05-2024","4/A","LIALBEN","24 PIN FRAME","","DRILLING",2,2,22,"08:15","12:00",462,0,{},{"shift":3.75,"ideal":614,"idealHr":163.6,"total":0,"eff":2.96,"unrep":47.53,"effcy":78.87,"oee":[78.87,78.87,78.87]}],
  ["10-05-2024","4/A","PRATIKSHA","24 PIN FRAME","","DRILLING",2,2,23,"11:00","18:00",946,0,{"lunchMin":30},{"shift":7,"ideal":1017,"idealHr":145.3,"total":30,"eff":6.19,"unrep":18.55,"effcy":88.44,"oee":[95.24,95.24,95.24]}],
  ["10-05-2024","5/B","LILABEN","24 PIN FRAME","","TAPPING",4,4,35,"16:05","18:55",215,0,{},{"shift":2.83,"ideal":291,"idealHr":102.9,"total":0,"eff":2.43,"unrep":24.17,"effcy":85.78,"oee":[85.78,85.78,85.78]}],
  ["10-05-2024","4/E","BHURABHAI","DUST COVER CLAMP","IE0117","DRILLING",2,2,35,"08:15","18:00",900,0,{"lunchMin":30},{"shift":9.75,"ideal":951,"idealHr":97.6,"total":30,"eff":9.09,"unrep":9.58,"effcy":93.23,"oee":[98.27,98.27,98.27]}],
  ["10-05-2024","M/17","MEENA","3 PIN HOOD S/E,PG-11S/C MS,AND T/E,PG13.5 S/C,MS","IE0019/IE0020","DRILLING",1,1,51,"08:00","19:00",666,0,{"lunchMin":30},{"shift":11,"ideal":741,"idealHr":67.4,"total":30,"eff":10.16,"unrep":20.55,"effcy":92.34,"oee":[96.74,96.74,96.74]}],
  ["11-05-2024","4/B","VISHAL","6 PIN FRAME","","DRILLING",2,2,20,"18:15","19:25",162,3,{},{"shift":1.17,"ideal":210,"idealHr":180,"total":0,"eff":1.01,"unrep":9.33,"effcy":86.67,"oee":[86.67,86.67,86.67]}],
  ["11-05-2024","4/E","BHURABHAI","DUST COVER CLAMP","IE0117","DRILLING",2,2,36,"15:40","18:00",140,7,{},{"shift":2.33,"ideal":233,"idealHr":100,"total":0,"eff":1.76,"unrep":34.4,"effcy":75.43,"oee":[75.43,75.43,75.43]}],
  ["11-05-2024","5/B","LILABEN","24 PIN FRAME","","TAPPING",4,4,62,"08:15","15:45",322,0,{"lunchMin":30},{"shift":7.5,"ideal":406,"idealHr":54.2,"total":30,"eff":6.61,"unrep":23.2,"effcy":88.18,"oee":[94.48,94.48,94.48]}],
  ["11-05-2024","4/E","BHURABHAI","8 PIN B/O, D/C,P/C","IE0003","DRILLING",4,4,20,"14:40","15:40",123,0,{},{"shift":1,"ideal":180,"idealHr":180,"total":0,"eff":0.79,"unrep":12.33,"effcy":79.44,"oee":[79.44,79.44,79.44]}],
  ["11-05-2024","4/E","BHURABHAI","DUST COVER CLAMP","IE0117","DRILLING",2,2,4,"08:10","09:00",697,0,{},{"shift":0.83,"ideal":750,"idealHr":900,"total":0,"eff":0.78,"unrep":3.27,"effcy":93.47,"oee":[93.47,93.47,93.47]}],
  ["11-05-2024","M/17","MEENA","3 PIN HOOD S/E,PG-11,S/C,MS","IE0019","DRILLING",1,1,56,"08:10","18:45",600,0,{"lunchMin":30},{"shift":10.58,"ideal":648,"idealHr":61.2,"total":30,"eff":10.2,"unrep":-7.27,"effcy":96.42,"oee":[101.2,101.2,101.2]}],
  ["11-05-2024","4/A","PRATIKSHA","3 PIN B/O,S/C MS","IE0001","DRILLING",4,4,15,"12:30","18:00",1180,0,{},{"shift":5.5,"ideal":1320,"idealHr":240,"total":0,"eff":4.98,"unrep":31.25,"effcy":90.53,"oee":[90.53,90.53,90.53]}],
  ["11-05-2024","4/A","PRATIKSHA","24 PIN FRAME","","DRILLING",4,4,35,"08:10","11:55",311,0,{},{"shift":3.75,"ideal":386,"idealHr":102.9,"total":0,"eff":3.36,"unrep":23.17,"effcy":89.7,"oee":[89.7,89.7,89.7]}],
  ["13-05-2024","4/A","PRATIKSHA","3 PIN B/O,D/C MS","IE0001","DRILLING",2,2,12,"08:10","08:30",67,0,{},{"shift":0.33,"ideal":100,"idealHr":300,"total":0,"eff":0.26,"unrep":4.2,"effcy":79,"oee":[79,79,79]}],
  ["13-05-2024","4/A","PRATIKSHA","24 PIN B/C,L/VCLAMP,HOLE 1S/E","IE0307/A","DRILLING",4,4,15,"11:40","12:00",25,0,{},{"shift":0.33,"ideal":80,"idealHr":240,"total":0,"eff":0.17,"unrep":10,"effcy":50,"oee":[50,50,50]}],
  ["13-05-2024","4/E","BHURABHAI","DUST COVER CLAMP","IE0117","DRRILL/CHAM",2,2,47,"08:10","15:00",425,5,{"lunchMin":30},{"shift":6.83,"ideal":485,"idealHr":71,"total":30,"eff":6.16,"unrep":10.27,"effcy":90.18,"oee":[97.3,97.3,97.3]}],
  ["13-05-2024","4/E","BHURABHAI","DUST COVER CLAMP","IE0117","DRILLING",2,2,45,"15:00","17:30",130,13,{},{"shift":2.5,"ideal":200,"idealHr":80,"total":0,"eff":2.19,"unrep":18.75,"effcy":87.5,"oee":[87.5,87.5,87.5]}],
];

const STOP_KEYS = ["plannedDownMin", "setupMin", "noManPowerMin", "materialShiftingMin", "noMaterialMin", "bdMechMin", "bdEleMin", "noPowerMin", "lunchMin", "otherMin"];

// A paper row as the form saves it: Actual = OK + Rejected, and — the paper
// having no Planned column — Planned Operator Shift typed equal to its Machine
// Shift, on an unlocked process.
const entry = (r, o = {}) => {
  const [date, mc, operator, itemName, drawingNo, operation, noOfHoles, strokeRequired, cycle, on, off, ok, rej, stops] = r;
  return {
    _id: `${date}|${mc}|${on}`,
    date,
    machine: mc,
    operator,
    itemName,
    drawingNo,
    operation,
    noOfHoles,
    strokeRequired,
    totalCycleSec: cycle,
    machineOnTime: on,
    machineOffTime: off,
    actualQty: ok + rej,
    okQty: ok,
    plannedOperatorShiftHours: spanMinutes(on, off) / 60,
    ...stops,
    ...o,
  };
};

const pct2 = (v) => Math.round(v * 10000) / 100;
const close = (a, b, label, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${label}: ${a} vs ${b}`);

// The standard formulas, worked out by hand for one row with a given Effective (hours).
const byHand = (r, effH) => {
  const [, , , , , , , , , on, off, , , stops] = r;
  const H = spanMinutes(on, off) / 60;
  const total = STOP_KEYS.reduce((s, k) => s + (stops[k] || 0), 0);
  const lunch = stops.lunchMin || 0;
  const setup = stops.setupMin || 0;
  return {
    eff: effH,
    unrep: H * 60 - effH * 60 - total,
    effcy: effH / H,
    oee: [effH / (H - total / 60), effH / (H - lunch / 60), effH / (H - lunch / 60 - setup / 60)],
  };
};
const standard = (r) => byHand(r, (r[11] * r[8]) / 3600);
// What the paper's Excel does instead: (OK + Cycle) × Cycle ÷ 3600.
const excel = (r) => byHand(r, ((r[11] + r[8]) * r[8]) / 3600);

test("isMfdProcess: by its Data Entry Page, or by its whole name while not linked — never another process", () => {
  assert.equal(isMfdProcess({ dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry" }), true);
  assert.equal(isMfdProcess({ processName: "MODULAR FRAME DRILLING" }), true);
  assert.equal(isMfdProcess({ processName: "Modular  Frame Drilling" }), true);
  assert.equal(isMfdProcess({ processName: "MODULAR FRAME DRILLING", dataEntryMenu: "/hqepl/production/cnc-data-entry" }), false);
  // "DRILLING" alone (or a CNC drilling process) is not this sheet.
  for (const processName of ["DRILLING", "CNC DRILLING", "MODULAR FRAME", "INJECTION MOULDING", "PRINTING", "BEFORE POWDER COATING", "RAW CASTING"]) {
    assert.equal(isMfdProcess({ processName }), false, processName);
  }
  // …and no other sheet takes MODULAR FRAME DRILLING, by name or by its page.
  const others = [isCncProcess, isVmcProcess, isSpmProcess, isRivetProcess, isPressProcess, isContactProcess, isTrobeProcess, isSpringProcess, isPowderCoatingProcess, isRubberProcess, isInjectionProcess, isBpcProcess, isPrintingProcess];
  for (const is of others) {
    assert.equal(is({ processName: "MODULAR FRAME DRILLING" }), false, `${is.name} by name`);
    assert.equal(is({ processName: "X", dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry" }), false, `${is.name} by page`);
  }
});

test("all 19 rows: Machine Shift, IDEAL Quantity (0 dp), IDEAL Quantity/Hour (1 dp) and Total stoppage equal the paper exactly", () => {
  assert.equal(PAPER.length, 19);
  for (const r of PAPER) {
    const c = mfdRowCalc(entry(r));
    const paper = r[14];
    const label = `${r[0]} ${r[1]} ${r[9]}`;
    assert.equal(c.shiftHours.toFixed(2), paper.shift.toFixed(2), `Shift ${label}`);
    assert.equal(fmtIdeal(c.idealQtyExact), String(paper.ideal), `IDEAL ${label}`);
    assert.equal(fmtIdealPerHour(c.idealQtyPerHour), paper.idealHr.toFixed(1), `IDEAL/Hour ${label}`);
    assert.equal(c.totalStoppageMin, paper.total, `Total stoppage ${label}`);
    // IDEAL takes Lunch out and isn't rounded down; the cap is the whole number under it.
    const lunch = r[13].lunchMin || 0;
    close(c.idealQtyExact, ((spanMinutes(r[9], r[10]) - lunch) * 60) / r[8], `IDEAL exact ${label}`);
    assert.equal(c.idealQty, Math.floor(c.idealQtyExact + 1e-9));
    assert.ok(c.actualQty <= c.idealQty, `the paper's own quantity fits the cap ${label}`);
    assert.equal(c.rejectedQty, r[12]);
  }
});

test("all 19 rows: Effective, Unreported, Efficiency and the 3 OEE equal the STANDARD formula (OK × Cycle ÷ 3600)", () => {
  for (const r of PAPER) {
    const e = entry(r);
    const c = mfdRowCalc(e);
    const [d] = mfdDayCalc([e]);
    const want = standard(r);
    const label = `${r[0]} ${r[1]} ${r[9]}`;
    close(c.effectiveHours, want.eff, `Effective ${label}`);
    close(c.efficiency, want.effcy, `Efficiency ${label}`);
    close(d.unreportedMin, want.unrep, `Unreported ${label}`, 1e-6);
    close(d.oeeLosses, want.oee[0], `OEE losses ${label}`);
    close(d.oeeLunch, want.oee[1], `OEE lunch ${label}`);
    close(d.oeeLunchCot, want.oee[2], `OEE lunch & COT ${label}`);
  }
  // Every machine-day's rows together give the same per-entry figures.
  const groups = {};
  for (const r of PAPER) (groups[`${r[0]}|${r[1]}`] ||= []).push(r);
  for (const rows of Object.values(groups)) {
    const res = mfdDayCalc(rows.map((r) => entry(r)));
    const byOn = [...rows].sort((a, b) => a[9].localeCompare(b[9]));
    byOn.forEach((r, i) => close(res[i].oeeLosses, standard(r).oee[0], `grouped ${r[0]} ${r[1]} ${r[9]}`));
  }
});

test("why the app differs from the Excel: the paper's own figures come back with its (OK + Cycle) × Cycle ÷ 3600 Effective", () => {
  let differs = 0;
  for (const r of PAPER) {
    const paper = r[14];
    const got = excel(r);
    const label = `${r[0]} ${r[1]} ${r[9]}`;
    assert.equal(got.eff.toFixed(2), paper.eff.toFixed(2), `Effective ${label}`);
    assert.equal(got.unrep.toFixed(2), paper.unrep.toFixed(2), `Unreported ${label}`);
    assert.equal(pct2(got.effcy), paper.effcy, `Efficiency ${label}`);
    assert.deepEqual(got.oee.map(pct2), paper.oee, `OEE ${label}`);
    if (Math.abs(standard(r).eff - paper.eff) > 0.006) differs += 1;
  }
  // The standard rule lands on the paper's Effective for just one row in 19.
  assert.equal(differs, 18);
});

test("per entry: 4/B VISHAL 10/05's two overlapping entries keep their own figures", () => {
  // 14:50–15:25 inside 08:15–18:55, on one machine and date. The paper shows
  // Efficiency 90.48% and 19.40% with its own Effective (checked above); the
  // standard rule gives each entry its own figure the same way.
  const [a, b] = PAPER.slice(0, 2);
  const res = mfdDayCalc([entry(a), entry(b)]);
  // sortByMachineOn: 08:15 first.
  close(res[0].oeeLosses, standard(b).oee[0], "08:15–18:55 OEE losses");
  close(res[1].oeeLosses, standard(a).oee[0], "14:50–15:25 OEE losses");
  close(res[0].unreportedMin, standard(b).unrep, "08:15–18:55 Unreported", 1e-6);
  close(res[1].unreportedMin, standard(a).unrep, "14:50–15:25 Unreported", 1e-6);
  assert.notEqual(pct2(res[0].oeeLosses), pct2(res[1].oeeLosses));
  assert.deepEqual([a, b].map((r) => pct2(mfdRowCalc(entry(r)).efficiency)), [71.43, 12.89]);
  // Not the combined day every other sheet would show.
  const [combined] = dayCalc([entry(a), entry(b)]);
  assert.notEqual(res[0].oeeLosses, combined.oeeLosses);
});

test("on Process Master's 12 h lock the machine's day is combined once", () => {
  const [a, b] = PAPER.slice(0, 2).map((r) => entry(r, { plannedOperatorShiftHours: 12, plannedLocked: true }));
  const res = mfdDayCalc([a, b]);
  assert.equal(res[0].oeeLosses, res[1].oeeLosses);
  assert.equal(res[0].unreportedMin, res[1].unreportedMin);
  // 12 h once for the day (more than the two runs' 11.25 h): (75 × 20 + 99 × 50) ÷ 3600 = 1.7917 h
  // over 12 − 145 min of stoppage.
  const eff = (75 * 20 + 99 * 50) / 3600;
  close(res[0].oeeLosses, eff / (12 - 145 / 60), "combined OEE losses");
  close(res[0].unreportedMin, 12 * 60 - eff * 60 - 145, "combined Unreported", 1e-6);
});

// ── Form rules ──────────────────────────────────────────────────────────────
const form = (r = PAPER[1], o = {}) => ({
  ...entry(r),
  machine: "m1",
  date: "2024-05-10",
  plannedOperatorShiftHours: String(Number((spanMinutes(r[9], r[10]) / 60).toFixed(2))),
  workingMode: "Working",
  machineStatus: [],
  ...o,
});

test("every paper row passes as typed — Rejected pieces need no reasons (no Rejection Master)", () => {
  for (const r of PAPER) assert.deepEqual(validateMfdEntry(form(r)), {}, `${r[0]} ${r[1]} ${r[9]}`);
});

test("Actual can't be more than the IDEAL Quantity (Lunch taken out) rounded down; OK not more than Actual", () => {
  // 4/B 08:15–18:55 at 50 s with 30 min Lunch: IDEAL 732 (768 if Lunch weren't taken out).
  assert.match(validateMfdEntry(form(PAPER[1], { actualQty: 733 })).actualQty, /Ideal Quantity \(732\)/);
  assert.equal(validateMfdEntry(form(PAPER[1], { actualQty: 732 })).actualQty, undefined);
  // M/17 08:10–18:45 at 56 s: IDEAL 648.21… → at most 648.
  assert.match(validateMfdEntry(form(PAPER[12], { actualQty: 649 })).actualQty, /Ideal Quantity \(648\)/);
  assert.match(validateMfdEntry(form(PAPER[1], { actualQty: 99, okQty: 100 })).okQty, /OK can't be more than Actual/);
  assert.match(validateMfdEntry(form(PAPER[1], { actualQty: 99.5 })).actualQty, /whole number/);
});

test("required fields; Setting Time ON / OFF optional; Planned not under the Machine Shift; Others needs a remark", () => {
  const e = validateMfdEntry(form(PAPER[0], { machine: "", operator: "", itemName: "", totalCycleSec: "", actualQty: "", okQty: "", plannedOperatorShiftHours: "" }));
  assert.equal(e.machine, "MC No. is required");
  assert.equal(e.operator, "Operator is required");
  assert.equal(e.itemName, "Part Name is required");
  assert.equal(e.totalCycleSec, "Total Cycle Time is required");
  assert.equal(e.actualQty, "Actual Quantity is required");
  assert.equal(e.okQty, "OK Quantity is required");
  assert.equal(e.plannedOperatorShiftHours, "Planned Operator Shift is required");
  assert.deepEqual(validateMfdEntry(form(PAPER[0], { settingOnTime: "14:30", settingOffTime: "14:50" })), {});
  assert.equal(validateMfdEntry(form(PAPER[0], { settingOnTime: "25:00" })).settingOnTime, "Enter a valid time");
  assert.match(validateMfdEntry(form(PAPER[1], { plannedOperatorShiftHours: "10" })).plannedOperatorShiftHours, /can't be less than the Machine Shift \(10:40\)/);
  assert.match(validateMfdEntry(form(PAPER[0], { otherMin: 5 })).otherMinRemark, /Remark is required/);
  assert.match(validateMfdEntry(form(PAPER[0], { lunchMin: 30, setupMin: 6 })).stoppageTotal, /36 min but the Machine Shift is only 35 min/);
});

test("a Non Working day needs only Date and MC No.", () => {
  assert.deepEqual(validateMfdEntry({ date: "2024-05-10", machine: "m1", workingMode: "Non Working", machineStatus: [] }), {});
  assert.deepEqual(Object.keys(validateMfdEntry({ date: "", machine: "", workingMode: "Non Working" })).sort(), ["date", "machine"]);
});

test("up to 8 entries a machine a day; the cap's popup names the Lunch it took out", () => {
  assert.equal(MFD_MAX_SLOTS, 8);
  const [, { details }] = qtyNotice({ calc: mfdRowCalc(entry(PAPER[1])), entered: 733, label: "Actual Quantity" });
  assert.deepEqual(details.find((d) => d.label === "Less Lunch / Tea"), { label: "Less Lunch / Tea", value: "30 min" });
  assert.equal(details.find((d) => d.label === "Ideal Quantity (most possible)").value, "732");
});

// ── Dashboard ───────────────────────────────────────────────────────────────
// What GET /processes/entries hands over for this sheet (process.controller.js DASHBOARD_SHEETS).
const fed = (r, o = {}) => ({ ...entry(r), calcMode: "perEntry", ...o });

test("dashboard: each entry's figures count — OEE averaged over entries, Unreported added up, Effective on OK", () => {
  const rows = [fed(PAPER[0]), fed(PAPER[1])];
  const s = summarize(rows);
  close(s.oeeLosses, (standard(PAPER[0]).oee[0] + standard(PAPER[1]).oee[0]) / 2, "OEE losses");
  close(s.unreportedMin, standard(PAPER[0]).unrep + standard(PAPER[1]).unrep, "Unreported", 1e-6);
  close(s.effectiveHours, (75 * 20 + 99 * 50) / 3600, "Effective on OK Qty");
  // A locked day still counts once.
  const locked = [fed(PAPER[0], { plannedOperatorShiftHours: 12, plannedLocked: true }), fed(PAPER[1], { plannedOperatorShiftHours: 12, plannedLocked: true })];
  const [d] = mfdDayCalc(locked);
  assert.equal(summarize(locked).oeeLosses, d.oeeLosses);
});
