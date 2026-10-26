"use strict";
/**
 * seed/seedRawCastingProcess.js
 * ───────────────────────────────
 * Sets up the RAW CASTING process (an inspection sheet on AFTER POWDER
 * COATING's template, its own process, page and collection): its Data Entry
 * menu under "Data Entry" (sequence 14), and its Process Master record linked
 * to that page, with the usual eight KPI tiles and the CNC process's own graph
 * list (copied from the CNC record when there is one). It is listed right
 * after BEFORE POWDER COATING: processes have no sequence field and sort by
 * createdAt, so a new record's createdAt is set one second after that one's.
 *
 * Safe to re-run: the menu is upserted by its URL (its _id, and so every
 * role's permission on it, is kept), and an existing process is never
 * overwritten — only a link / tiles / graphs / shift setting it doesn't have
 * yet are filled in. Its Operator Planned Shift starts locked at 12 h like
 * every process; an Admin can unlock it in Process Master (then each entry's
 * typed hours are used, which reproduces the paper sheet exactly).
 *
 * Writes only to a local database: it stops unless MONGO_URI points at
 * 127.0.0.1 / localhost.
 *
 *   node seed/seedRawCastingProcess.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

const PROCESS_NAME = "RAW CASTING";
const PAGE = "/hqepl/production/raw-casting-data-entry";
const MENU = { menuName: PROCESS_NAME, menuUrl: PAGE, sequence: 14, icon: "ClipboardList" };
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
// The process it is listed after.
const AFTER = "BEFORE POWDER COATING";
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
  let doc = existing;
  if (!existing) {
    doc = await Process.create({
      processName: PROCESS_NAME,
      dataEntryMenu: PAGE,
      dataEntryMenuLabel: PROCESS_NAME,
      stats: STATS,
      charts,
      plannedShiftLocked: true,
      plannedShiftHours: LOCKED_HOURS,
    });
    action = "created";
  } else {
    const fill = {};
    if (!existing.dataEntryMenu) Object.assign(fill, { dataEntryMenu: PAGE, dataEntryMenuLabel: PROCESS_NAME });
    if (!Array.isArray(existing.stats)) fill.stats = STATS;
    if (!Array.isArray(existing.charts)) fill.charts = charts;
    if (typeof existing.plannedShiftLocked !== "boolean") Object.assign(fill, { plannedShiftLocked: true, plannedShiftHours: LOCKED_HOURS });
    if (Object.keys(fill).length) await Process.updateOne({ _id: existing._id }, { $set: fill });
    action = Object.keys(fill).length ? `already existed — filled in ${Object.keys(fill).join(", ")}` : "already existed — left as it is";
  }

  // Listed right after BEFORE POWDER COATING. createdAt is immutable to
  // Mongoose, so it's set on the collection itself — when the record is new,
  // or while it still sorts before (or with) that process; a re-run leaves it alone.
  const after = await Process.findOne({ processName: AFTER }).select("createdAt").lean();
  let order = `no ${AFTER} process to list it after`;
  if (after?.createdAt) {
    const own = (await Process.findById(doc._id).select("createdAt").lean())?.createdAt;
    if (!existing || !own || own <= after.createdAt) {
      await Process.collection.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(after.createdAt.getTime() + 1000) } });
      order = `listed after ${AFTER}`;
    } else {
      order = `already listed after ${AFTER}`;
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
