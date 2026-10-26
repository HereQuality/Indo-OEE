"use strict";
/**
 * seed/seedFinalAssemblyProcess.js
 * ──────────────────────────────────
 * Sets up the FINAL ASSEMBLY process (a worker sheet on AFTER POWDER COATING's
 * template, sheet key "finalAssembly"): its Data Entry menu under "Data Entry"
 * (sequence 18, after EMBOSSING), and its
 * Process Master record linked to that page, with the usual eight KPI tiles and
 * the CNC process's own graph list (copied from the CNC record when there is
 * one). Processes have no sequence field and are listed by createdAt, so a new
 * record's createdAt is set one second after the newest process already there —
 * FINAL ASSEMBLY is listed last.
 *
 * Safe to re-run: the menu is upserted by its URL (its _id, and so every
 * role's permission on it, is kept), and an existing process is never
 * overwritten — only a link / tiles / graphs / shift setting it doesn't have
 * yet are filled in. It is kept LAST in the list: a re-run after another
 * process was added moves FINAL ASSEMBLY back after it. Its Operator
 * Planned Shift starts locked at 12 h like every process; an Admin can unlock
 * it in Process Master (then each entry's typed hours are used, which
 * reproduces the paper sheet exactly). It has no machines: its entries are
 * made per worker (Operator Master).
 *
 * Writes only to a local database: it stops unless MONGO_URI points at
 * 127.0.0.1 / localhost.
 *
 *   node seed/seedFinalAssemblyProcess.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

const PROCESS_NAME = "FINAL ASSEMBLY";
const PAGE = "/hqepl/production/final-assembly-data-entry";
// Keep in step with DATA_ENTRY_MENUS in seed/seedMenus.js.
const MENU = { menuName: PROCESS_NAME, menuUrl: PAGE, sequence: 18, icon: "ClipboardList" };
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
const LOCKED_HOURS = 12;

// MONGO_URI's host, without ever printing the URI itself.
const mongoHost = (uri) =>
  String(uri || "")
    .replace(/^mongodb(\+srv)?:\/\//, "")
    .split("/")[0]
    .split("@")
    .pop()
    .split(",")[0]
    .split(":")[0];

async function run() {
  const uri = process.env.MONGO_URI || "";
  if (/^mongodb\+srv:/.test(uri) || !["127.0.0.1", "localhost"].includes(mongoHost(uri))) {
    throw new Error("MONGO_URI is not a local database (127.0.0.1 / localhost) — nothing was written");
  }
  await connectDB();
  if (!["127.0.0.1", "localhost"].includes(mongoose.connection.host)) {
    throw new Error(`Connected to "${mongoose.connection.host}", not a local database — nothing was written`);
  }

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
  let order = "its place in the list left alone";
  if (!existing) {
    // The newest process already there — FINAL ASSEMBLY is listed after it.
    const newest = await Process.findOne().sort({ createdAt: -1 }).select("processName createdAt").lean();
    const doc = await Process.create({
      processName: PROCESS_NAME,
      dataEntryMenu: PAGE,
      dataEntryMenuLabel: PROCESS_NAME,
      stats: STATS,
      charts,
      plannedShiftLocked: true,
      plannedShiftHours: LOCKED_HOURS,
    });
    action = "created";
    if (newest?.createdAt) {
      const own = (await Process.findById(doc._id).select("createdAt").lean())?.createdAt;
      if (!own || own <= newest.createdAt) {
        // createdAt is immutable to Mongoose, so it's set on the collection itself.
        await Process.collection.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(newest.createdAt.getTime() + 1000) } });
      }
      order = `listed after ${newest.processName}`;
    }
  } else {
    const fill = {};
    if (!existing.dataEntryMenu) Object.assign(fill, { dataEntryMenu: PAGE, dataEntryMenuLabel: PROCESS_NAME });
    if (!Array.isArray(existing.stats)) fill.stats = STATS;
    if (!Array.isArray(existing.charts)) fill.charts = charts;
    if (typeof existing.plannedShiftLocked !== "boolean") Object.assign(fill, { plannedShiftLocked: true, plannedShiftHours: LOCKED_HOURS });
    if (Object.keys(fill).length) await Process.updateOne({ _id: existing._id }, { $set: fill });
    action = Object.keys(fill).length ? `already existed — filled in ${Object.keys(fill).join(", ")}` : "already existed — left as it is";
    // Kept last: a process added after it (another helper's seed) is passed again.
    const newest = await Process.findOne({ _id: { $ne: existing._id } }).sort({ createdAt: -1 }).select("processName createdAt").lean();
    if (newest?.createdAt && existing.createdAt <= newest.createdAt) {
      await Process.collection.updateOne({ _id: existing._id }, { $set: { createdAt: new Date(newest.createdAt.getTime() + 1000) } });
      order = `moved back to last, after ${newest.processName}`;
    } else {
      order = "already listed last";
    }
  }

  console.log(`Menu "${menu.menuName}" (${menu.menuUrl}) ready. Process "${PROCESS_NAME}" ${action}; ${order}.`);
  await mongoose.connection.close();
  process.exit(0);
}

run().catch(async (err) => {
  console.error(err.message || err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
