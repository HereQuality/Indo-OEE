"use strict";
/**
 * seed/seedRawCastingExamples.js
 * ────────────────────────────────
 * Loads the RAW CASTING paper-sheet rows the user pasted on 2026-10-26 (May
 * 2024 — pick May 2024 in the RAW CASTING Data Entry list to see them), then
 * reads them back and checks every figure against the paper.
 *
 * LOCAL DATABASE ONLY: it refuses to run unless MONGO_URI points at
 * mongodb://localhost or mongodb://127.0.0.1.
 *
 * Every entry goes through the sheet's own saveRow, the code the Data Entry
 * page's Save calls, so the stored fields are exactly what the app stores: OK
 * QTY and Total Defects worked out from TOTAL and the defects, Availability /
 * Performance / Quality, any OEE review flag, and the audit log. It runs as the
 * local Super Admin, the same as saving from the page while logged in as one.
 *
 *  1. Master data, only what is missing, through the Master pages' own
 *     controllers:
 *     - Workers MANJU and ANJU (Operator Master), assigned to RAW CASTING — the
 *       way AFTER POWDER COATING's page finds its workers.
 *     - Vendors Alucast, Shivsons and Dio (Vendor Master), ticked for RAW CASTING.
 *     - Parts (Item Master): one per distinct Item Name, with the Standard
 *       Inspection Time of the first row using it. Every entry still carries
 *       its own paper figure.
 *  2. RAW CASTING's Operator Planned Shift lock is switched OFF while the rows
 *     are saved, so every entry is saved with Planned Operator Shift = its own
 *     Inspection Working Hours (the paper has no Planned column) and its
 *     figures are the paper's. The lock is put back to what it was afterwards,
 *     even when the run fails part-way.
 *  3. Rows that can't be loaded are reported, never forced in: the 12/05 W.OFF
 *     day has no worker on the paper.
 *  4. Read back through getSheet for May 2024, each entry's figures are worked
 *     out with the client's own adapter (client/src/utils/rawCastingSheet.js)
 *     and compared with the paper: Ideal Inspection Quantity (2 dp), Ideal
 *     Inspection Time, Unreported Time and both Productivity %.
 *
 * Safe to re-run: an entry already saved for the same date + worker +
 * Inspection Start Time is skipped.
 *
 * How the paper cells are read:
 *  - ANJU 14/05 14:10 writes OK 324 against TOTAL 317 (a typo). It is saved
 *    with TOTAL 317 and its 19 Crack/Damage defects, as on the paper, so the
 *    app works OK out as 298.
 *  - ANJU 11/05's 240 min of Other idle has no remark of its own; the row's
 *    Reason/Remarks ("HOOD SAT IN CAGE") is used as that remark too, since the
 *    app asks for one.
 *
 *   node seed/seedRawCastingExamples.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");

const Process = require("../models/Process");
const MachineOperator = require("../models/MachineOperator");
const Vendor = require("../models/Vendor");
const Item = require("../models/Item");
const User = require("../models/user.model");
const RawCastingEntry = require("../models/RawCastingEntry");
const rawCastingSheet = require("../controllers/rawCastingSheet.controller");
const machineOperatorController = require("../controllers/machineOperator.controller");
const vendorController = require("../controllers/vendor.controller");
const itemController = require("../controllers/item.controller");

const LOCAL = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//;
const PROCESS_NAME = "RAW CASTING";
const CLIENT = path.resolve(__dirname, "../../client");

// ── The paper rows, as pasted ───────────────────────────────────────────────
// [date, item, vendor, challan, worker, status, reason, start, end, std, total, ok, blow holes,
//  crack/damage, other, ideal qty, ideal insp. time (hr), unreported (min), productivity %,
//  productivity considering lunch %, lunch (min), other idle (min), remarks]
const PAPER = [
  ["2024-05-02", "24 PIN B/O(M)", "Alucast", "", "MANJU", "Working", "", "12:30", "14:30", 30, 218, 215, 0, 0, 3, 240.0, 1.816666667, 11.0, 90.83, 90.83, 0, 0, ""],
  ["2024-05-10", "24 PIN B/O D/C,P/C", "Shivsons", "DC/28", "MANJU", "Working", "", "08:15", "16:00", 36, 686, 668, 5, 13, 0, 775.0, 6.86, 23.4, 88.52, 94.62, 30, 0, ""],
  ["2024-05-10", "24 PIN HOOD H/C S/E,PG-29", "Alucast", "105", "MANJU", "Working", "", "16:00", "19:00", 30, 340, 340, 0, 0, 0, 360.0, 2.833333333, 10, 94.44, 94.44, 0, 0, ""],
  ["2024-05-10", "24 PIN BO ,D/C,P/C", "Shivsons", "DC/28", "ANJU", "Working", "", "08:15", "16:00", 32, 799, 759, 20, 20, 0, 871.88, 7.102222222, 8.866666667, 91.64, 97.96, 30, 0, ""],
  ["2024-05-10", "24 PIN HOOD S/E,PG-21,D/C,P/C", "Dio", "DC-0537", "ANJU", "Working", "", "16:00", "19:00", 25, 400, 380, 20, 0, 0, 432.0, 2.777777778, 13.33333333, 92.59, 92.59, 0, 0, ""],
  ["2024-05-11", "3 PIN B/O S/C,MS", "Dio", "DC-0537", "MANJU", "Working", "", "08:15", "17:00", 38, 744, 681, 0, 63, 0, 828.95, 7.853333333, 23.8, 89.75, 95.19, 30, 0, ""],
  ["2024-05-11", "3 PIN B/O S/C, MS", "Dio", "DC-0537", "ANJU", "Working", "", "08:15", "19:00", 23, 940, 871, 0, 69, 0, 1682.61, 6.005555556, 14.66666667, 55.87, 58.59, 30, 240, "HOOD SAT IN CAGE"],
  ["2024-05-12", "", "", "", "", "Not Working", "W.OFF"],
  ["2024-05-13", "24 PIN HOOD S/E,PG-21,D/C P/C", "Dio", "DC-0537", "ANJU", "Working", "", "08:15", "14:30", 40, 478, 478, null, null, null, 562.5, 5.311111111, 26.33333333, 84.98, 92.37, 30, 0, "M-SEAL FILING, CHECKING"],
  ["2024-05-14", "24 PIN B/O,D/C,P/C", "Alucast", "DC/31", "ANJU", "Working", "", "14:10", "17:55", 40, 317, 324, null, 19, null, 337.5, 3.522222222, 13.66666667, 93.93, 93.93, 0, 0, "M-SEAL FILING, CHECKING"],
  ["2024-05-14", "24 PIN HOOD S/E,PG-21,D/C,MS", "Dio", "DC-0541", "MANJU", "Working", "", "17:00", "19:00", 33, 179, 179, null, null, null, 218.18, 1.640833333, 21.55, 82.04, 82.04, 0, 0, "DRILLING,"],
  ["2024-05-15", "24 PIN HOOD S/E,PG-21,D/C,P/C", "Dio", "DC-0541", "MANJU", "Working", "", "08:15", "10:00", 19, 317, 276, 41, null, null, 331.58, 1.673055556, 4.616666667, 95.6, 95.6, 0, 0, ""],
  ["2024-05-15", "16 PIN HOOD S/E,PG-21 D/C MS", "Dio", "DC-0541", "MANJU", "Working", "", "10:10", "16:30", 35, 596, 541, 55, null, null, 651.43, 5.794444444, 2.333333333, 91.49, 99.33, 30, 0, ""],
  ["2024-05-15", "24 PIN HOOD H/C,S/E, PG-29,S/C,MS", "Alucast", "110", "MANJU", "Working", "", "16:10", "18:50", 35, 247, 237, 10, null, null, 274.29, 2.401388889, 15.91666667, 90.05, 90.05, 0, 0, ""],
  ["2024-05-15", "24 PIN HOOD S/E,H/CPG-29 S/C,PC", "Alucast", "110", "ANJU", "Working", "", "08:15", "17:45", 30, 1056, 1020, 32, 4, null, 1140.0, 8.8, 12, 92.63, 97.78, 30, 0, ""],
  ["2024-05-15", "24 PIN B/C HPR (NEW ITEM BIG)", "", "", "ANJU", "Working", "", "17:55", "18:50", 30, 100, 50, 20, 30, null, 110.0, 0.8333333333, 5, 90.91, 90.91, 0, 0, ""],
  ["2024-05-16", "24 PI B/C HPR", "Shivsons", "", "ANJU", "Working", "", "08:30", "10:00", 30, 108, 47, 61, null, null, 180.0, 0.9, 36, 60.0, 60.0, 0, 0, ""],
  ["2024-05-16", "24 PIN B/O,D/C,P/C", "Shivsons", "DC/31", "ANJU", "Working", "", "10:05", "11:55", 25, 235, 200, 15, 20, null, 264.0, 1.631944444, 12.08333333, 89.02, 89.02, 0, 0, ""],
];

const DEFECT_COLS = { "Blow Holes Casting": 12, "Crack/Damage Casting": 13, Other: 14 };

const clock = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Planned Operator Shift as the form sends it: decimal hours to 6 places (whole minutes).
const plannedHours = (shiftMin) => Number((shiftMin / 60).toFixed(6));
const dmy = (iso) => iso.split("-").reverse().join("/");

const readRow = (row, index) => {
  const [date, itemName, vendorName, challanNo, worker, status, reason, on, off, std, total, okOnPaper] = row;
  const r = { paperRow: index + 1, date, itemName, vendorName, challanNo, worker, status, reason, on, off, std, total, okOnPaper };
  if (status !== "Working") return r;
  r.defects = {};
  for (const [defect, i] of Object.entries(DEFECT_COLS)) if (row[i]) r.defects[defect] = row[i];
  [r.ideal, r.eff, r.unrep, r.prod, r.prodLunch, r.lunch, r.otherIdle, r.remarks] = row.slice(15);
  r.shiftMin = clock(off) - clock(on);
  r.ok = total - Object.values(r.defects).reduce((s, n) => s + n, 0);
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

const created = { workers: [], workersAssigned: [], vendors: [], vendorsAssigned: [], parts: [] };

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

const ensureVendor = async (name, proc) => {
  const found = await Vendor.findOne({ name: new RegExp(`^${escapeRe(name)}$`, "i"), isActive: true }).lean();
  if (!found) {
    const res = await call(vendorController.createVendor, { body: { name, processes: [String(proc._id)], isActive: true } });
    if (!ok(res)) throw new Error(`Vendor "${name}": ${res.payload?.message}`);
    created.vendors.push(name);
    return res.payload.data;
  }
  const processes = (found.processes || []).map(String);
  if (!processes.includes(String(proc._id))) {
    const res = await call(vendorController.updateVendor, { params: { vendorId: String(found._id) }, body: { processes: [...processes, String(proc._id)] } });
    if (!ok(res)) throw new Error(`Vendor "${name}": ${res.payload?.message}`);
    created.vendorsAssigned.push(`${found.name} (+${proc.processName})`);
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
      contents: ['export { rawCastingDayCalc, rawCastingRowCalc } from "./rawCastingSheet";', 'export { sortByMachineOn } from "./productionSheet";'].join("\n"),
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
    const res = await call(rawCastingSheet.getSheet, { query: { from: "2024-05-01", to: "2024-05-31", page: String(page) } });
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
    calc.rawCastingDayCalc(sorted).forEach((d, i) => (day[sorted[i]._id] = d));
  }

  const pct = (v) => Math.round(v * 10000) / 100;
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  const bad = [];
  let checked = 0;
  for (const r of rows.filter((x) => x.status === "Working")) {
    const e = mine.find((x) => x.date === r.date && x.operator === r.worker && x.machineOnTime === r.on);
    if (!e) {
      bad.push(`${label(r)}: not found`);
      continue;
    }
    const c = calc.rawCastingRowCalc(e);
    const d = day[e._id];
    const got = [Number(c.idealQty.toFixed(2)), c.effectiveHours, d.unreportedMin, pct(d.productivity), pct(d.productivityLunch), e.okQty, c.okQty];
    const want = [r.ideal, r.eff, r.unrep, r.prod, r.prodLunch, r.ok, r.ok];
    const same = got[0] === want[0] && close(got[1], want[1]) && close(got[2], want[2]) && got[3] === want[3] && got[4] === want[4] && got[5] === want[5] && got[6] === want[6];
    if (!same || e.plannedLocked !== false) bad.push(`${label(r)}: got ${JSON.stringify(got)} plannedLocked ${e.plannedLocked}, paper ${JSON.stringify(want)}`);
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
  if (!proc) throw new Error(`No "${PROCESS_NAME}" process — run seed/seedRawCastingProcess.js first`);
  const rows = PAPER.map(readRow);
  const result = { saved: [], already: [], skipped: [], refused: [] };

  // 1. Workers, vendors and parts.
  const partStd = new Map();
  for (const r of rows) if (r.status === "Working" && !partStd.has(r.itemName)) partStd.set(r.itemName, r.std);
  const ids = { workers: new Map(), vendors: new Map(), parts: new Map() };
  for (const r of rows) {
    if (r.status !== "Working") continue;
    if (!ids.workers.has(r.worker)) ids.workers.set(r.worker, (await ensureWorker(r.worker, proc))._id);
    if (r.vendorName && !ids.vendors.has(r.vendorName)) ids.vendors.set(r.vendorName, (await ensureVendor(r.vendorName, proc))._id);
    if (!ids.parts.has(r.itemName)) ids.parts.set(r.itemName, (await ensurePart(r.itemName, partStd.get(r.itemName), proc))._id);
  }

  // 2. Planned shift lock OFF while saving, put back afterwards whatever happens.
  const was = (await Process.findById(proc._id).select("plannedShiftLocked").lean()).plannedShiftLocked;
  await Process.updateOne({ _id: proc._id }, { $set: { plannedShiftLocked: false } });
  try {
    // 3. The entries, in paper order, through saveRow.
    for (const r of rows) {
      if (r.status !== "Working") {
        result.skipped.push(`${label(r)} — ${r.status}${r.reason ? ` (${r.reason})` : ""}, no worker on the paper`);
        continue;
      }
      const worker = ids.workers.get(r.worker);
      if (await RawCastingEntry.exists({ date: new Date(`${r.date}T00:00:00.000Z`), worker, machineOnTime: r.on })) {
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
        vendor: r.vendorName ? String(ids.vendors.get(r.vendorName)) : "",
        challanNo: r.challanNo,
        totalCycleSec: r.std,
        machineOnTime: r.on,
        machineOffTime: r.off,
        actualQty: r.total,
        rejectBreakdown: r.defects,
        otherActivity: "",
        otherActivityMin: "",
        // = the Inspection Working Hours: the paper has no Planned column.
        plannedOperatorShiftHours: plannedHours(r.shiftMin),
        lunchMin: r.lunch || 0,
        otherMin: r.otherIdle || "",
        otherMinRemark: r.otherIdle ? r.remarks : "",
        remarks: r.remarks,
      };
      const res = await call(rawCastingSheet.saveRow, { body });
      if (ok(res) && res.payload?.data) {
        const doc = res.payload.data;
        const notes = [];
        if (r.okOnPaper !== doc.okQty) notes.push(`paper OK ${r.okOnPaper}, saved OK ${doc.okQty} (= TOTAL ${r.total} − defects)`);
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
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // 4. Read back and check against the paper.
  const check = await verify(proc, rows);

  const list = (title, items) => {
    console.log(`  ${title}: ${items.length}`);
    for (const it of items) console.log(`    - ${it}`);
  };
  console.log("\nMaster data created:");
  list("Workers", created.workers);
  if (created.workersAssigned.length) list("Workers given RAW CASTING", created.workersAssigned);
  list("Vendors", created.vendors);
  if (created.vendorsAssigned.length) list("Vendors given RAW CASTING", created.vendorsAssigned);
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
