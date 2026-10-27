// Golden-fixture generator for test/production/processes/mfa/*.
// Runs the REAL client utils/mfaSheet.js + mfaValidation.js (+ shared utils) and
// the REAL Components/Production/mfaColumns.jsx; the page's pure handlers are
// copied from pages/ModularFrameAssemblyDataEntry.jsx / MfaEntryForm.jsx.
//
//   cd mobile
//   ../client/node_modules/.bin/esbuild test/production/processes/mfa/tool/gen_mfa_golden.mjs --bundle \
//     --platform=node --format=esm --loader:.js=jsx --loader:.css=empty "--define:import.meta.env={}" \
//     "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
//     --outfile=<scratch>/mfa-golden/gen.mjs
//   OUT_DIR=test/production/processes/mfa/fixtures TZ=Asia/Kolkata node <scratch>/mfa-golden/gen.mjs
// NaN/Infinity/undefined travel as {"$n":..} / {"$u":1}.
import fs from "node:fs";
import path from "node:path";
import { isoDay, sortByMachineOn } from "../../../../../../client/src/utils/productionSheet.js";
import {
  MFA_FORMULAS, MFA_IDLE_FIELDS, MFA_LABELS, MFA_MAX_ENTRIES_PER_DAY, MFA_WORDS, NON_WORKING_STATUSES,
  isMfaProcess, isStatusOnly, mfaDayCalc, mfaRowCalc,
} from "../../../../../../client/src/utils/mfaSheet.js";
import { firstOverLimit } from "../../../../../../client/src/utils/limitNotice.js";
import { MFA_FIELD_ORDER, MFA_MINUTE_KEYS, firstMfaError, validateMfaEntry } from "../../../../../../client/src/utils/mfaValidation.js";
import { quantityFormValues } from "../../../../../../client/src/utils/quantityRules.js";
import { hmToWireHours, hoursToShiftInput, parseShiftHours } from "../../../../../../client/src/utils/shiftHours.js";
import { MFA_COLUMNS } from "../../../../../../client/src/Components/Production/mfaColumns.jsx";

const OUT = process.env.OUT_DIR;
if (!OUT) throw new Error("set OUT_DIR");
fs.mkdirSync(OUT, { recursive: true });
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(Number(process.env.SEED || 20261027));
const SCALE = Number(process.env.SCALE || 1);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
function enc(v) {
  if (v === undefined) return { $u: 1 };
  if (typeof v === "number") { if (Number.isNaN(v)) return { $n: "NaN" }; if (v === Infinity) return { $n: "Inf" }; if (v === -Infinity) return { $n: "-Inf" }; return v; }
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = enc(x); return o; }
  return v;
}
function encIn(v) {
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : encIn(x)));
  if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = encIn(x); return o; }
  return enc(v);
}
const write = (n, d) => fs.writeFileSync(path.join(OUT, n), JSON.stringify(d));
const wire = (v) => JSON.parse(JSON.stringify(v));
const dropUndefined = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k]; return o; };

// ── page handlers (copied) ──
const TEXT_FIELDS = ["workingStatus", "itemName", "otherActivity", "remarks", "otherMinRemark"];
const TIME_FIELDS = ["machineOnTime", "machineOffTime"];
const NUMBER_FIELDS = ["totalCycleSec", "actualQty", "okQty", "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin"];
const hasAnyEntryData = (list) => list.some((v) => v.machine ? true : [...TEXT_FIELDS, ...TIME_FIELDS, ...NUMBER_FIELDS].some((k) => v[k] !== "" && v[k] !== undefined && v[k] !== null));
const emptyEntry = () => ({ date: isoDay(new Date()), machine: "", machineStatus: [], workingMode: "Working", slot: 1, item: "",
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, ""])), ...Object.fromEntries(TIME_FIELDS.map((k) => [k, ""])), ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, ""])) });
const toFormValues = (row) => ({ ...emptyEntry(), ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined)),
  item: row.item || "", slot: row.slot, actualQty: quantityFormValues(row).actualQty, plannedOperatorShiftHours: hoursToShiftInput(row.plannedOperatorShiftHours) });
