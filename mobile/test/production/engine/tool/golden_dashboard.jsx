// Golden generator for dashboard_web_parity_test.dart: renders the REAL web
// dashboard (client/src/Components/ProcessDashboard/charts.jsx, DrillModal.jsx
// and utils/processDashboard.js) with react-dom/server over a set of entry
// "views" (scenario x period slice x cross-filters) and records every figure
// the user can read: KPI tile texts, each chart's table / empty state / text
// nodes, the drill-down splits and entries, and the chart-only datasets
// (radar causes, treemap tiles, unreported panels, nice axis).
//
// Nothing is written into client/: esbuild bundles it with two in-memory
// patches (plugin below) that only add `export { ... }` lines so the private
// helpers can be reached.
//
// Regenerate (from mobile/; <T> = any scratch dir):
//   TZ=Asia/Kolkata LANG=en_US.UTF-8 node test/production/engine/tool/build_dashboard_golden.mjs <T> \
//      > test/production/engine/fixtures/dashboard_parity_golden.json
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import * as PD from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/utils/processDashboard.js";
import { STOPPAGE_FIELDS } from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/utils/productionSheet.js";
import { THEME } from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/Components/ProcessDashboard/chartTheme.js";
import { CHART_COMPONENTS, niceAxis, tickText, truncate, shortCause } from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/Components/ProcessDashboard/charts.jsx";
import { Split, Records } from "/Users/hqepldev/HQEPL/Indo-OEE/client/src/Components/ProcessDashboard/DrillModal.jsx";

const OLD = JSON.parse(fs.readFileSync("/Users/hqepldev/HQEPL/Indo-OEE/mobile/test/production/engine/fixtures/engine_golden_en_US.json", "utf8"));
const c = THEME.light;

// ── html -> plain structures ───────────────────────────────────────────────
const ent = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const strip = (s) => ent(s.replace(/<[^>]*>/g, ""));
const norm = (s) => s.replace(/\s+/g, " ").trim();
const texts = (html) => html.split(/<[^>]*>/).map((t) => norm(ent(t))).filter(Boolean);

function parseTable(html) {
  const m = html.match(/<table[\s\S]*?<\/table>/);
  if (!m) return null;
  const t = m[0];
  const head = [...t.match(/<thead>([\s\S]*?)<\/thead>/)[1].matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/g)];
  const columns = head.map((h) => strip(h[2]));
  const hints = head.map((h) => (/title="([^"]*)"/.exec(h[1]) ? ent(/title="([^"]*)"/.exec(h[1])[1]) : null));
  const body = t.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rows = [];
  const selected = [];
  for (const tr of body.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)) {
    if (/pd-row-selected/.test(tr[1])) selected.push(rows.length);
    rows.push([...tr[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => strip(td[1])));
  }
  return { columns, hints, rows, selected };
}

const emptyOf = (html) => {
  const m = html.match(/^<div class="d-flex align-items-center justify-content-center h-100 text-muted small text-center px-3">([\s\S]*?)<\/div>$/);
  return m ? strip(m[1]) : null;
};

