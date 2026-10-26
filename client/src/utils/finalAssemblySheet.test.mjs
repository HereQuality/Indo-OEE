// Run: npm test   (bundles this with Vite's esbuild, then node:test — no extra deps)
// The FINAL ASSEMBLY sheet's adapter (utils/finalAssemblySheet.js), rules
// (utils/finalAssemblyValidation.js) and the shared pieces it extends, checked
// against the user's 18 real paper rows (pasted 2026-10-26).
import test from "node:test";
import assert from "node:assert/strict";
import { FA_DEFECT_REASONS, FA_MAX_ENTRIES_PER_DAY, faDayCalc, faRowCalc, isFinalAssemblyProcess } from "./finalAssemblySheet.js";
import { validateFinalAssemblyEntry } from "./finalAssemblyValidation.js";
import { slotsFullErrors } from "./entryValidation.js";
import { isWorkerProcess, stoppageKeysFor, summarize } from "./processDashboard.js";
import { sortByMachineOn, spanMinutes } from "./productionSheet.js";

// The paper, column by column (paste.tsv): Date, Item, Worker, Start, End,
// Hours, Std (blank for PACKING), Total, OK, the four defects, Other Activity
// (+ min), Lunch, Other idle — and the paper's own Ideal, Ideal/hr, Effective
// (2 dp), Unreported, and the two Productivity %.
const PAPER = [
{"date":"05-11-2024","item":"24 PIN SIDE ENTRY B/M","worker":"ALKESH","on":"09:30","off":"10:30","hours":1,"std":30,"total":185,"ok":185,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":120,"idealHr":120,"eff":1.54,"unrep":-32.5,"prod":154.17,"prodLunch":154.17,"remarks":"AMIT , DILIP, AJAY"},
{"date":"5/11/2024","item":"24 PIN SIDE ENTRY B/C","worker":"ALKESH","on":"10:30","off":"11:00","hours":0.5,"std":30,"total":40,"ok":40,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":60,"idealHr":120,"eff":0.33,"unrep":10,"prod":66.67,"prodLunch":66.67,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"6 PIN SIDE ENTRY B/M","worker":"ALKESH","on":"11:00","off":"14:00","hours":3,"std":30,"total":200,"ok":200,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":360,"idealHr":120,"eff":1.67,"unrep":50,"prod":55.56,"prodLunch":66.67,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"64 PIN FEMALE WITH HOOD","worker":"ALKESH","on":"14:55","off":"15:55","hours":1,"std":20,"total":60,"ok":60,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":180,"idealHr":180,"eff":0.33,"unrep":40,"prod":33.33,"prodLunch":33.33,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"48 PIN  FEMALE S/E B/M","worker":"ALKESH","on":"14:55","off":"15:55","hours":1,"std":60,"total":12,"ok":12,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":60,"idealHr":60,"eff":0.2,"unrep":48,"prod":20,"prodLunch":20,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"16 PIN MINATURE FEMALE B/M","worker":"ALKESH","on":"16:00","off":"17:00","hours":1,"std":30,"total":140,"ok":140,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":120,"idealHr":120,"eff":1.17,"unrep":-10,"prod":116.67,"prodLunch":116.67,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"4/0 PIN S/E B/O","worker":"ALKESH","on":"17:00","off":"19:00","hours":2,"std":60,"total":25,"ok":25,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":120,"idealHr":60,"eff":0.42,"unrep":95,"prod":20.83,"prodLunch":20.83,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"6 PIN 35 A SET B/O","worker":"ALKESH","on":"17:00","off":"19:00","hours":2,"std":50,"total":18,"ok":18,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":144,"idealHr":72,"eff":0.25,"unrep":105,"prod":12.5,"prodLunch":12.5,"remarks":"AMIT , DILIP, AJAY"},
{"date":"11/05/2024","item":"6 PIN 35 A MALE WITH HOOD","worker":"ALKESH","on":"17:00","off":"19:00","hours":2,"std":50,"total":18,"ok":18,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":null,"otherIdle":null,"ideal":144,"idealHr":72,"eff":0.25,"unrep":105,"prod":12.5,"prodLunch":12.5,"remarks":""},
{"date":"11/05/2024","item":"PACKING","worker":"AMIT","on":"15:00","off":"19:00","hours":4,"std":null,"total":0,"ok":0,"defects":[0,0,0,0],"activity":"Material Shifting","activityMin":null,"lunch":null,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":240,"prod":0,"prodLunch":0,"remarks":""},
{"date":"16/05/2024","item":"PACKING","worker":"ALPESH","on":"08:00","off":"18:00","hours":10,"std":null,"total":170,"ok":170,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"MAHESH"},
{"date":"16/05/2024","item":"PACKING","worker":"ALPESH","on":"08:00","off":"18:00","hours":10,"std":null,"total":8,"ok":8,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"MAHESH"},
{"date":"16/05/2024","item":"PACKING","worker":"VINAYAK","on":"08:00","off":"18:00","hours":10,"std":null,"total":8,"ok":8,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"DIVYYESH , NIMISHA"},
{"date":"16/05/2024","item":"PACKING","worker":"ALPESH","on":"08:00","off":"18:00","hours":10,"std":null,"total":200,"ok":200,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"MAHESH"},
{"date":"16/05/2024","item":"PACKING","worker":"ALPESH","on":"08:00","off":"18:00","hours":10,"std":null,"total":20,"ok":20,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"MAHESH"},
{"date":"16/05/2024","item":"PACKING","worker":"ALPESH","on":"08:00","off":"18:00","hours":10,"std":null,"total":4,"ok":4,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"MAHESH"},
{"date":"16/05/2024","item":"PACKING","worker":"ALPESH","on":"08:00","off":"18:00","hours":10,"std":null,"total":600,"ok":600,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"MAHESH"},
{"date":"16/05/2024","item":"PACKING","worker":"VINAYAK","on":"08:00","off":"18:00","hours":10,"std":null,"total":1,"ok":1,"defects":[0,0,0,0],"activity":"","activityMin":null,"lunch":30,"otherIdle":null,"ideal":null,"idealHr":null,"eff":0,"unrep":570,"prod":0,"prodLunch":0,"remarks":"DIVYYESH , NIMISHA"}
];

// "05-11-2024" and "5/11/2024" are month-first (the rows after them are
// 11/05/2024); everything else is DD/MM/YYYY.
const isoOf = (s) => {
  if (s === "05-11-2024" || s === "5/11/2024") return "2024-05-11";
  const [d, m, y] = s.split(/[/-]/).map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

// A paper row as the form saves it: Planned typed = the Working Hours (the paper
// has no Planned column), the process unlocked; blank boxes stay blank.
const formRow = (p, i, o = {}) => ({
  _id: `r${i}`,
  date: isoOf(p.date),
  machine: p.worker,
  itemName: p.item,
  totalCycleSec: p.std ?? "",
  machineOnTime: p.on,
  machineOffTime: p.off,
  actualQty: p.total,
  rejectBreakdown: Object.fromEntries(FA_DEFECT_REASONS.map((r, k) => [r, p.defects[k]])),
  otherActivity: p.activity,
  otherActivityMin: p.activityMin ?? "",
  lunchMin: p.lunch ?? "",
  otherMin: p.otherIdle ?? "",
  plannedOperatorShiftHours: spanMinutes(p.on, p.off) / 60,
  remarks: p.remarks,
  ...o,
});
const pct2 = (v) => Math.round(v * 10000) / 100;
const close = (a, b, eps) => Math.abs(a - b) <= eps;

test("all 18 paper rows: Ideal, Ideal/hr, Effective, OK, Total Idle — row by row", () => {
  assert.equal(PAPER.length, 18);
  PAPER.forEach((p, i) => {
    const c = faRowCalc(formRow(p, i));
    const at = `${p.worker} ${p.date} ${p.on}–${p.off} ${p.item}`;
    assert.ok(close(c.shiftHours, p.hours, 1e-9), `Hours ${at}`);
    if (p.std === null) {
      assert.equal(c.idealQty, null, `no Ideal without a Standard Time — ${at}`);
      assert.equal(c.idealQtyPerHour, null);
    } else {
      assert.ok(close(c.idealQty, p.ideal, 0.006), `Ideal ${at}: ${c.idealQty}`);
      assert.ok(close(c.idealQtyPerHour, p.idealHr, 0.006), `Ideal/hr ${at}`);
    }
    assert.ok(close(c.effectiveHours, p.eff, 0.006), `Effective ${at}: ${c.effectiveHours}`);
    assert.equal(c.okQty, p.ok, `OK ${at}`);
    assert.equal(c.totalDefect, p.defects.reduce((a, b) => a + b, 0));
    assert.equal(c.totalStoppageMin, (p.lunch || 0) + (p.otherIdle || 0), `Total Idle ${at}`);
  });
});

test("all 18 paper rows: Unreported and both Productivity figures, each entry on its own", () => {
  // Fed as the page feeds them: one worker-date group at a time.
  const rows = PAPER.map((p, i) => formRow(p, i));
  const groups = {};
  for (const r of rows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
  const byId = {};
  for (const group of Object.values(groups)) {
    const sorted = sortByMachineOn(group);
    faDayCalc(sorted).forEach((d, k) => (byId[sorted[k]._id] = d));
  }
  PAPER.forEach((p, i) => {
    const d = byId[`r${i}`];
    const at = `${p.worker} ${p.date} ${p.on}–${p.off} ${p.item}`;
    assert.ok(close(d.unreportedMin, p.unrep, 0.006), `Unreported ${at}: ${d.unreportedMin}`);
    assert.equal(pct2(d.productivity), p.prod, `Productivity ${at}`);
    assert.equal(pct2(d.productivityLunch), p.prodLunch, `Productivity (lunch) ${at}`);
  });
});

test("a blank Standard Time (PACKING): no Ideal, Effective 0, Productivity 0%, Unreported = Planned − idle", () => {
  const amit = PAPER.findIndex((p) => p.worker === "AMIT");
  const r = formRow(PAPER[amit], amit);
  const c = faRowCalc(r);
  assert.equal(c.idealQty, null);
  assert.equal(c.effectiveHours, 0);
  assert.equal(c.performance, null, "no Performance without a Standard Time");
  const [d] = faDayCalc([r]);
  assert.equal(d.unreportedMin, 240);
  assert.equal(d.productivity, 0);
  assert.equal(d.productivityLunch, 0);
  // With 30 min lunch (ALPESH 16/05): 600 − 30.
  const alpesh = PAPER.findIndex((p) => p.worker === "ALPESH");
  assert.equal(faDayCalc([formRow(PAPER[alpesh], alpesh)])[0].unreportedMin, 570);
  // …and it is a valid entry with the Standard Time left blank.
  assert.deepEqual(validateFinalAssemblyEntry({ ...r, plannedOperatorShiftHours: "4" }), {});
});

test("ALKESH 11/05 17:00–19:00: three overlapping jobs keep their own figures", () => {
  const idx = PAPER.map((p, i) => i).filter((i) => PAPER[i].worker === "ALKESH" && PAPER[i].on === "17:00");
  assert.equal(idx.length, 3);
  const day = PAPER.map((p, i) => [p, i]).filter(([p]) => p.worker === "ALKESH" && isoOf(p.date) === "2024-05-11");
  const rows = sortByMachineOn(day.map(([p, i]) => formRow(p, i)));
  const results = faDayCalc(rows);
  const mine = rows.map((r, k) => [r._id, results[k]]).filter(([id]) => idx.includes(Number(id.slice(1))));
  assert.deepEqual(mine.map(([, d]) => pct2(d.productivity)), [20.83, 12.5, 12.5]);
  assert.deepEqual(mine.map(([, d]) => Math.round(d.unreportedMin * 100) / 100), [95, 105, 105]);
  // Overlapping times are no error on this sheet.
  for (const r of rows) assert.equal(validateFinalAssemblyEntry({ ...r, plannedOperatorShiftHours: String(r.plannedOperatorShiftHours) }).machineOnTime, undefined);
});

test("a day on Process Master's 12 h lock is combined once", () => {
  const rows = [0, 1].map((i) => formRow(PAPER[i], i, { date: "2024-05-11", plannedOperatorShiftHours: 12, plannedLocked: true }));
  const [a, b] = faDayCalc(rows);
  assert.equal(a.productivity, b.productivity);
  // (185 + 40) × 30 s = 1.875 h over one 12 h day.
  assert.ok(close(a.productivity, 1.875 / 12, 1e-9));
  assert.ok(close(a.unreportedMin, 12 * 60 - 1.875 * 60, 1e-9));
});

test("TOTAL above Ideal is allowed (OEE Review), defects can't pass TOTAL, Other needs a remark", () => {
  const r = { ...formRow(PAPER[0], 0), plannedOperatorShiftHours: "1" };
  assert.deepEqual(validateFinalAssemblyEntry(r), {}, "154% saves — it goes to OEE Review");
  assert.ok(faRowCalc(r).performance > 1);
  const over = { ...r, rejectBreakdown: { "Wrong Assembly": "100", "Broken Screw": "90" } };
  assert.match(validateFinalAssemblyEntry(over).rejectBreakdown, /Total Defects \(190\) can't be more than Total QTY \(185\)/);
  const other = { ...r, rejectBreakdown: { Other: "2" } };
  assert.match(validateFinalAssemblyEntry(other).rejectOtherRemark, /Remark is required/);
  assert.equal(faRowCalc(other).okQty, 183);
  assert.match(validateFinalAssemblyEntry({ ...r, totalCycleSec: "0" }).totalCycleSec, /more than 0/);
  assert.equal(validateFinalAssemblyEntry({ ...r, totalCycleSec: "" }).totalCycleSec, undefined);
});

test(`up to ${FA_MAX_ENTRIES_PER_DAY} entries a worker a day (ALKESH has 9 on 11/05)`, () => {
  const nine = { "w|2024-05-11": Array.from({ length: 9 }, (_, i) => ({ slot: i + 1 })) };
  const block = { date: "2024-05-11", machine: "w" };
  assert.deepEqual(slotsFullErrors([block], nine, { max: FA_MAX_ENTRIES_PER_DAY })[0], {});
  const full = { "w|2024-05-11": Array.from({ length: FA_MAX_ENTRIES_PER_DAY }, (_, i) => ({ slot: i + 1 })) };
  assert.match(slotsFullErrors([block], full, { max: FA_MAX_ENTRIES_PER_DAY, who: () => "ALKESH" })[0].machine, /ALKESH already has 12 entries/);
});

test("FINAL ASSEMBLY is told apart from MODULAR FRAME ASSEMBLY; worker wording, Lunch / Other idle", () => {
  assert.equal(isFinalAssemblyProcess({ processName: "FINAL ASSEMBLY" }), true);
  assert.equal(isFinalAssemblyProcess({ processName: "MODULAR FRAME ASSEMBLY" }), false);
  assert.equal(isFinalAssemblyProcess({ processName: "X", dataEntryMenu: "/hqepl/production/final-assembly-data-entry" }), true);
  assert.equal(isFinalAssemblyProcess({ processName: "FINAL ASSEMBLY", dataEntryMenu: "/hqepl/production/modular-frame-assembly-data-entry" }), false);
  assert.equal(isWorkerProcess({ processName: "FINAL ASSEMBLY" }), true);
  assert.deepEqual(stoppageKeysFor({ processName: "FINAL ASSEMBLY" }), ["lunchMin", "otherMin"]);
});

test("the dashboard groups rejected pieces by this sheet's four defect names", () => {
  // As the server sends them: OK / Rejected stored, the flags from DASHBOARD_SHEETS.
  const row = { ...formRow(PAPER[0], 0), date: "2024-05-11", okQty: 180, rejectedQty: 5, rejectBreakdown: { "Wrong Assembly": 3, "Wrong Clamping": 2 }, runQtyBasis: "total", calcMode: "perEntry" };
  const s = summarize([row]);
  assert.deepEqual(s.rejectByReason, { "Wrong Assembly": 3, "Wrong Clamping": 2 });
});
