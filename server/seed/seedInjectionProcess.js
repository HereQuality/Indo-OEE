"use strict";
/**
 * seed/seedInjectionProcess.js
 * ──────────────────────────────
 * Sets up the INJECTION MOULDING process: its Data Entry menu under "Data
 * Entry", and its Process Master record linked to that page, with the usual
 * eight KPI tiles and the CNC process's own graph list (copied from the CNC
 * record when there is one).
 *
 * Safe to re-run: the menu is upserted by its URL (its _id, and so every
 * role's permission on it, is kept), and an existing process is never
 * overwritten — only a link / tiles / graphs it doesn't have yet are filled in.
 * Its Operator Planned Shift starts locked at 12 h like every process; an
 * Admin can unlock it in Process Master (then each entry's typed hours are
 * used, which reproduces the paper sheet exactly). No machines are made here —
 * they're added to the process in Machine Master.
 *
 *   node seed/seedInjectionProcess.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

const PROCESS_NAME = "INJECTION MOULDING";
const PAGE = "/hqepl/production/injection-moulding-data-entry";
// Keep in step with DATA_ENTRY_MENUS in seed/seedMenus.js.
const MENU = { menuName: PROCESS_NAME, menuUrl: PAGE, sequence: 12, icon: "ClipboardList" };
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

  const existing = await Process.findOne({ processName: PROCESS_NAME });
  let action;
  if (!existing) {
    await Process.create({ processName: PROCESS_NAME, dataEntryMenu: PAGE, dataEntryMenuLabel: PROCESS_NAME, stats: STATS, charts });
    action = "created";
  } else {
    const fill = {};
    if (!existing.dataEntryMenu) Object.assign(fill, { dataEntryMenu: PAGE, dataEntryMenuLabel: PROCESS_NAME });
    if (!Array.isArray(existing.stats)) fill.stats = STATS;
    if (!Array.isArray(existing.charts)) fill.charts = charts;
    if (Object.keys(fill).length) await Process.updateOne({ _id: existing._id }, { $set: fill });
    action = Object.keys(fill).length ? `already existed — filled in ${Object.keys(fill).join(", ")}` : "already existed — left as it is";
  }

  console.log(`Menu "${menu.menuName}" (${menu.menuUrl}) ready. Process "${PROCESS_NAME}" ${action}.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