// ── scenarios ──────────────────────────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = mulberry32(777001);
const int = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
const pick = (a) => a[Math.floor(R() * a.length)];
const chance = (p) => R() < p;
const pad = (v) => String(v).padStart(2, "0");
const dayStr = (y, m, d, off) => {
  const x = new Date(y, m - 1, d + off);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const dow = (s) => new Date(`${s}T12:00:00`).getDay();

// A plant with three processes (CNC, VMC, Press) over `days` days: 3 shifts
// (the 22:00 one runs overnight), operators, parts with cycle times, reject
// splits, stoppages, Sundays off, a holiday, an absent operator, zero-qty
// entries, entries with missing times and over-100% productions.
const PROCESSES = {
  cnc: { machines: ["c1", "c2", "c3", "c4"], parts: [["Bracket A", 42], ["Flange 10", 55.5], ["Shaft-7", 30]] },
  vmc: { machines: ["v1", "v2"], parts: [["Housing", 95], ["Cover Plate", 70.25]] },
  press: { machines: ["p1", "p2", "p3"], parts: [["Washer", 6], ["Clip", 9.5], ["Bracket A", 12]] },
};
const OPERATORS = ["Ravi K", "Sunil", "Anita", "Meena P", "Op 10", "Op 2", "Imran", "Kiran", "Deepa", "Farhan", "Gopal", "Hema", "Ishaan", "Jyoti", "Op 3"];
const REASONS = ["Dimension Out", "Tool Mark", "Surface Finish", "Porosity / Blow Hole", "Setting Mistake", "Other"];
const STOP = ["plannedDownMin", "setupMin", "noManPowerMin", "materialShiftingMin", "noMaterialMin", "bdMechMin", "bdEleMin", "noPowerMin", "lunchMin", "otherMin"];
let rid = 0;

function factory(start, days, only = Object.keys(PROCESSES)) {
  const rows = [];
  for (let d = 0; d < days; d++) {
    const date = dayStr(start[0], start[1], start[2], d);
    const sunday = dow(date) === 0;
    for (const [pname, proc] of Object.entries(PROCESSES)) {
      if (!only.includes(pname)) continue;
      for (const m of proc.machines) {
        if (chance(0.06)) continue; // machine idle all day, no entry
        for (const slot of pick([[1], [1, 2], [1, 2, 3], [1, 2, 3]])) {
          const r = { _id: `f${rid++}`, machine: m, date, slot };
          const on = [6, 14, 22][slot - 1];
          if (sunday || date.endsWith("-15") && chance(0.5)) {
            r.workingStatus = sunday ? "SUNDAY" : "HOLIDAY";
            r.operator = "";
            rows.push(r);
            continue;
          }
          if (chance(0.03)) { r.workingStatus = "ABSENT"; r.operator = ""; rows.push(r); continue; }
          r.operator = pick(OPERATORS);
          const [itemName, cyc] = pick(proc.parts);
          r.itemName = itemName;
          r.item = `item-${itemName}`;
          r.totalCycleSec = chance(0.15) ? String(cyc) : cyc;
          const missingTimes = chance(0.04);
          if (!missingTimes) {
            r.machineOnTime = `${pad(on)}:${pick(["00", "00", "15", "30"])}`;
            const span = chance(0.85) ? 8 : pick([4, 6, 7.5]);
            const offH = (on + Math.floor(span)) % 24;
            r.machineOffTime = `${pad(offH)}:${span % 1 ? "30" : pick(["00", "00", "45"])}`;
          }
          const idealApprox = Math.floor((8 * 3600) / cyc);
          const roll = R();
          let ok;
          if (roll < 0.04) ok = 0; // zero quantity
          else if (roll < 0.09) ok = Math.round(idealApprox * (1.05 + R() * 0.5)); // over 100%
          else ok = Math.round(idealApprox * (0.55 + R() * 0.4));
          const rej = ok === 0 ? 0 : chance(0.6) ? int(0, Math.max(1, Math.round(ok * 0.04))) : 0;
          r.okQty = chance(0.1) ? String(ok) : ok;
          r.actualQty = ok + rej;
          if (rej > 0) {
            const picks = REASONS.filter(() => chance(0.4));
            if (!picks.length) picks.push("Dimension Out");
            const bd = {};
            let left = rej;
            picks.forEach((reason, i) => {
              const q = i === picks.length - 1 ? left : Math.min(left, int(0, left));
              left -= q;
              if (q > 0) bd[reason] = q;
            });
            if (Object.keys(bd).length) r.rejectBreakdown = bd;
            if (bd.Other) r.rejectOtherRemark = "burrs on edge";
          }
          if (chance(0.8)) r.plannedOperatorShiftHours = pick([8, 8, 8, 7.5, 10]);
          r.lunchMin = pick([30, 30, 45, 20]);
          for (const k of STOP) if (k !== "lunchMin" && chance(0.25)) r[k] = chance(0.2) ? int(1, 90) + 0.5 : int(2, 60);
          if (chance(0.12)) r.remarks = pick(["tool changed", "power dip at 3am", "trial run", "audit on line"]);
          if (r.otherMin && chance(0.7)) r.otherMinRemark = "waiting for QC";
          rows.push(r);
        }
      }
    }
  }
  return rows;
}

const FACTORY_NAMES = { c1: "CNC-01", c2: "CNC-02", c3: "CNC 10", c4: "CNC 3", v1: "VMC-A", v2: "VMC-B", p1: "P-1", p2: "P-2", p3: "P-10", x9: "Old Lathe" };
const FACTORY_ORDER = { c1: 0, c2: 1, c3: 2, c4: 3, v1: 4, v2: 5, p1: 6, p2: 7, p3: 8 };

const scenarios = {};
const addScenario = (name, rows, ctxBase) => (scenarios[name] = { rows, ctxBase });
for (const name of ["plant", "long", "legacy", "empty", "single", "blank", "dates62", "dates63", "weird"]) {
  addScenario(name, OLD.scenarios[name].rows, { machineName: OLD.scenarios[name].ctx.machineName, machineOrder: OLD.scenarios[name].ctx.machineOrder });
}
const factoryRows = factory([2026, 8, 24], 40); // 24 Aug .. 2 Oct: crosses a month, 40 distinct days
// A deactivated machine still shows on old entries (named via entryMachineNames, absent from machineOrder).
factoryRows.push({ _id: "f-old1", machine: "x9", date: "2026-09-03", slot: 1, operator: "Sunil", itemName: "Bracket A", totalCycleSec: 42, machineOnTime: "06:00", machineOffTime: "14:00", okQty: 500, actualQty: 505, rejectBreakdown: { "Tool Mark": 5 }, lunchMin: 30, plannedOperatorShiftHours: 8 });
// A machine with no name anywhere -> "—".
factoryRows.push({ _id: "f-unk1", machine: "zz", date: "2026-09-04", slot: 1, operator: "", itemName: "", totalCycleSec: 60, machineOnTime: "06:00", machineOffTime: "10:00", okQty: 100, actualQty: 100, lunchMin: 0 });
// An overnight machine entry crossing midnight on the last day of the period.
factoryRows.push({ _id: "f-night", machine: "c1", date: "2026-10-02", slot: 3, operator: "Imran", itemName: "Bracket A", item: "item-Bracket A", totalCycleSec: 42, machineOnTime: "22:00", machineOffTime: "06:00", okQty: 600, actualQty: 612, rejectBreakdown: { "Dimension Out": 12 }, lunchMin: 30, plannedOperatorShiftHours: 8, remarks: "overnight" });
addScenario("factory", factoryRows, { machineName: FACTORY_NAMES, machineOrder: FACTORY_ORDER });
const factoryLong = factory([2026, 6, 1], 66, ["cnc", "vmc"]); // > 62 distinct dates -> month buckets
addScenario("factoryLong", factoryLong, { machineName: FACTORY_NAMES, machineOrder: FACTORY_ORDER });

const slice = (rows, [from, to]) => rows.filter((r) => r.date >= from && r.date <= to);
const inProcess = (rows, ms) => rows.filter((r) => ms.includes(r.machine));

// ── views ──────────────────────────────────────────────────────────────────
const views = [];
const V = (id, scenario, { range = null, machines = null, filters = {}, full = false } = {}) => views.push({ id, scenario, range, machines, filters, full });
const firstOf = (name, field, nth = 0) => {
  const set = [...new Set(scenarios[name].rows.map((r) => r[field]).filter((v) => v))];
  return set[nth] ?? "";
};
V("plant:all", "plant", { full: true });
V("plant:machine", "plant", { filters: { machine: ["m1"] } });
V("plant:two machines", "plant", { filters: { machine: ["m3", "m2"] }, full: true });
V("plant:operator", "plant", { filters: { operator: ["Ravi K"] } });
V("plant:no operator", "plant", { filters: { operator: [""] } });
V("plant:item", "plant", { filters: { item: ["Flange 10"] } });
V("plant:machine+operator+item", "plant", { filters: { machine: ["m1", "m2"], operator: ["Sunil", "Meena P"], item: ["Bracket A"] } });
V("plant:date", "plant", { filters: { date: ["2026-08-24"] } });
V("plant:month", "plant", { filters: { month: ["2026-09"] } });
V("plant:no match", "plant", { filters: { machine: ["nope"] } });
V("long:all", "long", { full: true });
V("long:thisMonth", "long", { range: ["2026-03-01", "2026-03-31"] });
V("long:last7", "long", { range: ["2026-03-25", "2026-03-31"] });
V("long:last30", "long", { range: ["2026-03-02", "2026-03-31"] });
V("long:custom", "long", { range: ["2026-02-10", "2026-03-20"], filters: { operator: ["anita"] } });
V("long:month filter", "long", { filters: { month: ["2026-02"] } });
V("long:one day", "long", { range: ["2026-02-02", "2026-02-02"] });
for (const n of ["legacy", "weird", "single", "blank", "empty", "dates62", "dates63"]) V(`${n}:all`, n, { full: n === "weird" });
V("factory:all machines", "factory", { full: true });
V("factory:CNC process", "factory", { machines: PROCESSES.cnc.machines, full: true });
V("factory:VMC process", "factory", { machines: PROCESSES.vmc.machines });
V("factory:Press process", "factory", { machines: PROCESSES.press.machines });
V("factory:thisMonth (Sep)", "factory", { range: ["2026-09-01", "2026-09-30"] });
V("factory:last7", "factory", { range: ["2026-09-26", "2026-10-02"] });
V("factory:custom", "factory", { range: ["2026-08-30", "2026-09-12"] });
V("factory:one machine", "factory", { filters: { machine: ["c1"] } });
V("factory:operator", "factory", { filters: { operator: ["Ravi K"] } });
V("factory:part", "factory", { filters: { item: ["Bracket A"] } });
V("factory:part x CNC", "factory", { machines: PROCESSES.cnc.machines, filters: { item: ["Bracket A"], operator: ["Anita", "Imran"] } });
V("factory:date", "factory", { filters: { date: ["2026-09-03"] } });
V("factory:dates", "factory", { filters: { date: ["2026-09-03", "2026-09-04"] } });
V("factory:month Aug", "factory", { filters: { month: ["2026-08"] } });
V("factory:old+unknown machines", "factory", { filters: { machine: ["x9", "zz"] } });
V("factory:overnight", "factory", { filters: { machine: ["c1"], date: ["2026-10-02"] } });
V("factory:no match", "factory", { filters: { operator: ["nobody"] } });
V("factoryLong:all", "factoryLong", { full: true });
V("factoryLong:CNC", "factoryLong", { machines: PROCESSES.cnc.machines });
V("factoryLong:60 days", "factoryLong", { range: ["2026-07-01", "2026-08-29"] });
V("factoryLong:month", "factoryLong", { filters: { month: ["2026-07"] } });

// ── per view computation ───────────────────────────────────────────────────
const STAT_FORMATS = Object.fromEntries(PD.STAT_CATALOG.map((s) => [s.key, s.format]));

function drillOf(measure, filtered, ctx) {
  const summary = PD.summarize(filtered);
  const out = { label: measure.label, format: measure.format, total: PD.FORMATS[measure.format](measure.get(summary)), splits: {} };
  for (const dim of ["machine", "operator", "item", ctx.bucket]) {
    const html = renderToStaticMarkup(<Split rows={filtered} dim={dim} ctx={ctx} measure={measure} c={c} onPick={() => {}} />);
    const empty = /Nothing to show for this selection\./.test(html);
    const items = [...html.matchAll(/<button[\s\S]*?<span class="pd-split-label">([\s\S]*?)<\/span><span class="pd-split-track"><span class="pd-split-bar" style="width:([^"]*)"[^>]*><\/span><\/span><span class="pd-split-value">([\s\S]*?)<\/span><\/button>/g)].map((m) => ({
      label: strip(m[1]),
      width: m[2] === "0" ? 0 : parseFloat(m[2]),
      value: strip(m[3]),
    }));
    out.splits[dim] = { empty, items };
  }
  return out;
}

