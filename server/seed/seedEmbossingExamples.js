"use strict";
/**
 * seed/seedEmbossingExamples.js
 * ───────────────────────────────
 * Loads the real EMBOSSING paper-sheet rows the user pasted on 2026-10-26
 * (8–19 May 2024 — pick May 2024 in the EMBOSSING Data Entry list to see them).
 *
 * LOCAL DATABASE ONLY: it refuses to run unless MONGO_URI points at
 * mongodb://localhost or mongodb://127.0.0.1, and stops again if the
 * connection lands anywhere else.
 *
 * Every entry goes through the sheet's own saveRow — the code the Data Entry
 * page's Save calls — as the local Super Admin, so what is stored is exactly
 * what the app stores: Rejected (TOTAL − OK), Availability / Performance /
 * Quality, the OEE Review flag of an entry over 100%, and the audit log.
 *
 *  1. Master data, only what is missing, through the Master pages' own
 *     controllers: machines M/c -6/c and M/c -6/f (Machine Master, under
 *     EMBOSSING), operators JASHAL and JAYA BEN (Operator Master, given
 *     EMBOSSING), and parts S/P FOR-3 PIN (8.5 s) and S/P -10Amp (7.5 s) (Part
 *     Master, under EMBOSSING — every entry still carries its own paper
 *     Standard Time: 18/05's S/P -10Amp ran at 6.5 s).
 *  2. EMBOSSING's Operator Planned Shift lock is switched OFF while the rows are
 *     saved, so each entry is saved with Planned Operator Shift = its own
 *     Machine Shift (the paper has no Planned column) and its figures are the
 *     paper's. The lock is put back as it was afterwards, even when the run
 *     fails part-way.
 *  3. Rows that can't be loaded are listed, never forced in: a row with no
 *     MC No. (W.OFF / Leave days, and JASHAL's "Other Inspection" / blank
 *     Working days with no machine or figures), and anything saveRow refuses,
 *     with the server's own message.
 *
 * How the paper cells are read (each row is checked against its own totals
 * while loading; the run stops before writing anything if a column doesn't
 * add up):
 *  - Dates are DD-MM-YYYY.
 *  - "18:00:00" is 18:00. 16/05 and 18/05 write their times as Excel day
 *    fractions: 0.3333333333 is 08:00 and 0.75 is 18:00.
 *  - Columns 19–28 are the ten standard downtimes in the app's own order
 *    (Setup at 20, Lunch at 27); 29 is their total.
 *  - "Reasons For Not Working" on a Working day (row 1's "Other Inspection") is
 *    kept as the entry's Remarks. A Not Working day with a machine (17/05 M/c
 *    -6/f JAYA BEN, Leave) is saved as a Non Working entry with that reason as
 *    its Remarks.
 *
 * Safe to re-run: a Working entry already saved for the same date + machine +
 * Machine ON Time, or a Non Working entry for the same date + machine, is
 * skipped. The run ends by reading every loaded date back through getSheet
 * (the list the page shows) and comparing it with the paper.
 *
 *   node seed/seedEmbossingExamples.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const Process = require("../models/Process");
const MachineOperator = require("../models/MachineOperator");
const Machine = require("../models/Machine");
const Item = require("../models/Item");
const User = require("../models/user.model");
const EmbossingEntry = require("../models/EmbossingEntry");
const { STOPPAGE_KEYS } = require("../models/ProductionEntry");

const embossingSheet = require("../controllers/embossingSheet.controller");
const machineOperatorController = require("../controllers/machineOperator.controller");
const machineController = require("../controllers/machine.controller");
const itemController = require("../controllers/item.controller");

const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
const PROCESS_NAME = "EMBOSSING";

// ── The paper rows, cell for cell as pasted (no header row; trailing blank cells dropped) ──
// 0 Date | 1 MC No. | 2 Item Name | 3 Operator | 4 Working Status | 5 Reasons For Not Working |
// 6 Machine ON | 7 Machine OFF | 8 Machine Shift (h) | 9 Standard Time per Piece (s) | 10 TOTAL QTY |
// 11 OK QTY | 12 Rejected QTY | 13 OK % | 14 Ideal Quantity | 15 Ideal Quantity/Hour | 16–18 blank |
// 19–28 the ten downtimes | 29 Total Idle | 30 Effective (h) | 31 Unreported (min) | 32–34 OEE ×3 | 35 Remarks
const ROWS = [
  ["08-05-2024","M/c -6/c","S/P FOR-3 PIN","JASHAL","Working","Other Inspection ","08:00","18:00:00","10.00","8.5","3791","3791","0","100.00%","4,235.29","423.5294118","","","","","15","","","","","","","30","","45","8.950972222","17.9","96.77%","94.22%","96.77%"],
  ["09-05-2024","M/c -6/c","S/P -10Amp","JASHAL","Working","","08:00","18:00:00","10","7.5","4398","4398","0","100.00%","4800","480","","","","","15","","","","","","","30","","45","9.1625","5.25","99.05%","96.45%","99.05%"],
  ["10-05-2024","M/c -6/c","S/P FOR-3 PIN","JASHAL","Working","","08:00","18:00:00","10","8.5","3926","3910","16","99.59%","4235.294118","423.5294118","","","","","15","","","","","","","30","","45","9.269722222","-1.183333333","100.21%","97.58%","100.21%"],
  ["11-05-2024","M/c -6/c","S/P FOR-3 PIN","JASHAL","Working","","08:00","18:00:00","10","8.5","3694","3694","0","100.00%","4235.294118","423.5294118","","","","","15","","","","","","","30","","45","8.721944444","31.68333333","94.29%","91.81%","94.29%"],
  ["12-05-2024","","","","Not Working","W.OFF"],
  ["13-05-2024","M/c -6/c","S/P FOR-3 PIN","JASHAL","Working","","08:00","18:00:00","10","8.5","3958","3952","6","99.85%","4235.294118","423.5294118","","","","","15","","","","","","","30","","45","9.345277778","-5.716666667","101.03%","98.37%","101.03%"],
  ["14-05-2024","M/c -6/c","S/P FOR-3 PIN","JASHAL","Working","","08:00","18:00:00","10","8.5","3975","3970","5","99.87%","4235.294118","423.5294118","","","","","15","","","","","","","30","","45","9.385416667","-8.125","101.46%","98.79%","101.46%"],
  ["14-05-2024","M/c -6/f","S/P -10Amp","JAYA BEN","Working","","08:00","18:00:00","10","7.5","4076","4038","38","99.07%","4800","480","","","","","15","","","","","","","30","","45","8.491666667","45.5","91.80%","89.39%","91.80%"],
  ["15-05-2024","","","JASHAL","Not Working","Leave"],
  ["15-05-2024","M/c -6/f","S/P -10Amp","JAYA BEN","Working","","08:00","18:00:00","10","7.5","5400","5378","22","99.59%","4800","480","","","","","15","","","","","","","30","","45","11.25","-120","121.62%","118.42%","121.62%"],
  ["16-05-2024","","","JASHAL","Not Working","Leave"],
  ["16-05-2024","M/c -6/f","S/P -10Amp","JAYA BEN","Working","","0.3333333333","0.75","10","7.5","4111","4085","26","99.37%","4800","480","","","","","15","","","","","","","30","","45","8.564583333","41.125","92.59%","90.15%","92.59%"],
  ["17-05-2024","","","JASHAL","Working"],
  ["17-05-2024","M/c -6/f","","JAYA BEN","Not Working","Leave"],
  ["18-05-2024","","","JASHAL","Working","Other Inspection "],
  ["18-05-2024","M/c -6/f","S/P -10Amp","JAYA BEN","Working","","0.3333333333","0.75","10","6.5","5173","5138","35","99.32%","5538.461538","553.8461538","","","","","15","","","","","","","30","","45","9.340138889","-5.408333333","100.97%","98.32%","100.97%"],
  ["19-05-2024","","","JASHAL","Not Working","W.OFF"],
  ["19-05-2024","","","JAYA BEN","Not Working","W.OFF"],
];

const COLS = {
  date: 0,
  mc: 1,
  item: 2,
  operator: 3,
  status: 4,
  reason: 5,
  on: 6,
  off: 7,
  shift: 8,
  std: 9,
  total: 10,
  ok: 11,
  rejected: 12,
  stops: Object.fromEntries(STOPPAGE_KEYS.map((k, i) => [k, 19 + i])),
  idleTotal: 29,
  effective: 30,
  remarks: 35,
};

// ── Reading a paper cell ────────────────────────────────────────────────────

const cell = (row, i) => String(row[i] ?? "").trim();
const num = (s) => {
  const t = String(s ?? "").trim().replace(/%$/, "").replace(/,/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`"${s}" is not a number`);
  return n;
};
const isoDate = (s) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (!m) throw new Error(`Date "${s}" is not DD-MM-YYYY`);
  return `${m[3]}-${m[2]}-${m[1]}`;
};
// "08:00" / "18:00:00" -> HH:mm; an Excel day fraction (0.3333333333, 0.75) -> its clock time.
const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(s);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  if (/^0?\.\d+$/.test(s)) {
    const min = Math.round(Number(s) * 1440);
    return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  }
  throw new Error(`Time "${s}" is neither HH:mm nor a day fraction`);
};
const clock = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const cleanName = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sum = (list) => list.reduce((s, v) => s + (v ?? 0), 0);
// Planned Operator Shift as the form sends it: decimal hours to 6 places (whole minutes).
const plannedHours = (shiftMin) => Number((shiftMin / 60).toFixed(6));
const blankIfNull = (v) => (v === null || v === undefined ? "" : v);

// One paper row -> what is entered. Throws when a column doesn't add up, so a
// wrong column map can never load wrong figures quietly.
const readRow = (row, index) => {
  const r = {
    paperRow: index + 1,
    dateText: cell(row, COLS.date),
    mcName: cleanName(cell(row, COLS.mc)),
    itemName: cleanName(cell(row, COLS.item)),
    operator: cleanName(cell(row, COLS.operator)),
    status: cell(row, COLS.status),
    reason: cleanName(cell(row, COLS.reason)),
    notes: [],
  };
  r.date = isoDate(r.dateText);
  r.hasTimes = !!cell(row, COLS.on);
  if (r.status !== "Working" || !r.hasTimes) return r;
  const where = `row ${r.paperRow} (${r.dateText} ${r.mcName})`;

  r.on = hhmm(cell(row, COLS.on));
  r.off = hhmm(cell(row, COLS.off));
  r.shiftMin = clock(r.off) - clock(r.on);
  const paperShift = num(cell(row, COLS.shift));
  if (paperShift === null || Math.abs(paperShift - r.shiftMin / 60) > 1e-6) {
    throw new Error(`${where}: Machine Shift ${paperShift} h is not OFF − ON (${r.shiftMin} min)`);
  }
  r.std = num(cell(row, COLS.std));
  r.total = num(cell(row, COLS.total));
  r.ok = num(cell(row, COLS.ok));
  r.stops = Object.fromEntries(Object.entries(COLS.stops).map(([k, i]) => [k, num(cell(row, i))]));
  const idle = sum(Object.values(r.stops));
  const paperIdle = num(cell(row, COLS.idleTotal)) ?? 0;
  if (idle !== paperIdle) throw new Error(`${where}: downtime columns add up to ${idle}, Total Idle is ${paperIdle}`);
  const paperRejected = num(cell(row, COLS.rejected));
  if ((paperRejected ?? 0) !== r.total - r.ok) throw new Error(`${where}: Rejected QTY ${paperRejected} is not TOTAL − OK (${r.total - r.ok})`);
  const paperEff = num(cell(row, COLS.effective));
  if (Math.abs(paperEff - (r.total * r.std) / 3600) > 1e-6) throw new Error(`${where}: Effective ${paperEff} h is not TOTAL × Std ÷ 3600`);
  // Remarks: the paper's own, and a Working day's "Reasons For Not Working" (row 1's "Other Inspection").
  r.remarks = [r.reason, cell(row, COLS.remarks)].filter(Boolean).join(" — ");
  if (r.reason) r.notes.push(`"${r.reason}" under Reasons For Not Working on a Working day — kept as the entry's Remarks`);
  r.ideal = (r.shiftMin * 60) / r.std;
  if (r.total > r.ideal) r.notes.push(`TOTAL ${r.total} is more than the Ideal Quantity ${r.ideal.toFixed(2)} — saved, and held for OEE Review`);
  return r;
};

// ── Calling a controller the way Express does ───────────────────────────────

let ADMIN = null;
const call = async (handler, { body = {}, params = {}, query = {} } = {}) => {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await handler({ user: ADMIN, body, params, query, headers: {}, cookies: {}, ip: "127.0.0.1" }, res);
  return res;
};
const ok = (res) => res.statusCode >= 200 && res.statusCode < 300 && res.payload?.isOk !== false;

// ── Master data: only what is missing ───────────────────────────────────────

const created = { operators: [], operatorsAssigned: [], machines: [], parts: [] };

const ensureOperator = async (name, proc) => {
  const found = await MachineOperator.findOne({ name: new RegExp(`^${escapeRe(name)}$`, "i"), isActive: true }).lean();
  if (!found) {
    const res = await call(machineOperatorController.createMachineOperator, { body: { name, processes: [String(proc._id)], isActive: true } });
    if (!ok(res)) throw new Error(`Operator "${name}": ${res.payload?.message}`);
    created.operators.push(name);
    return res.payload.data;
  }
  const processes = (found.processes || []).map(String);
  // An operator with no process yet is offered on every sheet already — left as it is.
  if (processes.length && !processes.includes(String(proc._id))) {
    const res = await call(machineOperatorController.updateMachineOperator, {
      params: { operatorId: String(found._id) },
      body: { processes: [...processes, String(proc._id)] },
    });
    if (!ok(res)) throw new Error(`Operator "${name}": ${res.payload?.message}`);
    created.operatorsAssigned.push(`${found.name} (+${proc.processName})`);
  }
  return found;
};

const ensureMachine = async (name, proc) => {
  const found = await Machine.findOne({ machineName: new RegExp(`^${escapeRe(name)}$`, "i"), isDeleted: { $ne: true } }).lean();
  if (found) {
    if (String(found.process || "") !== String(proc._id)) {
      throw new Error(`Machine "${found.machineName}" already exists outside ${proc.processName} — not moved; move it in Machine Master first`);
    }
    if (found.isActive === false) throw new Error(`Machine "${found.machineName}" is inactive`);
    return found;
  }
  const res = await call(machineController.createMachine, { body: { machineName: name, process: String(proc._id), isActive: true } });
  if (!ok(res)) throw new Error(`Machine "${name}": ${res.payload?.message}`);
  created.machines.push(name);
  return res.payload.data;
};

const ensurePart = async (name, std, proc) => {
  const found = await Item.findOne({ process: proc._id, itemName: new RegExp(`^${escapeRe(name)}$`, "i") }).lean();
  if (found) return found;
  const res = await call(itemController.createItem, {
    body: { itemName: name, drawingNo: "", setupNo: "", totalCycleSec: std ?? "", process: String(proc._id), isActive: true },
  });
  if (!ok(res)) throw new Error(`Part "${name}": ${res.payload?.message}`);
  created.parts.push(`${name} — ${std} sec`);
  return res.payload.data;
};

const label = (r) =>
  `row ${r.paperRow} ${r.dateText} ${[r.mcName, r.operator].filter(Boolean).join(" / ") || "—"} ${r.on ? `${r.on}–${r.off} ` : ""}${r.itemName}`.trim();

async function run() {
  const uri = process.env.MONGO_URI || "";
  if (!LOCAL.test(uri)) {
    throw new Error("Refusing to run: MONGO_URI in server/.env must be a local database (mongodb://localhost or mongodb://127.0.0.1)");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const host = mongoose.connection.host;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Connected to "${host}", not a local database — stopping`);
  console.log(`Local database "${mongoose.connection.name}" on ${host}`);

  ADMIN = await User.findOne({ roleType: "SuperAdmin", isActive: { $ne: false } }).select("-password");
  if (!ADMIN) throw new Error("No active Super Admin in the local database");
  ADMIN.roleType = "SuperAdmin";

  const proc = await Process.findOne({ processName: PROCESS_NAME }).lean();
  if (!proc) throw new Error(`No "${PROCESS_NAME}" process — run seed/seedEmbossingProcess.js first`);

  // Read every row first, so a column that doesn't add up stops the run before anything is written.
  const parsed = ROWS.map((row, i) => readRow(row, i));
  const result = { saved: [], already: [], skipped: [], refused: [] };

  // 1. Operators, machines and parts — the first Standard Time a part runs at on the paper.
  const ids = { operators: new Map(), machines: new Map(), parts: new Map() };
  const partStd = new Map();
  for (const r of parsed) if (r.on && !partStd.has(r.itemName)) partStd.set(r.itemName, r.std);
  for (const r of parsed) {
    if (!r.mcName) continue;
    if (r.operator && !ids.operators.has(r.operator)) ids.operators.set(r.operator, (await ensureOperator(r.operator, proc))._id);
    if (!ids.machines.has(r.mcName)) ids.machines.set(r.mcName, (await ensureMachine(r.mcName, proc))._id);
    if (r.on && !ids.parts.has(r.itemName)) ids.parts.set(r.itemName, (await ensurePart(r.itemName, partStd.get(r.itemName), proc))._id);
  }

  // 2. Planned shift lock OFF while saving, put back afterwards whatever happens.
  const was = (await Process.findById(proc._id).select("plannedShiftLocked").lean()).plannedShiftLocked;
  await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: false } });
  const loadedDates = new Set();
  try {
    // 3. The entries, in paper order, through saveRow.
    for (const r of parsed) {
      if (!r.mcName) {
        result.skipped.push(`${label(r)} — ${r.status}${r.reason ? ` (${r.reason})` : ""}: no MC No. on the paper`);
        continue;
      }
      const day = new Date(`${r.date}T00:00:00.000Z`);
      const machine = ids.machines.get(r.mcName);
      if (r.status !== "Working") {
        // A Not Working day with a machine (17/05 M/c -6/f JAYA BEN, Leave): a Non Working entry, its reason as the remark.
        loadedDates.add(r.date);
        if (await EmbossingEntry.exists({ date: day, machine, workingMode: "Non Working" })) {
          result.already.push(label(r));
          continue;
        }
        const body = { date: r.date, machine: String(machine), slot: "auto", workingMode: "Non Working", machineStatus: [], operator: r.operator, workingStatus: "", remarks: r.reason };
        const res = await call(embossingSheet.saveRow, { body });
        if (ok(res) && res.payload?.data) result.saved.push(`${label(r)} — Non Working, remark "${r.reason}"`);
        else result.refused.push(`${label(r)} — ${res.statusCode}: ${res.payload?.message}`);
        continue;
      }
      if (!r.on) {
        result.skipped.push(`${label(r)} — Working, but no times or figures on the paper`);
        continue;
      }
      loadedDates.add(r.date);
      if (await EmbossingEntry.exists({ date: day, machine, machineOnTime: r.on })) {
        result.already.push(label(r));
        continue;
      }
      const body = {
        date: r.date,
        machine: String(machine),
        machineStatus: [],
        workingMode: "Working",
        slot: "auto",
        item: String(ids.parts.get(r.itemName)),
        vendor: null,
        operator: r.operator,
        workingStatus: "",
        itemName: r.itemName,
        drawingNo: "",
        remarks: r.remarks,
        otherMinRemark: "",
        machineOnTime: r.on,
        machineOffTime: r.off,
        totalCycleSec: blankIfNull(r.std),
        actualQty: blankIfNull(r.total),
        okQty: blankIfNull(r.ok),
        // = the Machine Shift: the paper has no Planned column.
        plannedOperatorShiftHours: plannedHours(r.shiftMin),
        ...Object.fromEntries(STOPPAGE_KEYS.map((k) => [k, blankIfNull(r.stops[k])])),
        // The form sends Lunch as 0 when it is left blank.
        lunchMin: r.stops.lunchMin ?? 0,
      };
      const res = await call(embossingSheet.saveRow, { body });
      if (ok(res) && res.payload?.data) {
        const doc = res.payload.data;
        const flagged = doc.review?.status === "pending" ? ` — held for OEE Review (${doc.review.flagged.map((f) => `${f.metric} ${(f.value * 100).toFixed(2)}%`).join(", ")})` : "";
        result.saved.push(`${label(r)}${flagged}`);
      } else {
        result.refused.push(`${label(r)} — ${res.statusCode}: ${res.payload?.message}`);
      }
    }
  } finally {
    if (was === undefined) await Process.updateOne({ _id: proc._id }, { $unset: { plannedShiftLocked: "" } });
    else await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: was } });
    console.log(`Planned shift lock put back: ${PROCESS_NAME} ${was === false ? "unlocked" : "locked"}`);
  }

  // A flagged save's admin notification is sent without being awaited — let it finish.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 4. Read back through getSheet — the list the Data Entry page shows — and compare with the paper.
  const dates = [...loadedDates].sort();
  const mismatches = [];
  let readBack = [];
  if (dates.length) {
    const res = await call(embossingSheet.getSheet, {
      query: { from: dates[0], to: dates[dates.length - 1], page: 1, machine: [...ids.machines.values()].map(String).join(",") },
    });
    if (!ok(res)) throw new Error(`getSheet: ${res.payload?.message}`);
    readBack = res.payload.data;
    for (const r of parsed) {
      if (!r.mcName || (r.status === "Working" && !r.on)) continue;
      const machine = String(ids.machines.get(r.mcName));
      const found = readBack.filter((e) => e.date === r.date && e.machine === machine && (r.status === "Working" ? e.machineOnTime === r.on : e.workingMode === "Non Working"));
      if (found.length !== 1) {
        mismatches.push(`${label(r)}: ${found.length} entries read back`);
        continue;
      }
      const e = found[0];
      const want =
        r.status === "Working"
          ? {
              operator: r.operator,
              itemName: r.itemName,
              machineOffTime: r.off,
              totalCycleSec: r.std,
              actualQty: r.total,
              okQty: r.ok,
              rejectedQty: r.total - r.ok,
              plannedOperatorShiftHours: plannedHours(r.shiftMin),
              setupMin: r.stops.setupMin,
              lunchMin: r.stops.lunchMin,
              remarks: r.remarks,
            }
          : { operator: r.operator, remarks: r.reason, actualQty: undefined };
      for (const [k, v] of Object.entries(want)) {
        const got = e[k] ?? undefined;
        if ((v ?? undefined) !== got && !(v === "" && got === undefined)) mismatches.push(`${label(r)}: ${k} read back ${JSON.stringify(got)}, paper ${JSON.stringify(v)}`);
      }
    }
  }

  // 5. Report.
  const list = (title, items) => {
    console.log(`  ${title}: ${items.length}`);
    for (const it of items) console.log(`    - ${it}`);
  };
  console.log("\nMaster data created:");
  list("Operators", created.operators);
  if (created.operatorsAssigned.length) list("Operators given EMBOSSING", created.operatorsAssigned);
  list("Machines", created.machines);
  list("Parts", created.parts);
  console.log(`\n${PROCESS_NAME}:`);
  list("Saved", result.saved);
  list("Already saved before (skipped)", result.already);
  list("Skipped", result.skipped);
  list("Refused by the app", result.refused);
  list("Notes on the paper", parsed.flatMap((r) => r.notes.map((n) => `${label(r)}: ${n}`)));
  console.log(`\nRead back through getSheet (${dates[0] || "—"} … ${dates[dates.length - 1] || "—"}): ${readBack.length} entries; ${mismatches.length ? `${mismatches.length} MISMATCH(ES)` : "all match the paper"}`);
  for (const m of mismatches) console.log(`    - ${m}`);
  await mongoose.disconnect();
  if (mismatches.length || result.refused.length) process.exitCode = 1;
}

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