const KEPT = ["workingStatus", "workingMode", "machineStatus", "remarks"];
const toFullPayload = (v, isEdit, processId) => ({
  ...(isEdit && v._id ? { _id: v._id } : {}), date: v.date, machine: v.machine, process: processId,
  machineStatus: v.workingMode === "Non Working" ? v.machineStatus || [] : [], workingMode: v.workingMode || "Working",
  slot: isEdit ? Number(v.slot) : "auto", item: v.item || null,
  ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, String(v[k] ?? "").trim()])),
  otherMinRemark: Number(v.otherMin) > 0 ? String(v.otherMinRemark ?? "").trim() : "",
  ...Object.fromEntries(TIME_FIELDS.map((k) => [k, v[k] ?? ""])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, v[k] === "" || v[k] === undefined ? "" : Number(v[k])])),
  plannedOperatorShiftHours: (() => { const { hours } = parseShiftHours(v.plannedOperatorShiftHours); return hours === null ? "" : hmToWireHours(hours); })(),
  lunchMin: v.lunchMin === "" || v.lunchMin === undefined ? 0 : Number(v.lunchMin),
});
const toPayload = (v, isEdit, pid) => {
  const body = toFullPayload(v, isEdit, pid);
  if (!isStatusOnly(v) && v.workingMode !== "Non Working") return body;
  return Object.fromEntries(Object.entries(body).map(([k, val]) => (["_id", "date", "machine", "process", "slot", ...KEPT].includes(k) ? [k, val] : [k, k === "item" ? null : ""])));
};
const savePayload = (body) => { const { machine, ...row } = body; return wire({ ...row, worker: machine }); };
const DATA_KEYS = ["machineStatus", "itemName", "totalCycleSec", "machineOnTime", "machineOffTime", "actualQty", "okQty", "otherActivity", "otherActivityMin", "plannedOperatorShiftHours", "lunchMin", "otherMin", "otherMinRemark", "remarks"];
const blockHasData = (v) => v.workingMode === "Non Working" || DATA_KEYS.some((k) => (Array.isArray(v[k]) ? v[k].length > 0 : v[k] !== "" && v[k] !== undefined && v[k] !== null));
const handleItemSelect = (v, id, items) => { if (!id) return { ...v, item: "", itemName: "", totalCycleSec: "" }; const it = items.find((i) => i._id === id); if (!it) return { ...v, item: "" }; return { ...v, item: it._id, itemName: it.itemName, totalCycleSec: it.totalCycleSec ?? "" }; };

// ── pools ──
const TIMES_OK = ["06:00", "07:30", "08:00", "9", "930", "9:30", "13:15", "14:00", "16:00", "22:00", "23:59", "00:00", "02:00", "17:00"];
const TIMES_BAD = ["24:00", "9:5", "abc", "", "  ", "25", null, undefined, 930, "9-30"];
const NUMS = ["", undefined, null, "0", "1", "5", "10", "12.5", 3, 7.5, "  ", "abc", "-4", "1e2", "45", 45, "120", "600", "1440", "1441"];
const QTY = ["", undefined, null, "0", "10", "50", "100", "163", "166", "250", "480", 320, "12.5", "-3", "abc", "  ", "9999"];
const ITEMS = ["Frame A", "Frame B", " Rail ", "X"];
const STATUSES = ["", "", "", "PRESENT", "ABSENT", "SUNDAY", "LEAVE", " absent ", "present", undefined, null, 7];
function saneRow(id) {
  const [on, off] = pick([["06:00", "14:00"], ["14:00", "22:00"], ["22:00", "06:00"], ["08:00", "16:00"], ["9", "17"], ["9:30", "18.15"]]);
  const total = int(0, 700); const ok = Math.max(0, total - int(0, 30));
  return { _id: id, date: "2026-04-06", machine: "w" + int(1, 4), operator: "Worker " + int(1, 5), itemName: pick(ITEMS), machineOnTime: on, machineOffTime: off,
    totalCycleSec: pick(["30", "45", "60", "176", 45, "12.5", "3600"]), actualQty: String(total), okQty: String(ok),
    plannedOperatorShiftHours: pick([8, 8.5, 9, 9.42, 12, "8", 7.75]), lunchMin: pick(["0", "20", "30", "", 30]), otherMin: pick(["", "0", "5", "15"]),
    otherActivityMin: pick(["", "0", "10", "25"]), remarks: pick(["", "ok"]) };
}
function junkRow(id) {
  const row = { _id: id };
  if (chance(0.85)) row.itemName = pick([...ITEMS, " ", "", null, undefined, 7]);
  if (chance(0.9)) row.machineOnTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.9)) row.machineOffTime = pick([...TIMES_OK, ...TIMES_BAD]);
  if (chance(0.7)) row.totalCycleSec = pick(NUMS);
  if (chance(0.85)) row.actualQty = pick(QTY);
  if (chance(0.7)) row.okQty = pick(QTY);
  if (chance(0.25)) row.rejectedQty = pick(QTY);
  if (chance(0.5)) row.plannedOperatorShiftHours = pick([...NUMS, 8.5, 12]);
  for (const k of ["lunchMin", "otherMin", "otherActivityMin", "setupMin", "bdMechMin"]) if (chance(0.4)) row[k] = pick(NUMS);
  if (chance(0.3)) row.workingStatus = pick(STATUSES);
  if (chance(0.15)) row.workingMode = pick(["Working", "Non Working", "", undefined]);
  return row;
}

