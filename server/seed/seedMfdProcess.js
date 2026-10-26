"use strict";
/**
 * seed/seedMfdProcess.js
 * ────────────────────────
 * Sets up the MODULAR FRAME DRILLING process: its Data Entry menu under "Data
 * Entry" (sequence 15, after RAW CASTING), and its Process Master record linked
 * to that page, with the usual eight KPI tiles and the CNC process's own graph
 * list (copied from the CNC record when there is one).
 *
 * Safe to re-run: the menu is upserted by its URL (its _id, and so every
 * role's permission on it, is kept), and an existing process is never
 * overwritten — only a link / tiles / graphs it doesn't have yet are filled in.
 * Its Operator Planned Shift starts locked at 12 h like every process (the
 * Process model's defaults); an Admin can unlock it in Process Master (then
 * each entry's typed hours are used, which reproduces the paper sheet). No
 * machines are made here — they're added to the process in Machine Master.
 *
 * Processes are listed in the order they were created, so its createdAt is
 * set just after RAW CASTING's — or, while RAW CASTING doesn't exist yet, two
 * seconds after BEFORE POWDER COATING's, leaving the second between them for
 * RAW CASTING. Re-run it once RAW CASTING exists and it moves after it if needed.
 *
 *   node seed/seedMfdProcess.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

const PROCESS_NAME = "MODULAR FRAME DRILLING";
const PAGE = "/hqepl/production/modular-frame-drilling-data-entry";
// Keep in step with DATA_ENTRY_MENUS in seed/seedMenus.js.
const MENU = { menuName: PROCESS_NAME, menuUrl: PAGE, sequence: 15, icon: "ClipboardList" };
const STATS = ["totalQty", "okQty", "rejectedQty", "okPct", "oeeLosses", "oeeLunch", "oeeLunchCot", "unutilized"];
// The CNC process's graphs as they stand when no CNC record is found.
const FALLBACK_CHARTS = [
  "machineSummary",
  "runTimeByOperator",
  "oeeTrend",
  "apqTrend",
  "downtimeByMachine",
  "runTimeByMachine",
  "runTimeByMachineBars",
  "unutilizedTrend",
  "unreportedByMachine",
];

// When this process should read as created: just after RAW CASTING, else two
// seconds after BEFORE POWDER COATING. null when neither exists (left as created).
const wantedCreatedAt = async () => {
  const [raw, bpc] = await Promise.all([
    Process.findOne({ processName: "RAW CASTING" }).select("createdAt").lean(),
    Process.findOne({ processName: "BEFORE POWDER COATING" }).select("createdAt").lean(),
  ]);
  if (raw?.createdAt) return { after: "RAW CASTING", at: new Date(raw.createdAt.getTime() + 1000), floor: raw.createdAt };
  if (bpc?.createdAt) return { after: "BEFORE POWDER COATING", at: new Date(bpc.createdAt.getTime() + 2000), floor: bpc.createdAt };
  return null;
};

async function run() {
  await connectDB();

  // The menu, under the Data Entry group (seed/seedMenus.js lists it too).
  const group = await MenuGroupMaster.findOne({ menuGroupName: "Data Entry", portal: "Both" });
  if (!group) throw new Error('No "Data Entry" menu group — run seed/seedMenus.js first');
  const menu = await MenuMaster.findOneAndUpdate(
    { menuUrl: MENU.menuUrl },
    { ...MENU, menuGroup: group._id, isActive: true, isParent: false, parentMenu: null },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const cnc = await Process.findOne({ processName: "CNC" }).select("charts").lean();
  const charts = Array.isArray(cnc?.charts) && cnc.charts.length ? cnc.charts : FALLBACK_CHARTS;

  let existing = await Process.findOne({ processName: PROCESS_NAME });
  const notes = [];
  const created = !existing;
  if (created) {
    existing = await Process.create({ processName: PROCESS_NAME, dataEntryMenu: PAGE, dataEntryMenuLabel: PROCESS_NAME, stats: STATS, charts });
    notes.push("created");
  } else {
    const fill = {};
    if (!existing.dataEntryMenu) Object.assign(fill, { dataEntryMenu: PAGE, dataEntryMenuLabel: PROCESS_NAME });
    if (!Array.isArray(existing.stats)) fill.stats = STATS;
    if (!Array.isArray(existing.charts)) fill.charts = charts;
    if (Object.keys(fill).length) await Process.updateOne({ _id: existing._id }, { $set: fill });
    notes.push(Object.keys(fill).length ? `already existed — filled in ${Object.keys(fill).join(", ")}` : "already existed — left as it is");
  }

  // Its place in the list: set when it is created here (right after its
  // neighbour rather than at "now", so a process added later still lists after
  // it), and on a re-run only when it doesn't already sort after RAW CASTING /
  // BEFORE POWDER COATING. Written straight to the collection, since
  // Mongoose's timestamps never let an update change createdAt.
  const want = await wantedCreatedAt();
  if (want && (created || !(existing.createdAt > want.floor))) {
    await Process.collection.updateOne({ _id: existing._id }, { $set: { createdAt: want.at } });
    notes.push(`listed after ${want.after}`);
  }

  console.log(`Menu "${menu.menuName}" (${menu.menuUrl}) ready. Process "${PROCESS_NAME}" ${notes.join("; ")}.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
