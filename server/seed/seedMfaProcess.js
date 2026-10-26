"use strict";
/**
 * seed/seedMfaProcess.js
 * ────────────────────────
 * Sets up the MODULAR FRAME ASSEMBLY process (sheet key "mfa" — a worker sheet
 * on RAW CASTING's template, its own process, page and collection): its Data
 * Entry menu under "Data Entry" (sequence 16), and its Process Master record
 * linked to that page, with the usual eight KPI tiles and the CNC process's
 * own graph list (copied from the CNC record when there is one). It is listed
 * right after MODULAR FRAME DRILLING (or RAW CASTING while that one doesn't
 * exist): processes have no sequence field and sort by createdAt, so a new
 * record's createdAt is set half a second after that one's.
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
 *   node seed/seedMfaProcess.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

const PROCESS_NAME = "MODULAR FRAME ASSEMBLY";
const PAGE = "/hqepl/production/modular-frame-assembly-data-entry";
const MENU = { menuName: PROCESS_NAME, menuUrl: PAGE, sequence: 16, icon: "ClipboardList" };
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
// The process it is listed after — the first of these that exists.
const AFTER_ANY = ["MODULAR FRAME DRILLING", "RAW CASTING"];
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

  // Listed right after MODULAR FRAME DRILLING (or RAW CASTING). createdAt is
  // immutable to Mongoose, so it's set on the collection itself — when the
  // record is new, or while it still sorts before (or with) that process; a
  // re-run leaves it alone.
  let after = null;
  let afterName = AFTER_ANY.join(" or ");
  for (const name of AFTER_ANY) {
    after = await Process.findOne({ processName: name }).select("createdAt").lean();
    if (after) {
      afterName = name;
      break;
    }
  }
  let order = `no ${afterName} process to list it after`;
  if (after?.createdAt) {
    const own = (await Process.findById(doc._id).select("createdAt").lean())?.createdAt;
    if (!existing || !own || own <= after.createdAt) {
      // Half a second on, so it still sorts before a process put one second after that one (EMBOSSING).
      await Process.collection.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(after.createdAt.getTime() + 500) } });
      order = `listed after ${afterName}`;
    } else {
      order = `already listed after ${afterName}`;
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
