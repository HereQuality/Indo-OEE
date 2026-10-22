// Golden fixtures for lib/features/production/process_master/process_master_logic.dart.
// The helpers below are COPIED from client/src/pages/ProcessMaster.jsx (a page cannot be
// imported); the catalog lookups come from the real client/src/utils/processDashboard.js.
//
//   ESB=../client/node_modules/.bin/esbuild
//   $ESB test/production/process_master/tool/gen_process_master_golden.mjs --bundle --platform=node \
//        --format=esm --outfile=<scratch>/pm-golden/gen.mjs
//   OUT_DIR=test/production/process_master/fixtures node <scratch>/pm-golden/gen.mjs
import fs from "node:fs";
import path from "node:path";
import { CHARTS_BY_KEY, DEFAULT_CHARTS, DEFAULT_STATS, STATS_BY_KEY, resolveWidgets } from "../../../../../client/src/utils/processDashboard.js";

const LOCKED_SHIFT_HOURS = 12;
const OUT = process.env.OUT_DIR || "test/production/process_master/fixtures";

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261022);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// ── copied from ProcessMaster.jsx ──
const initialState = { processName: "", description: "", machineIds: [], stats: DEFAULT_STATS, charts: DEFAULT_CHARTS, dataEntryMenu: "", dataEntryMenuLabel: "", plannedShiftLocked: true, plannedShiftHours: LOCKED_SHIFT_HOURS, isActive: true };
const validate = (v) => {
  const errors = {};
  if (!v.processName.trim()) errors.processName = "Process name is required!";
  else if (v.processName.length > 40) errors.processName = "Process name must not exceed 40 characters";
  if (v.description && v.description.length > 200) errors.description = "Description must not exceed 200 characters";
  if (v.plannedShiftLocked) {
    const h = Number(v.plannedShiftHours);
    if (v.plannedShiftHours === "" || !Number.isFinite(h) || h <= 0 || h > 24) errors.plannedShiftHours = "Shift hours must be more than 0 and at most 24";
  }
  return errors;
};
const payload = (values) => ({
  ...values,
  processName: values.processName.trim(),
  plannedShiftLocked: values.plannedShiftLocked !== false,
  plannedShiftHours: values.plannedShiftHours === "" ? LOCKED_SHIFT_HOURS : Number(values.plannedShiftHours),
});
const openEdit = (p) => ({
  processName: p.processName,
  description: p.description || "",
  machineIds: (p.machines || []).map((m) => m._id),
  stats: resolveWidgets(p.stats, STATS_BY_KEY, DEFAULT_STATS).map((w) => w.key),
  charts: resolveWidgets(p.charts, CHARTS_BY_KEY, DEFAULT_CHARTS).map((w) => w.key),
  dataEntryMenu: p.dataEntryMenu || "",
  dataEntryMenuLabel: p.dataEntryMenuLabel || "",
  plannedShiftLocked: p.plannedShiftLocked !== false,
  plannedShiftHours: p.plannedShiftHours ?? LOCKED_SHIFT_HOURS,
  isActive: p.isActive,
});
const machineOptions = (machines, activeProcesses, here) => {
  const activeIds = new Set(activeProcesses.map((p) => String(p._id)));
  return machines.filter((m) => !m.process || String(m.process) === here || !activeIds.has(String(m.process))).map((m) => m._id);
};
const dashboardText = (row) =>
  `${resolveWidgets(row.stats, STATS_BY_KEY, DEFAULT_STATS).length} KPI tiles · ${resolveWidgets(row.charts, CHARTS_BY_KEY, DEFAULT_CHARTS).length} graphs`;
const shiftText = (row) => (row.plannedShiftLocked === false ? "Unlocked · manual" : `Locked · ${row.plannedShiftHours ?? LOCKED_SHIFT_HOURS} hr`);

const statKeys = Object.keys(STATS_BY_KEY);
const chartKeys = Object.keys(CHARTS_BY_KEY);
const text = () => pick(["", " ", "VMC", "  PRESS  ", "x".repeat(40), "x".repeat(41), "TRAUB M/C", "ü".repeat(12)]);
const hours = () => pick(["", "0", "-1", "8", "12", "7.5", "24", "24.5", "abc", "1e1", " 9 ", "0.25", "12."]);

const validateCases = [];
for (let i = 0; i < 400; i++) {
  const values = {
    ...initialState,
    processName: text(),
    description: pick(["", "d", "y".repeat(200), "y".repeat(201)]),
    plannedShiftLocked: chance(0.7),
    plannedShiftHours: hours(),
  };
  validateCases.push({ values, errors: validate(values) });
}

const payloadCases = [];
for (let i = 0; i < 300; i++) {
  const values = {
    ...initialState,
    processName: text() || "A",
    machineIds: chance(0.5) ? [] : ["m1", "m2"],
    stats: chance(0.5) ? DEFAULT_STATS : statKeys.slice(0, 3),
    plannedShiftLocked: pick([true, false, true]),
    plannedShiftHours: hours(),
  };
  const out = payload(values);
  // Number("abc") is NaN, which JSON would turn into null — keep only comparable cases.
  if (Number.isFinite(out.plannedShiftHours)) payloadCases.push({ values, payload: out });
}

const stateCases = [];
for (let i = 0; i < 200; i++) {
  const p = {
    _id: "p" + i,
    processName: "Proc " + i,
    ...(chance(0.5) ? { description: "desc" } : {}),
    machines: chance(0.3) ? undefined : [{ _id: "m1", machineName: "A" }, { _id: "m2", machineName: "B" }].slice(0, Math.floor(rnd() * 3)),
    stats: pick([undefined, null, [], [statKeys[0], "bogus", statKeys[1]], statKeys, "nope"]),
    charts: pick([undefined, null, [], [chartKeys[0], "bogus"], chartKeys]),
    dataEntryMenu: pick([undefined, "", "/hqepl/production/vmc-data-entry"]),
    dataEntryMenuLabel: pick([undefined, "", "VMC Data Entry"]),
    plannedShiftLocked: pick([undefined, true, false]),
    plannedShiftHours: pick([undefined, null, 8, 12, 7.5, 24]),
    isActive: pick([true, false]),
  };
  stateCases.push({ process: JSON.parse(JSON.stringify(p)), values: JSON.parse(JSON.stringify(openEdit(p))), dashboard: dashboardText(p), shift: shiftText(p) });
}

const machineCases = [];
for (let i = 0; i < 100; i++) {
  const procs = ["p1", "p2", "p3"];
  const machines = Array.from({ length: 6 }, (_, k) => ({ _id: "m" + k, ...(chance(0.7) ? { process: pick([...procs, "", null, "gone"]) } : {}) }));
  const active = procs.filter(() => chance(0.7)).map((id) => ({ _id: id }));
  const here = pick(["", "p1", "p2"]);
  machineCases.push({ machines: JSON.parse(JSON.stringify(machines)), active, here, ids: machineOptions(machines, active, here) });
}

fs.mkdirSync(OUT, { recursive: true });
const write = (n, v) => fs.writeFileSync(path.join(OUT, n), JSON.stringify(v));
write("validate.json", validateCases);
write("payload.json", payloadCases);
write("state.json", stateCases);
write("machines.json", machineCases);
write("defaults.json", { stats: DEFAULT_STATS, charts: DEFAULT_CHARTS });
console.log("process master fixtures:", validateCases.length, payloadCases.length, stateCases.length, machineCases.length);
