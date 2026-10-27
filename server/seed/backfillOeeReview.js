"use strict";
/**
 * seed/backfillOeeReview.js
 * ───────────────────────────
 * Re-evaluates every entry of every sheet under the Admin-review rule that now
 * also holds an entry when one of its OEE figures is above 100% (OEE
 * considering losses / … but lunch / … but lunch & setup time; BEFORE POWDER
 * COATING's two; the worker sheets' two Productivity figures) — on top of
 * Availability / Performance / Quality. The figures are the day's, so each
 * entry is worked out with the other entries of its machine's (worker's) date
 * (reviewFor with its siblings — exactly what a save does).
 *
 * For each entry it sets or clears `review` and stores the OEE figures with
 * `oee`, the way saveRow would: an entry already approved / rejected stays
 * decided while its over-100% figures are unchanged; a changed set sends it
 * back to pending; back under 100% everywhere clears the flag. No notification
 * is sent. Entries are never touched otherwise (updatedAt / updatedBy stay).
 *
 *   node seed/backfillOeeReview.js           # dry run: counts per sheet, writes nothing
 *   node seed/backfillOeeReview.js --write   # applies it, one audit-log row per flag / clear
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const AuditLog = require("../models/AuditLog");
const { reviewFor, labelOf, machineNamesOf, keyOf, overText } = require("../utils/entryAudit");
const { ownerFieldOf } = require("../utils/oeeMetrics");

const SHEETS = [
  ["cnc", require("../models/ProductionEntry")],
  ["vmc", require("../models/VmcEntry")],
  ["spm", require("../models/SpmEntry")],
  ["rivet", require("../models/RivetEntry")],
  ["press", require("../models/PressEntry")],
  ["contact", require("../models/ContactEntry")],
  ["trobe", require("../models/TrobeEntry")],
  ["spring", require("../models/SpringEntry")],
  ["powder", require("../models/PowderCoatingEntry")],
  ["rubber", require("../models/RubberEntry")],
  ["injection", require("../models/InjectionEntry")],
  ["embossing", require("../models/EmbossingEntry")],
  ["bpc", require("../models/BeforePowderCoatingEntry")],
  ["finalAssembly", require("../models/FinalAssemblyEntry")],
  ["printing", require("../models/PrintingEntry")],
  ["rawCasting", require("../models/RawCastingEntry")],
  ["mfd", require("../models/MfdEntry")],
  ["mfa", require("../models/MfaEntry")],
];

const round = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
const sameOee = (a = {}, b = {}) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].every((k) => round(a?.[k]) === round(b?.[k]));
const ACTOR = { name: "OEE review backfill", role: "System" };

async function run() {
  const write = process.argv.includes("--write");
  // Local database only, unless the person running it says otherwise.
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.MONGO_URI || "") && !process.argv.includes("--allow-remote")) {
    throw new Error("MONGO_URI is not a local database — add --allow-remote to run against it anyway");
  }
  await connectDB();
  console.log(write ? "Applying the OEE review rule…" : "Dry run — nothing is written. Add --write to apply.");
  console.log("sheet".padEnd(14), "entries".padStart(8), "newly flagged".padStart(14), "reopened".padStart(9), "extended".padStart(9), "cleared".padStart(8), "figures only".padStart(13));

  const total = { entries: 0, flagged: 0, reopened: 0, extended: 0, cleared: 0, figures: 0 };
  for (const [sheet, Model] of SHEETS) {
    const owner = ownerFieldOf(sheet);
    const entries = await Model.find({}).lean();
    const groups = new Map();
    for (const e of entries) {
      const k = `${String(e[owner])}|${new Date(e.date).toISOString().slice(0, 10)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }

    const count = { flagged: 0, reopened: 0, extended: 0, cleared: 0, figures: 0 };
    for (const day of groups.values()) {
      for (const entry of day) {
        const review = reviewFor(sheet, entry, {}, {}, day);
        if (!review.transition && sameOee(entry.oee, review.oee)) continue;
        if (review.transition === "flagged") count[!entry.review ? "flagged" : entry.review.status === "pending" ? "extended" : "reopened"] += 1;
        else if (review.transition === "cleared") count.cleared += 1;
        else count.figures += 1;
        if (!write) continue;

        await Model.updateOne({ _id: entry._id }, { $set: review.set, ...(Object.keys(review.unset).length ? { $unset: review.unset } : {}) }, { timestamps: false });
        if (!review.transition) continue;
        const names = await machineNamesOf(keyOf(entry));
        const machineName = names[String(keyOf(entry))] || "";
        await AuditLog.create({
          entityType: "entry",
          sheet,
          entity: entry._id,
          machine: keyOf(entry),
          machineName,
          date: new Date(entry.date).toISOString().slice(0, 10),
          label: labelOf(sheet, entry, machineName),
          action: review.transition,
          metrics: review.oee,
          ...(review.transition === "flagged"
            ? { flagged: review.over, remark: `Over 100% (OEE review backfill): ${overText(review.over)}` }
            : { remark: "Back at or under 100% when worked out again (OEE review backfill)" }),
          actor: ACTOR,
        });
      }
    }
    total.entries += entries.length;
    for (const k of Object.keys(count)) total[k] += count[k];
    console.log(sheet.padEnd(14), String(entries.length).padStart(8), String(count.flagged).padStart(14), String(count.reopened).padStart(9), String(count.extended).padStart(9), String(count.cleared).padStart(8), String(count.figures).padStart(13));
  }
  console.log("TOTAL".padEnd(14), String(total.entries).padStart(8), String(total.flagged).padStart(14), String(total.reopened).padStart(9), String(total.extended).padStart(9), String(total.cleared).padStart(8), String(total.figures).padStart(13));
  console.log("newly flagged = had no review, now held · reopened = was approved / rejected, its over-100% figures changed (back to pending) · extended = already pending, now with more figures over 100% · cleared = review no longer needed · figures only = OEE figures stored, review unchanged");
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