const curated = [
  { itemName: "Frame", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "176", actualQty: "166", okQty: "160", plannedOperatorShiftHours: 8 },
  { itemName: "Frame", machineOnTime: "09:00", machineOffTime: "10:00", totalCycleSec: "30", actualQty: "80", okQty: "80", plannedOperatorShiftHours: 1 },
  { itemName: "Frame", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", actualQty: "", okQty: "3" },
  { itemName: "Frame", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "0", actualQty: "10", okQty: "10" },
  { itemName: "Frame", machineOnTime: "22:00", machineOffTime: "06:00", totalCycleSec: "36", actualQty: "700", okQty: "690", plannedOperatorShiftHours: 9 },
  { itemName: "Frame", machineOnTime: "08:00", machineOffTime: "16:00", totalCycleSec: "45", okQty: "5", rejectedQty: "1" }, {},
];
const rowCases = [...curated];
for (let i = 0; i < 700 * SCALE; i++) rowCases.push(chance(0.5) ? saneRow("r" + i) : junkRow("r" + i));
const rowOut = rowCases.map((row) => ({ row: encIn(row), out: enc(mfaRowCalc(row)) }));
rowOut.push({ row: null, out: enc(mfaRowCalc(null)) });
write("row_calc.json", rowOut);
write("helpers.json", {
  statusOnly: rowCases.map((row) => ({ row: encIn(row), statusOnly: isStatusOnly(row) })),
  mfaProcess: [
    { dataEntryMenu: "/hqepl/production/modular-frame-assembly-data-entry" }, { dataEntryMenu: "/admin/production/modular-frame-assembly-data-entry/" },
    { dataEntryMenu: "/hqepl/production/modular-frame-drilling-data-entry", processName: "MODULAR FRAME ASSEMBLY" },
    { dataEntryMenu: "", processName: "MODULAR FRAME ASSEMBLY" }, { processName: "Modular Frame  Assembly" }, { processName: "MODULAR FRAME DRILLING" },
    { processName: "FINAL ASSEMBLY" }, { processName: "CNC" }, { dataEntryMenu: null, processName: null }, {},
  ].map((p) => ({ process: p, mfa: isMfaProcess(p) })),
});

const dayCases = [];
const addDay = (rows) => { const sorted = sortByMachineOn(rows); dayCases.push({ rows: encIn(rows), order: sorted.map((r) => r._id), out: enc(mfaDayCalc(sorted)) }); };
const mk = (id, on, off, x = {}) => ({ _id: id, itemName: "Frame", machineOnTime: on, machineOffTime: off, totalCycleSec: "45", actualQty: "100", okQty: "96", plannedOperatorShiftHours: 8, ...x });
addDay([]);
addDay([mk("a", "08:00", "16:00", { totalCycleSec: "176", actualQty: "166", okQty: "160", lunchMin: "30" })]);
addDay([mk("a", "14:00", "22:00", { lunchMin: "30" }), mk("b", "06:00", "13:30", { lunchMin: "20", otherActivityMin: "15" }), mk("c", "22:00", "02:00")]);
addDay([mk("a", "06:00", "10:00"), mk("b", "08:00", "12:00"), mk("c", "08:00", "10:00")]);
addDay([mk("a", "08:00", "16:00", { plannedLocked: true }), mk("b", "09:00", "10:00", { plannedLocked: true })]);
addDay([null, mk("a", "08:00", "16:00"), null]);
addDay([mk("a", "", ""), mk("b", "abc", "")]);
for (let i = 0; i < 300 * SCALE; i++) {
  const rows = [];
  for (let j = 0; j < int(1, 4); j++) { const r = chance(0.7) ? saneRow(`d${i}_${j}`) : junkRow(`d${i}_${j}`); if (chance(0.15)) r.plannedLocked = true; rows.push(r); }
  addDay(rows);
}
write("day_calc.json", dayCases);

const baseValid = () => ({ date: "2026-04-06", machine: "w1", machineStatus: [], workingMode: "Working", itemName: "Frame", machineOnTime: "08:00", machineOffTime: "16:00",
  totalCycleSec: "45", actualQty: "600", okQty: "590", otherActivity: "", otherActivityMin: "", plannedOperatorShiftHours: "8.5", lunchMin: "30", otherMin: "", otherMinRemark: "", remarks: "" });
const M = [
  {}, { date: "" }, { date: null }, { machine: "" }, { machine: undefined }, { itemName: "" }, { itemName: "   " },
  { workingMode: "Non Working" }, { workingMode: "Non Working", date: "", machine: "" }, { workingStatus: "ABSENT" }, { workingStatus: "SUNDAY", machine: "" }, { workingStatus: "PRESENT" }, { workingStatus: " LEAVE " }, { workingStatus: 5 },
  { machineOnTime: "" }, { machineOffTime: "" }, { machineOnTime: "abc" }, { machineOffTime: "25:00" }, { machineOnTime: "9" }, { machineOnTime: "22:00", machineOffTime: "06:00" }, { machineOnTime: "08:00", machineOffTime: "08:00" }, { machineOnTime: "", machineOffTime: "" },
  { totalCycleSec: "" }, { totalCycleSec: "0" }, { totalCycleSec: "abc" }, { totalCycleSec: "-3" }, { totalCycleSec: 45 }, { totalCycleSec: undefined },
  { actualQty: "" }, { actualQty: undefined }, { actualQty: "abc" }, { actualQty: "-1" }, { actualQty: "0", okQty: "0" }, { actualQty: "12.5", okQty: "12" }, { actualQty: "9999" }, { actualQty: "700" }, { actualQty: "700", okQty: "800" },
  { okQty: "" }, { okQty: "abc" }, { okQty: "-1" }, { okQty: "601" }, { okQty: "589.5" }, { okQty: 590 }, { okQty: "600" },
  { plannedOperatorShiftHours: "" }, { plannedOperatorShiftHours: "0" }, { plannedOperatorShiftHours: "24" }, { plannedOperatorShiftHours: "24.01" }, { plannedOperatorShiftHours: "abc" }, { plannedOperatorShiftHours: "7.59" }, { plannedOperatorShiftHours: "8" }, { plannedOperatorShiftHours: "9.42" }, { plannedOperatorShiftHours: "9", machineOnTime: "22:00", machineOffTime: "06:00" },
  { lunchMin: "" }, { lunchMin: "abc" }, { lunchMin: "-1" }, { lunchMin: "1441" }, { lunchMin: "480" }, { lunchMin: "481" }, { lunchMin: "479", otherMin: "2", otherMinRemark: "r" },
  { otherActivityMin: "10" }, { otherActivityMin: "10", otherActivity: "Packing" }, { otherActivityMin: "10", otherActivity: "  " }, { otherActivityMin: "abc" }, { otherActivityMin: "1441" }, { otherActivityMin: "450", otherActivity: "x" }, { otherActivityMin: "451", otherActivity: "x" },
  { otherMin: "5" }, { otherMin: "5", otherMinRemark: "power cut" }, { otherMin: "abc" }, { otherMin: "-1" }, { otherMin: "451", otherMinRemark: "r" },
  { machineOnTime: "", lunchMin: "5000" }, { date: "", machine: "", itemName: "" },
  { actualQty: "700", okQty: "800", plannedOperatorShiftHours: "0", lunchMin: "-1", otherMin: "9", otherActivityMin: "9999", totalCycleSec: "0" },
];
const valInputs = M.map((m) => dropUndefined({ ...baseValid(), ...m }));
for (let i = 0; i < 320 * SCALE; i++) valInputs.push(dropUndefined({ ...baseValid(), ...pick(M), ...pick(M), ...pick(M) }));
for (let i = 0; i < 120 * SCALE; i++) { const r = junkRow("v" + i); r.machine = pick(["w1", "", undefined, "  "]); r.date = pick(["2026-04-06", "", undefined]); valInputs.push(dropUndefined(r)); }
const savedVariants = [null, { machineOnTime: "08:00", machineOffTime: "16:00" }, { machineOnTime: "9", machineOffTime: "8" }, { machineOnTime: "bad", machineOffTime: "" }];
const valCases = valInputs.map((v) => { const saved = pick(savedVariants); return { values: encIn(v), saved, errors: saved ? validateMfaEntry(v, { saved }) : validateMfaEntry(v) }; });
write("validation.json", valCases);
const errLists = [];
for (let i = 0; i < 80; i++) { const l = []; for (let j = 0; j < int(0, 3); j++) l.push(pick(valCases).errors); if (chance(0.15)) l.push(null); errLists.push(l); }
errLists.push([], [{}], [{ zzz: "x", date: "d" }], [{}, { zzz: "only unknown" }]);
write("first_error.json", { order: MFA_FIELD_ORDER, minuteKeys: MFA_MINUTE_KEYS, cases: errLists.map((l) => ({ errors: l, first: firstMfaError(l.map((e) => e || {})) })) });

const stored = (x = {}) => ({ _id: "e" + int(1, 99999), date: "2026-04-06", worker: "w1", machine: "w1", process: "p1", operator: "Asha", slot: pick([1, 2, 3]), item: pick(["i1", null]), itemName: "Frame",
  totalCycleSec: 45, machineOnTime: "08:00", machineOffTime: "16:00", actualQty: pick([600, undefined, null]), okQty: 590, rejectedQty: pick([10, undefined]),
  otherActivity: pick(["", "Packing"]), otherActivityMin: pick([undefined, 10]), plannedOperatorShiftHours: pick([8.5, 8, 7.75, 9.416667, null]), lunchMin: pick([30, 0, undefined]),
  otherMin: pick([undefined, 5]), otherMinRemark: pick(["", "power cut"]), remarks: pick(["", "ok"]), review: pick([undefined, { status: "pending" }]),
  workingMode: pick([undefined, "Non Working"]), machineStatus: pick([undefined, ["No Manpower"]]), workingStatus: pick([undefined, "", "ABSENT"]), ...x });
write("to_form_values.json", Array.from({ length: 80 * SCALE }, () => { const row = dropUndefined(stored()); return { row: encIn(row), out: enc(toFormValues(row)) }; }));
const payloadCases = [];
for (const v of valInputs) for (const isEdit of [false, true]) {
  if (chance(0.6)) continue;
  const values = dropUndefined({ ...v, _id: pick([undefined, "e1", ""]), slot: pick([1, 2, 3, "2", undefined, "abc"]), item: pick(["", "i1", undefined]) });
  const pid = pick(["p1", "p2"]);
  payloadCases.push({ values: encIn(values), isEdit, processId: pid, payload: savePayload(toPayload(values, isEdit, pid)) });
}
for (const x of [{ workingStatus: "ABSENT" }, { workingMode: "Non Working", machineStatus: ["No Manpower"] }, { workingStatus: "SUNDAY", remarks: " note " }]) for (const isEdit of [false, true]) {
  const values = { ...baseValid(), ...x, item: "i1", _id: "e9", slot: 2 };
  payloadCases.push({ values: encIn(values), isEdit, processId: "p1", payload: savePayload(toPayload(values, isEdit, "p1")) });
}
write("payload.json", payloadCases);
const dataInputs = [...valInputs.slice(0, 60), emptyEntry(), { ...emptyEntry(), machine: "w1" }, { ...emptyEntry(), workingMode: "Non Working" }, { ...emptyEntry(), machineStatus: ["No Planning"] }, { ...emptyEntry(), remarks: "x" }, { ...emptyEntry(), lunchMin: "0" }, { ...emptyEntry(), okQty: "0" }];
const dataCases = dataInputs.map((v) => ({ values: encIn(v), blockHasData: blockHasData(v), anyData: hasAnyEntryData([v]) }));
dataCases.push({ list: [encIn(emptyEntry()), encIn({ ...emptyEntry(), machine: "w1" })], anyData: true }, { list: [encIn(emptyEntry()), encIn(emptyEntry())], anyData: false });
write("has_data.json", dataCases);
const items = [{ _id: "i1", itemName: "Frame", totalCycleSec: 45 }, { _id: "i2", itemName: "Cap", totalCycleSec: null }, { _id: "i3", itemName: "Rail", totalCycleSec: "" }, { _id: "i4", itemName: "Slow", totalCycleSec: 12.5 }];
write("item_select.json", { items, cases: ["", "i1", "i2", "i3", "i4", "nope"].map((id) => { const v = { ...baseValid(), item: "iX", itemName: "Old", totalCycleSec: "99" }; return { values: encIn(v), itemId: id, out: enc(handleItemSelect(v, id, items)) }; }) });
write("formulas.json", MFA_FORMULAS);
write("fields.json", { idle: MFA_IDLE_FIELDS, nonWorking: NON_WORKING_STATUSES, labels: MFA_LABELS, max: MFA_MAX_ENTRIES_PER_DAY, words: MFA_WORDS });

const overNames = { w1: "Asha", w2: "Ravi" };
const overCases = [];
for (let i = 0; i < 160 * SCALE; i++) {
  const blocks = Array.from({ length: int(1, 3) }, () => {
    const b = dropUndefined({ ...baseValid(), ...pick(M), machine: pick(["w1", "w2", "w9"]) });
    if (chance(0.7)) { b.machineOnTime = pick(["08:00", "09:30"]); b.machineOffTime = pick(["09:00", "10:30", "16:00"]); b.lunchMin = pick(["", "30", "70"]); b.otherMin = pick(["", "10", "40"]); b.otherMinRemark = pick(["", "why"]); b.otherActivityMin = pick(["", "20", "90"]); b.otherActivity = pick(["", "x"]); }
    return b;
  });
  const errors = blocks.map((b) => validateMfaEntry(b));
  overCases.push({ blocks: encIn(blocks), errors: encIn(errors), machineName: overNames, out: enc(firstOverLimit(blocks, errors, mfaRowCalc, { qtyKey: null, words: MFA_WORDS, machineName: overNames })) });
}
write("first_over_limit.json", overCases);

const textOf = (el) => {
  if (el === null || el === undefined || el === false) return "";
  if (typeof el === "string" || typeof el === "number") return String(el);
  if (Array.isArray(el)) return el.map(textOf).join("");
  if (el && typeof el === "object" && typeof el.$$typeof === "symbol") {
    const name = typeof el.type === "string" ? el.type : el.type?.name;
    if (name === "WithRemark") return textOf(el.props.value);
    if (name === "span") return textOf(el.props.children);
    return { $skip: name || "element" };
  }
  return String(el);
};
const flat = MFA_COLUMNS.flatMap((c) => (c.expandable ? [c.summary, ...c.columns] : [c]));
const cellRows = [];
for (let i = 0; i < 40 * SCALE; i++) { const r = i < 30 ? saneRow("t" + i) : junkRow("t" + i); r.machine = pick(["w1", "w2", "w9"]); r.date = pick(["2026-04-06", "2026-04-07"]);
  if (chance(0.2)) r.workingMode = "Non Working"; if (chance(0.2)) r.machineStatus = pick([["No Manpower"], [], ["No Planning", "No Manpower"]]); if (chance(0.3)) r.otherMinRemark = "power cut"; if (chance(0.3)) r.otherActivity = "Packing"; cellRows.push(r); }
const ctx = { machineName: { w1: "Asha", w2: "Ravi" } };
const dayOf = {}; const groups = {};
for (const r of cellRows) (groups[`${r.machine}|${r.date}`] ||= []).push(r);
for (const g of Object.values(groups)) { const sorted = sortByMachineOn(g); const res = mfaDayCalc(sorted); sorted.forEach((r, i) => { dayOf[r._id] = res[i]; }); }
write("cells.json", {
  columns: flat.map((c) => ({ key: c.key, label: c.label })),
  groups: MFA_COLUMNS.filter((c) => c.expandable).map((c) => ({ key: c.key, label: c.label, summary: c.summary.key, columns: c.columns.map((s) => s.key) })),
  machineName: ctx.machineName,
  rows: cellRows.map((r) => { const c = mfaRowCalc(r); const d = dayOf[r._id]; return { row: encIn(r), cells: Object.fromEntries(flat.map((col) => [col.key, textOf(col.get(r, c, d, ctx))])) }; }),
});
console.log("ok", { rows: rowOut.length, days: dayCases.length, validation: valCases.length, payload: payloadCases.length });