function recordsOf(filtered, ctx) {
  const html = renderToStaticMarkup(<Records rows={filtered} ctx={ctx} />);
  const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((tr) => {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const remarks = [...tds[10].matchAll(/<div>([\s\S]*?)<\/div>/g)].map((d) => norm(strip(d[1])));
    return { cells: tds.slice(0, 10).map((x) => strip(x)), remarks };
  });
  const footer = html.match(/<div class="text-muted small pt-2">([\s\S]*?)<\/div>/);
  return { rows, footer: footer ? strip(footer[1]) : null };
}

function chartsOf(filters, rowsFor, ctx, filtered) {
  const out = {};
  for (const key of Object.keys(CHART_COMPONENTS)) {
    const C = CHART_COMPONENTS[key];
    const one = {};
    for (const view of ["chart", "table"]) {
      for (const expanded of [false, true]) {
        const html = renderToStaticMarkup(<C rowsFor={rowsFor} ctx={ctx} c={c} filters={filters} onToggle={() => {}} onDrill={() => {}} view={view} expanded={expanded} />);
        const e = emptyOf(html);
        const t = parseTable(html);
        const got = e != null ? { empty: e } : t ? { table: t } : { texts: texts(html), multiples: [...html.matchAll(/<button type="button" class="pd-multiple-title"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => norm(strip(m[1]))) };
        // The expanded render is stored only where it differs from the card render.
        if (!expanded || JSON.stringify(got) !== JSON.stringify(one[view])) one[`${view}${expanded ? ":expanded" : ""}`] = got;
      }
    }
    out[key] = one;
  }
  return out;
}

// Chart-only datasets (the parts Recharts draws): same derivations as charts.jsx.
function datasetsOf(rowsFor, ctx) {
  const d = {};
  {
    const rows = rowsFor("machine");
    const total = PD.summarize(rows).downtimeByCause;
    d.radar = STOPPAGE_FIELDS.map((f) => ({ key: f.key, label: shortCause(f.key), value: total[f.key] || 0 })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
    d.treemap = PD.summarizeBy(rows, "machine", ctx)
      .filter((g) => g.summary.downtimeMin > 0)
      .sort(PD.compareMachines(ctx))
      .map((g) => ({
        key: g.key, label: g.label, total: g.summary.downtimeMin,
        children: STOPPAGE_FIELDS.map((f) => ({ key: f.key, name: shortCause(f.key), value: g.summary.downtimeByCause[f.key] || 0 })).filter((x) => x.value > 0).sort((x, y) => y.value - x.value),
        groups: PD.STOPPAGE_GROUPS.map((grp) => grp.fields.reduce((s, f) => s + g.summary.downtimeByCause[f], 0)),
      }));
  }
  {
    const rows = rowsFor(null);
    const dim = ctx.bucket;
    const list = PD.summarizeBy(rows, "machine", ctx).sort(PD.compareMachines(ctx)).map((m) => ({
      key: m.key, label: m.label, total: m.summary.unreportedMin,
      data: PD.summarizeBy(rows.filter((r) => r.machine === m.key), dim, ctx).map((g) => ({ key: g.key, value: g.summary.unreportedMin })).sort((a, b) => a.key.localeCompare(b.key)),
    }));
    const values = list.flatMap((p) => p.data.map((x) => x.value));
    const n = list.length;
    d.unreported = { panels: list, axis: niceAxis(Math.min(0, ...values), Math.max(0, ...values), n <= 6 ? 3 : 2), tickTexts: niceAxis(Math.min(0, ...values), Math.max(0, ...values), n <= 6 ? 3 : 2).ticks.map(tickText) };
  }
  {
    const rows = rowsFor(null);
    const sum = PD.summarize(rows);
    d.rings = ["oeeAvailability", "oeePerformance", "oeeQuality"].map((k) => (Number.isFinite(sum[k]) ? sum[k] * 100 : null));
    d.ringFill = d.rings.map((v) => Math.min(100, Math.max(0, v ?? 0)));
  }
  {
    // Time tick text of the trend charts' x axes.
    const dim = ctx.bucket;
    d.ticks = [...new Set(rowsFor(dim).map((r) => PD.DIMENSIONS[dim].value(r)))].sort().map((k) => ({ key: k, tick: dim === "date" ? `${k.slice(8)}/${k.slice(5, 7)}` : PD.DIMENSIONS.month.text(k), tip: PD.DIMENSIONS[dim].text(k, ctx) }));
  }
  return d;
}

const out = { scenarios: {}, views: [], axisCases: [], truncate: [] };
// Self-contained: every scenario's rows travel with the expectations (the engine golden may be regenerated on its own).
for (const [name, sc] of Object.entries(scenarios)) out.scenarios[name] = { rows: sc.rows, ctx: sc.ctxBase };

for (const v of views) {
  const sc = scenarios[v.scenario];
  let rows = sc.rows;
  if (v.machines) rows = inProcess(rows, v.machines);
  if (v.range) rows = slice(rows, v.range);
  const ctx = { machineName: sc.ctxBase.machineName, machineOrder: sc.ctxBase.machineOrder, bucket: PD.timeBucket(rows) };
  const filters = { ...PD.EMPTY_FILTERS, ...v.filters };
  // ProcessDashboard.jsx: rowsByDim / rowsFor / filtered.
  const cache = { null: PD.applyFilters(rows, filters) };
  for (const dim of Object.keys(PD.DIMENSIONS)) cache[dim] = filters[dim].length ? PD.applyFilters(rows, filters, dim) : cache.null;
  const rowsFor = (dim) => cache[dim ?? "null"];
  const filtered = cache.null;
  const summary = PD.summarize(filtered);

  const o = { id: v.id, scenario: v.scenario, range: v.range, machines: v.machines, filters: v.filters, bucket: ctx.bucket, rowCount: rows.length, filteredCount: filtered.length };
  o.stats = PD.STAT_CATALOG.map((s) => ({ key: s.key, text: PD.FORMATS[s.format](summary[s.key]) }));
  o.entries = `${filtered.length} entr${filtered.length === 1 ? "y" : "ies"}`;
  o.charts = chartsOf(filters, rowsFor, ctx, filtered);
  o.datasets = datasetsOf(rowsFor, ctx);
  o.filterOptions = Object.fromEntries(["machine", "operator", "item"].map((dim) => [dim, [...new Set([...rows.map(PD.DIMENSIONS[dim].value), ...filters[dim]])].map((value) => ({ value, label: PD.DIMENSIONS[dim].text(value, ctx) })).sort(dim === "machine" ? PD.compareMachines(ctx, (x) => x.value) : (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))]));
  o.chips = Object.entries(filters).flatMap(([dim, vals]) => vals.map((x) => `${PD.DIMENSIONS[dim].label}: ${PD.DIMENSIONS[dim].text(x, ctx)}`));
  if (filtered.length) {
    const measures = PD.STAT_CATALOG.filter((s) => v.full || ["totalQty", "okPct", "oeeLosses", "oeeAvailability", "downtimeMin", "unutilized", "effectiveHours"].includes(s.key)).map((s) => PD.statMeasure(s));
    if (v.full) {
      for (const f of STOPPAGE_FIELDS) measures.push(PD.causeMeasure(f.key));
      for (const reason of Object.keys(summary.rejectByReason)) measures.push(PD.reasonMeasure(reason));
      measures.push(PD.reasonMeasure("Not in this period"));
    }
    o.drills = measures.map((m) => ({ key: m.key, ...drillOf(m, filtered, ctx) }));
    if (v.full) o.records = recordsOf(filtered, ctx);
  }
  out.views.push(o);
}

// niceAxis / tickText / truncate on a battery of inputs.
for (const [mn, mx, k] of [[0, 0, 3], [0, 10, 3], [0, 7, 3], [-96.6666667, 450, 3], [-3, 3, 2], [0, 1234, 2], [0, 99999, 3], [-0.5, 0.5, 3], [0, 0.3, 3], [0, 5000000, 2], [-1200, 80, 3]]) out.axisCases.push({ in: [mn, mx, k], out: niceAxis(mn, mx, k), ticks: niceAxis(mn, mx, k).ticks.map(tickText) });
for (const [s, mx] of [["abcdefghijklmnopqrstu", 20], ["abcdefghijklmnopqrs", 20], ["Not specified", 18], ["Breakdown (Mech + Ele)", 16], ["Porosity / Blow Hole", 20]]) out.truncate.push({ in: [s, mx], out: truncate(s, mx) });
// Number.prototype.toFixed (chart labels, tooltips, ring figures, donut shares) on ties and near-ties.
{
  const vals = [0.5, 1.5, 2.5, -0.5, -1.5, -2.5, 1.005, 2.675, 1.45, 8.345, 0.125, 0.375, 99.995, 100.005, 123456.785, -0.0001, 0.0049, 0.005, 0.015, 0.045, 33.335, 66.665, 143.5249999, 1e-7, -1e-7, 1e21, 5e-324, 0, -0, 12345678.915, 0.285, 1.255, 10.235, 7.5, 0.95, 99.95, 99.45];
  const r = mulberry32(99);
  for (let i = 0; i < 400; i++) vals.push(Math.round((r() * 300 - 40) * 1000) / 1000, (r() * 200 - 20) / 7, Math.round(r() * 20000) / 200);
  out.toFixed = vals.flatMap((v) => [0, 1, 2].map((dgt) => [v, dgt, v.toFixed(dgt)]));
}
out.shortCause = STOPPAGE_FIELDS.map((f) => [f.key, shortCause(f.key)]);

process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? `__${v}__` : v)));
