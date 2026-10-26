"use strict";
/**
 * seed/setDashboardStats.js
 * ───────────────────────────
 * Makes every process's dashboard the same as CNC's:
 *   · KPI tiles (`stats`) — the standard eight, two rows of four, in this order:
 *     Total QTY, OK QTY, Rejected QTY, % OK Quantity, the three OEE figures, then
 *     Unutilized Machine Time (same list as DEFAULT_STATS in
 *     client/src/utils/processDashboard.js);
 *   · graphs (`charts`) — exactly the CNC process's own list, in its order.
 * Nothing else on a process is touched.
 *
 *   node seed/setDashboardStats.js           # dry run: shows what would change
 *   node seed/setDashboardStats.js --write   # saves it
 *
 * Runs against whichever database MONGO_URI points at (server/.env, or the
 * MONGO_URI variable if one is set when the command is run).
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Process = require("../models/Process");

const STATS = ["totalQty", "okQty", "rejectedQty", "okPct", "oeeLosses", "oeeLunch", "oeeLunchCot", "unutilized"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function run() {
  const write = process.argv.includes("--write");
  await connectDB();
  console.log(write ? "Updating…" : "Dry run — nothing is written. Add --write to save.", "|", mongoose.connection.host);
  const all = await Process.find().select("processName stats charts").lean();
  const cnc = all.find((p) => /^cnc$/i.test(String(p.processName).trim()));
  if (!cnc || !Array.isArray(cnc.charts)) throw new Error("The CNC process has no graph list to copy.");
  console.log("CNC graphs:", cnc.charts.join(", "));
  for (const p of all) {
    const sameStats = same(p.stats, STATS);
    const sameCharts = same(p.charts, cnc.charts);
    console.log(String(p.processName).padEnd(24), sameStats && sameCharts ? "already standard" : `tiles ${sameStats ? "ok" : "→ 8"} · graphs ${sameCharts ? "ok" : `${p.charts ? p.charts.length : "default"} → ${cnc.charts.length}`}`);
    if (write && !(sameStats && sameCharts)) await Process.updateOne({ _id: p._id }, { $set: { stats: STATS, charts: cnc.charts } });
  }
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
