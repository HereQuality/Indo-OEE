"use strict";
/**
 * seed/seedMfaExamples.js
 * ─────────────────────────
 * Loads the MODULAR FRAME ASSEMBLY paper-sheet rows the user pasted on
 * 2026-10-26 (May 2024 — pick May 2024 in the MODULAR FRAME ASSEMBLY Data Entry
 * list to see them), then reads them back and checks every figure against the
 * paper. The same way as seed/seedRawCastingExamples.js.
 *
 * LOCAL DATABASE ONLY: it refuses to run unless MONGO_URI points at
 * mongodb://localhost or mongodb://127.0.0.1.
 *
 * Every entry goes through the sheet's own saveRow, the code the Data Entry
 * page's Save calls, so the stored fields are exactly what the app stores:
 * Rejected QTY (TOTAL − OK), Availability / Performance / Quality, the OEE
 * review flag of an entry over 100% (most of this paper's rows are), and the
 * audit log. It runs as the local Super Admin, the same as saving from the page
 * while logged in as one.
 *
 *  1. Master data, only what is missing, through the Master pages' own
 *     controllers:
 *     - Workers PRATIKSHA, ANJALI, MEENA, JINKAL and POONAM (Operator Master),
 *       assigned to MODULAR FRAME ASSEMBLY.
 *     - Parts (Item Master): one per distinct Item Name, with the Standard
 *       Assembly Time of the first row using it. Every entry still carries its
 *       own paper figure.
 *  2. The process's Operator Planned Shift lock is switched OFF while the rows
 *     are saved, so every entry is saved with Planned Operator Shift = its own
 *     Assembly Working Hours (the paper has no Planned column) and its figures
 *     are the paper's. The lock is put back to what it was afterwards, even when
 *     the run fails part-way.
 *  3. Rows that can't be loaded are reported, never forced in: the nine
 *     day-only rows with no worker ("Other machining Work" / W.OFF).
 *  4. Read back through getSheet for May 2024, each entry's figures are worked
 *     out with the client's own adapter (client/src/utils/mfaSheet.js) and
 *     compared with the paper: Ideal Assembly Quantity, Ideal Assembly Time,
 *     Unreported Time and both Productivity %.
 *
 * Safe to re-run: an entry already saved for the same date + worker + Assembly
 * Start Time is skipped.
 *
 * How the paper cells are read:
 *  - Dates are DD/MM/YYYY, except the first row, written "05-13-2024", which is
 *    13 May 2024 (MM-DD-YYYY).
 *  - "8:30" is 08:30.
 *  - "24 PIN FRAMEASSEMBLY" (POONAM 28/05) is loaded as "24 PIN FRAME ASSEMBLY",
 *    the part JINKAL's row names the same day.
 *  - Ideal Quantity and Unreported Time are compared as the paper rounds them
 *    where it does (row 1: 788.37 and 13.3).
 *
 *   node seed/seedMfaExamples.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const Process = require("../models/Process");
const MachineOperator = require("../models/MachineOperator");
const Item = require("../models/Item");
const User = require("../models/user.model");
const MfaEntry = require("../models/MfaEntry");
const mfaSheet = require("../controllers/mfaSheet.controller");
const machineOperatorController = require("../controllers/machineOperator.controller");
const itemController = require("../controllers/item.controller");

const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
const PROCESS_NAME = "MODULAR FRAME ASSEMBLY";
const CLIENT = path.resolve(__dirname, "../../client");

// ── The paper rows, cell for cell as pasted (trailing blank cells dropped) ──
// 0 Date | 1 Item Name | 2 Worker Name | 3 Working Status | 4 Reasons For Not Working |
// 5 Start | 6 End | 7 Working Hours | 8 Standard Time per Piece (Sec) | 9 Total QTY |
// 10 OK QTY | 11 Rejected QTY | 12 Ideal Quantity | 13 Ideal Quantity/Hour |
// 14 Other Activity | 15 Other Activity (min) | 16 Lunch / Tea / Washroom (Min) |
// 17 Other (Min) | 18 Total Idle Time | 19 Effective (hr) | 20 Unreported (min) |
// 21 Productivity % | 22 Productivity considering Lunch % | 23 Remarks
const PAPER = [
  ["05-13-2024", "24 PIN FRAME", "PRATIKSHA", "Working", "", "8:30", "17:55", "9.42", "43", "728", "390", "338", "788.37", "83.72093023", "", "", "30", "", "30", "8.695555556", "13.3", "92.34%", "97.52%"],
  ["14/05/2024", "24 PIN FRAME", "PRATIKSHA", "Working", "", "08:10", "10:50", "2.666666667", "80", "192", "140", "52", "120", "45", "", "", "", "", "0", "4.266666667", "-96", "160.00%", "160.00%"],
  ["14/05/2024", "24 PIN FRAME", "PRATIKSHA", "Working", "", "10:50", "11:24", "0.5666666667", "80", "140", "140", "", "25.5", "45", "", "", "", "", "0", "3.111111111", "-152.6666667", "549.02%", "549.02%"],
  ["11/05/2024", "24 PIN FRAME", "ANJALI", "Working", "", "08:15", "17:55", "9.666666667", "80", "180", "180", "", "435", "45", "", "", "30", "", "30", "4", "310", "41.38%", "43.64%", "NEW TRAINEE"],
  ["12/05/2024", "", "", "Working"],
  ["13/05/2024", "", "", "Working", "Other machining Work"],
  ["14/05/2024", "", "", "", "Other machining Work"],
  ["16/05/2024", "", "", "", "Other machining Work"],
  ["17/05/2024", "", "", "", "Other machining Work"],
  ["18/05/2024", "", "", "", "Other machining Work"],
  ["19/05/2024", "", "", "Not Working", "W.OFF"],
  ["20/05/2024", "", "", "", "Other machining Work"],
  ["26/05/2024", "", "", "", "W.OFF"],
  ["28/05/2024", "10 PIN FRAME ASSEMBLY", "MEENA", "Working", "", "16:30", "19:00", "2.5", "170", "40", "40", "", "52.94117647", "21.17647059", "", "", "", "", "0", "1.888888889", "36.66666667", "75.56%", "75.56%", "TRINEE SO MORE TIME TO MADE FRAME"],
  ["28/05/2024", "24 PIN FRAME ASSEMBLY", "JINKAL", "Working", "", "16:30", "17:10", "0.6666666667", "80", "35", "35", "", "30", "45", "", "", "", "", "0", "0.7777777778", "-6.666666667", "116.67%", "116.67%"],
  ["28/05/2024", "24 PIN FRAMEASSEMBLY", "POONAM", "Working", "", "16:40", "17:30", "0.8333333333", "80", "49", "49", "", "37.5", "45", "", "", "", "", "0", "1.088888889", "-15.33333333", "130.67%", "130.67%"],
  ["28/05/2024", "10 PIN FRAME ASSEMBLY", "POONAM", "Working", "", "17:35", "17:55", "0.3333333333", "170", "12", "12", "", "7.058823529", "21.17647059", "", "", "", "", "0", "0.5666666667", "-14", "170.00%", "170.00%"],
];

// Item Names as loaded, where the paper's spelling differs from the part's.
const ITEM_FIXES = { "24 PIN FRAMEASSEMBLY": "24 PIN FRAME ASSEMBLY" };
// The one date the paper writes MM-DD-YYYY (the first row).
const DATE_FIXES = { "05-13-2024": "2024-05-13" };

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
  if (DATE_FIXES[s]) return DATE_FIXES[s];
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) throw new Error(`Date "${s}" is not DD/MM/YYYY`);
  return `${m[3]}-${m[2]}-${m[1]}`;
};
// "8:30" -> "08:30".
const hhmm = (s) => {
  const m = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(s);
  if (!m) throw new Error(`Time "${s}" is not HH:mm`);
  return `${m[1].padStart(2, "0")}:${m[2]}`;
};
const clock = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Planned Operator Shift as the form sends it: decimal hours to 6 places (whole minutes).
const plannedHours = (shiftMin) => Number((shiftMin / 60).toFixed(6));
const dmy = (iso) => iso.split("-").reverse().join("/");
// How many decimals a paper figure is written to (13.3 → 1, 788.37 → 2), at most 6.
const dpOf = (s) => Math.min(6, (String(s).split(".")[1] || "").length);

// One paper row -> what is entered. Throws when a column doesn't add up, so a
// wrong column map can never load wrong figures quietly.
const readRow = (row, index) => {
  const paperItem = cell(row, 1);
  const r = {
    paperRow: index + 1,
    dateText: cell(row, 0),
    paperItem,
    itemName: ITEM_FIXES[paperItem] || paperItem,
    worker: cell(row, 2),
    status: cell(row, 3),
    reason: cell(row, 4),
  };
  r.date = isoDate(r.dateText);
  if (!r.worker) return r;
  const where = `row ${r.paperRow} (${r.dateText} ${r.worker})`;
  r.on = hhmm(cell(row, 5));
  r.off = hhmm(cell(row, 6));
  r.shiftMin = clock(r.off) - clock(r.on);
  const paperHours = num(cell(row, 7));
  if (paperHours === null || Math.abs(paperHours - r.shiftMin / 60) > 0.006) throw new Error(`${where}: Working Hours ${paperHours} is not End − Start (${r.shiftMin} min)`);
  r.std = num(cell(row, 8));
  r.total = num(cell(row, 9));
  r.ok = num(cell(row, 10));
  const paperRejected = num(cell(row, 11));
  if (paperRejected !== null && paperRejected !== r.total - r.ok) throw new Error(`${where}: Rejected ${paperRejected} is not TOTAL − OK`);
  r.otherActivity = cell(row, 14);
  r.otherActivityMin = num(cell(row, 15));
  r.lunch = num(cell(row, 16));
  r.otherIdle = num(cell(row, 17));
  const idle = (r.lunch || 0) + (r.otherIdle || 0);
  if (idle !== (num(cell(row, 18)) ?? 0)) throw new Error(`${where}: Lunch + Other is ${idle}, Total Idle Time is ${cell(row, 18)}`);
  r.paper = {
    ideal: [num(cell(row, 12)), dpOf(cell(row, 12))],
    eff: num(cell(row, 19)),
    unrep: [num(cell(row, 20)), dpOf(cell(row, 20))],
    prod: num(cell(row, 21)),
    prodLunch: num(cell(row, 22)),
  };
  r.remarks = cell(row, 23);
  return r;
};

const label = (r) => `${dmy(r.date)} ${r.worker || "—"} ${r.on ? `${r.on}–${r.off} ` : ""}${r.itemName}`.trim();

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
    created.workersAssigned.push(`${found.name} (+${proc.processName})`);
  }
  return found;
};

const ensurePart = async (name, std, proc) => {
  const found = await Item.findOne({ process: proc._id, itemName: new RegExp(`^${escapeRe(name)}$`, "i") }).lean();
  if (found) return found;
  const res = await call(itemController.createItem, {
    body: { itemName: name, drawingNo: "", setupNo: "", totalCycleSec: std, process: String(proc._id), isActive: true },
  });
  if (!ok(res)) throw new Error(`Part "${name}": ${res.payload?.message}`);
  created.parts.push(`${name} — ${std} sec`);
  return res.payload.data;
};

// ── Reading the entries back, worked out with the client's own adapter ─────

const verify = async (proc, rows) => {
  // The client adapter uses the bundler's extensionless imports, so it is
  // bundled in memory with the client's own esbuild, as its tests are.
  const esbuild = require(require.resolve("esbuild", { paths: [CLIENT] }));
  const bundle = await esbuild.build({
    stdin: {
      contents: ['export { mfaDayCalc, mfaRowCalc } from "./mfaSheet";', 'export { sortByMachineOn } from "./productionSheet";'].join("\n"),
      resolveDir: path.join(CLIENT, "src/utils"),
      loader: "js",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "warning",
  });
  const calc = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

  const entries = [];
  for (let page = 1, pages = 1; page <= pages; page += 1) {
    const res = await call(mfaSheet.getSheet, { query: { from: "2024-05-01", to: "2024-05-31", page: String(page) } });
    if (!ok(res)) throw new Error(`getSheet: ${res.payload?.message}`);
    entries.push(...res.payload.data);
    pages = res.payload.meta.totalPages;
  }
  const mine = entries.filter((e) => String(e.process) === String(proc._id));
  const day = {};
  const groups = {};
  for (const e of mine) (groups[`${e.machine}|${e.date}`] ||= []).push(e);
  for (const group of Object.values(groups)) {
    const sorted = calc.sortByMachineOn(group);
    calc.mfaDayCalc(sorted).forEach((d, i) => (day[sorted[i]._id] = d));
  }

  const pct = (v) => Math.round(v * 10000) / 100;
  const round = (v, dp) => Number(v.toFixed(dp));
  const bad = [];
  let checked = 0;
  for (const r of rows.filter((x) => x.worker)) {
    const e = mine.find((x) => x.date === r.date && x.operator === r.worker && x.machineOnTime === r.on);
    if (!e) {
      bad.push(`${label(r)}: not found`);
      continue;
    }
    const c = calc.mfaRowCalc(e);
    const d = day[e._id];
    const p = r.paper;
    const got = [round(c.idealQty, p.ideal[1]), c.effectiveHours, round(d.unreportedMin, p.unrep[1]), pct(d.productivity), pct(d.productivityLunch), e.rejectedQty];
    const want = [round(p.ideal[0], p.ideal[1]), p.eff, round(p.unrep[0], p.unrep[1]), p.prod, p.prodLunch, r.total - r.ok];
    const same = got[0] === want[0] && Math.abs(got[1] - want[1]) < 1e-6 && got[2] === want[2] && got[3] === want[3] && got[4] === want[4] && got[5] === want[5];
    if (!same || e.plannedLocked !== false || e.itemName !== r.itemName) {
      bad.push(`${label(r)}: got ${JSON.stringify(got)} plannedLocked ${e.plannedLocked} item "${e.itemName}", paper ${JSON.stringify(want)}`);
    }
    checked += 1;
  }
  return { inMay: mine.length, checked, bad };
};

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

  const proc = await Process.findOne({ processName: PROCESS_NAME }).lean();
  if (!proc) throw new Error(`No "${PROCESS_NAME}" process — run seed/seedMfaProcess.js first`);
  // Read every row first, so a column that doesn't add up stops the run before anything is written.
  const rows = PAPER.map(readRow);
  const result = { saved: [], already: [], skipped: [], refused: [] };

  // 1. Workers and parts.
  const partStd = new Map();
  for (const r of rows) if (r.worker && !partStd.has(r.itemName)) partStd.set(r.itemName, r.std);
  const ids = { workers: new Map(), parts: new Map() };
  for (const r of rows) {
    if (!r.worker) continue;
    if (!ids.workers.has(r.worker)) ids.workers.set(r.worker, (await ensureWorker(r.worker, proc))._id);
    if (!ids.parts.has(r.itemName)) ids.parts.set(r.itemName, (await ensurePart(r.itemName, partStd.get(r.itemName), proc))._id);
  }

  // 2. Planned shift lock OFF while saving, put back afterwards whatever happens.
  const was = (await Process.findById(proc._id).select("plannedShiftLocked").lean()).plannedShiftLocked;
  await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: false } });
  try {
    // 3. The entries, in paper order, through saveRow.
    for (const r of rows) {
      if (!r.worker) {
        result.skipped.push(`${dmy(r.date)} — ${[r.status, r.reason].filter(Boolean).join(", ") || "blank"}: no worker on the paper`);
        continue;
      }
      const worker = ids.workers.get(r.worker);
      if (await MfaEntry.exists({ date: new Date(`${r.date}T00:00:00.000Z`), worker, machineOnTime: r.on })) {
        result.already.push(label(r));
        continue;
      }
      const body = {
        date: r.date,
        worker: String(worker),
        process: String(proc._id),
        slot: "auto",
        workingMode: "Working",
        machineStatus: [],
        workingStatus: "",
        item: String(ids.parts.get(r.itemName)),
        itemName: r.itemName,
        totalCycleSec: r.std,
        machineOnTime: r.on,
        machineOffTime: r.off,
        actualQty: r.total,
        okQty: r.ok,
        otherActivity: r.otherActivity,
        otherActivityMin: r.otherActivityMin ?? "",
        // = the Assembly Working Hours: the paper has no Planned column.
        plannedOperatorShiftHours: plannedHours(r.shiftMin),
        lunchMin: r.lunch || 0,
        otherMin: r.otherIdle ?? "",
        otherMinRemark: "",
        remarks: r.remarks,
      };
      const res = await call(mfaSheet.saveRow, { body });
      if (ok(res) && res.payload?.data) {
        const doc = res.payload.data;
        const notes = [];
        if (r.paperItem !== r.itemName) notes.push(`paper's Item Name "${r.paperItem}" loaded as "${r.itemName}"`);
        if (doc.review?.status === "pending") notes.push(`held for OEE Review (${doc.review.flagged.map((f) => `${f.metric} ${(f.value * 100).toFixed(2)}%`).join(", ")})`);
        result.saved.push(`${label(r)}${notes.length ? ` — ${notes.join("; ")}` : ""}`);
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

  // 4. Read back and check against the paper.
  const check = await verify(proc, rows);

  const list = (title, items) => {
    console.log(`  ${title}: ${items.length}`);
    for (const it of items) console.log(`    - ${it}`);
  };
  console.log("\nMaster data created:");
  list("Workers", created.workers);
  if (created.workersAssigned.length) list(`Workers given ${PROCESS_NAME}`, created.workersAssigned);
  list("Parts", created.parts);
  console.log(`\n${PROCESS_NAME}:`);
  list("Saved", result.saved);
  list("Already saved before (skipped)", result.already);
  list("Skipped", result.skipped);
  list("Refused by the app", result.refused);
  console.log(`\nRead back (May 2024): ${check.inMay} entries; ${check.checked} paper rows checked, ${check.bad.length} differ from the paper.`);
  for (const b of check.bad) console.log(`    - ${b}`);
  await mongoose.disconnect();
  if (check.bad.length || result.refused.length) process.exit(1);
}

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
