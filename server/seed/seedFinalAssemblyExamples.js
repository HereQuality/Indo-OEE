"use strict";
/**
 * seed/seedFinalAssemblyExamples.js
 * ───────────────────────────────────
 * Loads the user's 18 real FINAL ASSEMBLY paper rows (pasted 2026-10-26) into
 * the LOCAL database — May 2024, so pick May 2024 in the FINAL ASSEMBLY Data
 * Entry list to see them.
 *
 * LOCAL DATABASE ONLY: it refuses to run unless MONGO_URI points at
 * 127.0.0.1 / localhost, and checks the connected host again before writing.
 *
 * Every entry goes through the sheet's own saveRow (the code the Data Entry
 * page's Save calls), as the local Super Admin, so the stored fields are
 * exactly what the app stores: OK QTY / Total Defects, Availability /
 * Performance / Quality, the OEE review flag of an entry over 100% (the paper
 * has 154.17% and 116.67%), and the audit log.
 *
 *  1. Master data, only what is missing, through the Master pages' own
 *     controllers: the workers ALKESH, AMIT, ALPESH, VINAYAK (Operator Master,
 *     assigned to FINAL ASSEMBLY), and one part per distinct Item Name
 *     (trimmed) under FINAL ASSEMBLY with its Standard Time per Piece — PACKING
 *     gets none.
 *  2. FINAL ASSEMBLY's Planned Shift lock is switched OFF while the rows are
 *     saved, so each entry is saved with Planned Operator Shift = its own
 *     Working Hours (the paper has no Planned column) and its figures are the
 *     paper's; the lock is put back afterwards, even when the run fails.
 *  3. Read back through getSheet (the Data Entry list's own request) and
 *     checked against the paper, field by field.
 *
 * Dates: "05-11-2024" and "5/11/2024" are month-first — 11 May 2024 (the rows
 * after them are 11/05/2024); every other date is DD/MM/YYYY.
 *
 * Safe to re-run: a row already saved for the same date + worker + Start Time
 * + Item Name + Total QTY is skipped (ALPESH has several 08:00–18:00 PACKING
 * rows on one date, told apart by their Total).
 *
 *   node seed/seedFinalAssemblyProcess.js     (first: the process and its menu)
 *   node seed/seedFinalAssemblyExamples.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const Process = require("../models/Process");
const MachineOperator = require("../models/MachineOperator");
const Item = require("../models/Item");
const User = require("../models/user.model");
const FinalAssemblyEntry = require("../models/FinalAssemblyEntry");
const { FA_DEFECT_REASONS } = FinalAssemblyEntry;
const faSheet = require("../controllers/finalAssemblySheet.controller");
const machineOperatorController = require("../controllers/machineOperator.controller");
const itemController = require("../controllers/item.controller");

const PROCESS_NAME = "FINAL ASSEMBLY";

// The paper, cell for cell (paste.tsv): Date, Item Name, Worker Name, Start,
// End, Std (sec, blank for PACKING), Total QTY, OK QTY, the four defects
// (Wrong Assembly, Broken Screw, Wrong Clamping, Other), Other Activity
// Carried out, its minutes, Lunch / Tea (min), Other idle (min), Remarks.
const ROWS = [
  ["05-11-2024", "24 PIN SIDE ENTRY B/M", "ALKESH", "09:30", "10:30", 30, 185, 185, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["5/11/2024", "24 PIN SIDE ENTRY B/C", "ALKESH", "10:30", "11:00", 30, 40, 40, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "6 PIN SIDE ENTRY B/M", "ALKESH", "11:00", "14:00", 30, 200, 200, [0, 0, 0, 0], "", null, 30, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "64 PIN FEMALE WITH HOOD ", "ALKESH", "14:55", "15:55", 20, 60, 60, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "48 PIN  FEMALE S/E B/M", "ALKESH", "14:55", "15:55", 60, 12, 12, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "16 PIN MINATURE FEMALE B/M", "ALKESH", "16:00", "17:00", 30, 140, 140, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "4/0 PIN S/E B/O", "ALKESH", "17:00", "19:00", 60, 25, 25, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "6 PIN 35 A SET B/O", "ALKESH", "17:00", "19:00", 50, 18, 18, [0, 0, 0, 0], "", null, null, null, "AMIT , DILIP, AJAY "],
  ["11/05/2024", "6 PIN 35 A MALE WITH HOOD ", "ALKESH", "17:00", "19:00", 50, 18, 18, [0, 0, 0, 0], "", null, null, null, ""],
  ["11/05/2024", "PACKING ", "AMIT", "15:00", "19:00", null, 0, 0, [0, 0, 0, 0], "Material Shifting", null, null, null, ""],
  ["16/05/2024", "PACKING ", "ALPESH ", "08:00", "18:00", null, 170, 170, [0, 0, 0, 0], "", null, 30, null, "MAHESH "],
  ["16/05/2024", "PACKING ", "ALPESH ", "08:00", "18:00", null, 8, 8, [0, 0, 0, 0], "", null, 30, null, "MAHESH "],
  ["16/05/2024", "PACKING ", "VINAYAK", "08:00", "18:00", null, 8, 8, [0, 0, 0, 0], "", null, 30, null, "DIVYYESH , NIMISHA "],
  ["16/05/2024", "PACKING ", "ALPESH ", "08:00", "18:00", null, 200, 200, [0, 0, 0, 0], "", null, 30, null, "MAHESH "],
  ["16/05/2024", "PACKING ", "ALPESH ", "08:00", "18:00", null, 20, 20, [0, 0, 0, 0], "", null, 30, null, "MAHESH "],
  ["16/05/2024", "PACKING ", "ALPESH ", "08:00", "18:00", null, 4, 4, [0, 0, 0, 0], "", null, 30, null, "MAHESH "],
  ["16/05/2024", "PACKING ", "ALPESH ", "08:00", "18:00", null, 600, 600, [0, 0, 0, 0], "", null, 30, null, "MAHESH "],
  ["16/05/2024", "PACKING ", "VINAYAK", "08:00", "18:00", null, 1, 1, [0, 0, 0, 0], "", null, 30, null, "DIVYYESH , NIMISHA"],
];

// "05-11-2024" and "5/11/2024" are month-first (11 May 2024); the rest DD/MM/YYYY.
const MONTH_FIRST = new Set(["05-11-2024", "5/11/2024"]);
const isoOf = (s) => {
  const [a, b, y] = s.split(/[/-]/).map(Number);
  const [d, m] = MONTH_FIRST.has(s) ? [b, a] : [a, b];
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const minutesOf = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const blankIfNull = (v) => (v === null || v === undefined ? "" : v);
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parse = (r, i) => {
  const [dateText, item, worker, on, off, std, total, ok, defects, activity, activityMin, lunch, otherIdle, remarks] = r;
  return {
    paperRow: i + 1,
    dateText,
    date: isoOf(dateText),
    itemName: item.trim(),
    worker: worker.trim(),
    on,
    off,
    hours: (minutesOf(off) - minutesOf(on)) / 60,
    std,
    total,
    ok,
    split: Object.fromEntries(FA_DEFECT_REASONS.map((reason, k) => [reason, defects[k]]).filter(([, n]) => n > 0)),
    activity: activity.trim(),
    activityMin,
    lunch,
    otherIdle,
    remarks: remarks.trim(),
  };
};
const label = (r) => `row ${r.paperRow} ${r.dateText} ${r.worker} ${r.on}–${r.off} ${r.itemName} (Total ${r.total})`;

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
const created = { workers: [], workersAssigned: [], parts: [] };

const ensureWorker = async (name, proc) => {
  const found = await MachineOperator.findOne({ name: new RegExp(`^${escapeRe(name)}$`, "i"), isActive: true }).lean();
  if (!found) {
    const res = await call(machineOperatorController.createMachineOperator, { body: { name, processes: [String(proc._id)], isActive: true } });
    if (!ok(res)) throw new Error(`Worker "${name}": ${res.payload?.message}`);
    created.workers.push(name);
    return res.payload.data;
  }
  const processes = (found.processes || []).map(String);
  // A worker with no process yet is offered on every sheet already — left as it is.
  if (processes.length && !processes.includes(String(proc._id))) {
    const res = await call(machineOperatorController.updateMachineOperator, {
      params: { operatorId: String(found._id) },
      body: { processes: [...processes, String(proc._id)] },
    });
    if (!ok(res)) throw new Error(`Worker "${name}": ${res.payload?.message}`);
    created.workersAssigned.push(found.name);
  }
  return found;
};

const ensurePart = async (name, std, proc) => {
  const found = await Item.findOne({ process: proc._id, itemName: new RegExp(`^${escapeRe(name)}$`, "i") }).lean();
  if (found) return found;
  const res = await call(itemController.createItem, {
    body: { itemName: name, drawingNo: "", setupNo: "", totalCycleSec: blankIfNull(std), process: String(proc._id), isActive: true },
  });
  if (!ok(res)) throw new Error(`Part "${name}": ${res.payload?.message}`);
  created.parts.push(`${name} — ${std ?? "no"} sec`);
  return res.payload.data;
};

async function run() {
  const uri = process.env.MONGO_URI || "";
  if (!/^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(uri)) {
    throw new Error("Refusing to run: MONGO_URI in server/.env must be a local database (mongodb://127.0.0.1 or localhost)");
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const host = mongoose.connection.host;
  if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Connected to "${host}", not a local database — stopping`);
  console.log(`Local database "${mongoose.connection.name}" on ${host}`);

  ADMIN = await User.findOne({ roleType: "SuperAdmin", isActive: { $ne: false } }).select("-password");
  if (!ADMIN) throw new Error("No active Super Admin in the local database");
  ADMIN.roleType = "SuperAdmin";

  const proc = await Process.findOne({ processName: PROCESS_NAME }).lean();
  if (!proc) throw new Error(`No "${PROCESS_NAME}" process — run seed/seedFinalAssemblyProcess.js first`);

  const rows = ROWS.map(parse);
  // The paper's own OK = Total − defects on every row (stops before anything is written if not).
  for (const r of rows) {
    const defects = Object.values(r.split).reduce((a, b) => a + b, 0);
    if (r.ok !== r.total - defects) throw new Error(`${label(r)}: OK ${r.ok} isn't Total − defects`);
  }

  // 1. Workers and parts.
  const workerIds = new Map();
  for (const name of [...new Set(rows.map((r) => r.worker))]) workerIds.set(name, (await ensureWorker(name, proc))._id);
  const partStd = new Map();
  for (const r of rows) if (!partStd.has(r.itemName) || (partStd.get(r.itemName) === null && r.std !== null)) partStd.set(r.itemName, r.std);
  const partIds = new Map();
  for (const [name, std] of partStd) partIds.set(name, (await ensurePart(name, std, proc))._id);

  // 2. Lock OFF while saving, put back afterwards whatever happens.
  const result = { saved: [], already: [], refused: [] };
  const was = (await Process.findById(proc._id).select("plannedShiftLocked").lean()).plannedShiftLocked;
  await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: false } });
  try {
    for (const r of rows) {
      const worker = workerIds.get(r.worker);
      const key = { date: new Date(`${r.date}T00:00:00.000Z`), worker, machineOnTime: r.on, itemName: r.itemName, actualQty: r.total };
      if (await FinalAssemblyEntry.exists(key)) {
        result.already.push(label(r));
        continue;
      }
      const body = {
        date: r.date,
        worker: String(worker),
        process: String(proc._id),
        slot: "auto",
        vendor: "",
        workingMode: "Working",
        machineStatus: [],
        item: String(partIds.get(r.itemName)),
        itemName: r.itemName,
        totalCycleSec: blankIfNull(r.std),
        machineOnTime: r.on,
        machineOffTime: r.off,
        actualQty: r.total,
        rejectBreakdown: r.split,
        rejectReason: Object.entries(r.split).sort((a, b) => b[1] - a[1])[0]?.[0] || "",
        rejectOtherRemark: "",
        otherActivity: r.activity,
        otherActivityMin: blankIfNull(r.activityMin),
        // = the Working Hours: the paper has no Planned column.
        plannedOperatorShiftHours: Number(r.hours.toFixed(6)),
        // The form sends Lunch as 0 when it is left blank.
        lunchMin: r.lunch ?? 0,
        otherMin: blankIfNull(r.otherIdle),
        otherMinRemark: "",
        remarks: r.remarks,
        workingStatus: "",
      };
      const res = await call(faSheet.saveRow, { body });
      if (ok(res) && res.payload?.data) {
        const doc = res.payload.data;
        const flagged = doc.review?.status === "pending" ? ` — held for OEE Review (${doc.review.flagged.map((f) => `${f.metric} ${(f.value * 100).toFixed(2)}%`).join(", ")})` : "";
        result.saved.push(`${label(r)} → entry ${doc.slot}${flagged}`);
      } else {
        result.refused.push(`${label(r)} — ${res.statusCode}: ${res.payload?.message}`);
      }
    }
  } finally {
    if (was === undefined) await Process.updateOne({ _id: proc._id }, { $unset: { plannedShiftLocked: "" } });
    else await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: was } });
    console.log(`Planned shift lock put back: ${was === false ? "unlocked" : "locked"}`);
  }

  // A flagged save's admin notification is sent without being awaited — let it finish.
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // 3. Read back through getSheet — what the Data Entry list loads — and check against the paper.
  const back = await call(faSheet.getSheet, { query: { from: "2024-05-01", to: "2024-05-31", page: "1" } });
  if (!ok(back)) throw new Error(`getSheet: ${back.payload?.message}`);
  const list = back.payload.data;
  const mismatches = [];
  for (const r of rows) {
    const worker = String(workerIds.get(r.worker));
    const found = list.filter((e) => e.date === r.date && e.worker === worker && e.machineOnTime === r.on && e.itemName === r.itemName && e.actualQty === r.total);
    if (found.length !== 1) {
      mismatches.push(`${label(r)}: found ${found.length} in getSheet`);
      continue;
    }
    const e = found[0];
    const want = { machineOffTime: r.off, totalCycleSec: r.std ?? undefined, okQty: r.ok, rejectedQty: r.total - r.ok, plannedOperatorShiftHours: Number(r.hours.toFixed(6)), plannedLocked: false, remarks: r.remarks, otherActivity: r.activity };
    for (const [k, v] of Object.entries(want)) if (e[k] !== v) mismatches.push(`${label(r)}: ${k} ${JSON.stringify(e[k])} ≠ ${JSON.stringify(v)}`);
    if (e.machine !== worker || back.payload.machineNames[worker] !== r.worker) mismatches.push(`${label(r)}: worker not named`);
  }
  const flaggedBack = list.filter((e) => e.review?.status === "pending").map((e) => `${back.payload.machineNames[e.worker]} ${e.date} ${e.machineOnTime} ${e.itemName}`);

  // 4. Report.
  const show = (title, items) => {
    console.log(`  ${title}: ${items.length}`);
    for (const it of items) console.log(`    - ${it}`);
  };
  console.log("\nMaster data created:");
  show("Workers", created.workers);
  if (created.workersAssigned.length) show("Workers given FINAL ASSEMBLY", created.workersAssigned);
  show("Parts", created.parts);
  console.log("\nEntries:");
  show("Saved", result.saved);
  show("Already there (skipped)", result.already);
  show("Refused", result.refused);
  console.log(
    `\nRead back through getSheet (May 2024): ${list.length} FINAL ASSEMBLY entries; ${
      mismatches.length ? `${mismatches.length} mismatch(es):` : `all ${rows.length} paper rows found, as typed.`
    }`,
  );
  for (const m of mismatches) console.log(`    - ${m}`);
  show("Held for OEE Review", flaggedBack);

  await mongoose.disconnect();
  if (result.refused.length || mismatches.length) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
