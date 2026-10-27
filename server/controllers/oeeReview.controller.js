const mongoose = require("mongoose");
const ProductionEntry = require("../models/ProductionEntry");
const VmcEntry = require("../models/VmcEntry");
const SpmEntry = require("../models/SpmEntry");
const RivetEntry = require("../models/RivetEntry");
const PressEntry = require("../models/PressEntry");
const ContactEntry = require("../models/ContactEntry");
const TrobeEntry = require("../models/TrobeEntry");
const SpringEntry = require("../models/SpringEntry");
const PowderCoatingEntry = require("../models/PowderCoatingEntry");
const RubberEntry = require("../models/RubberEntry");
const InjectionEntry = require("../models/InjectionEntry");
const EmbossingEntry = require("../models/EmbossingEntry");
const BeforePowderCoatingEntry = require("../models/BeforePowderCoatingEntry");
const FinalAssemblyEntry = require("../models/FinalAssemblyEntry");
const PrintingEntry = require("../models/PrintingEntry");
const RawCastingEntry = require("../models/RawCastingEntry");
const MfdEntry = require("../models/MfdEntry");
const MfaEntry = require("../models/MfaEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const AuditLog = require("../models/AuditLog");
const { REVIEW_STATUSES } = require("../models/entryCommon");
const { accessOf, actorOf, isAdminUser } = require("../utils/adminAccess");
const { SHEET_LABELS, labelOf, machineNamesOf, keyOf, write, overText, logEntryUnlock, logEntrySave, reviewFor, siblingsOf, reflagSiblings } = require("../utils/entryAudit");
const { settingForMachine, settingForProcess } = require("../utils/plannedShift");
const { spanMinutes, ownerFieldOf } = require("../utils/oeeMetrics");
const { checkNotLocked } = require("./productionSheet.controller");
const { createNotification } = require("../services/notification.service");

/**
 * controllers/oeeReview.controller.js
 * ─────────────────────────────────────
 * Admin review of entries whose Availability, Performance, Quality or OEE
 * figures went above 100% (flagged on save — see utils/entryAudit.js), and the audit log.
 * Everything here except /access is Admin / Super Admin only (route-level
 * requireAdmin). Figures are shown exactly as saved — never capped.
 */
const MODELS = { cnc: ProductionEntry, vmc: VmcEntry, spm: SpmEntry, rivet: RivetEntry, press: PressEntry, contact: ContactEntry, trobe: TrobeEntry, spring: SpringEntry, powder: PowderCoatingEntry, rubber: RubberEntry };
// INJECTION MOULDING is a machine sheet, like SPRING FOR PINS.
MODELS.injection = InjectionEntry;
// EMBOSSING is a machine sheet too.
MODELS.embossing = EmbossingEntry;
// BEFORE POWDER COATING (per operator, like RUBBER — keyOf reads its worker).
MODELS.bpc = BeforePowderCoatingEntry;
// FINAL ASSEMBLY (per worker — keyOf reads its worker).
MODELS.finalAssembly = FinalAssemblyEntry;
// PRINTING is per operator too (worker in the machine's place, its own process).
MODELS.printing = PrintingEntry;
// RAW CASTING is per worker too (AFTER POWDER COATING's template, its own process).
MODELS.rawCasting = RawCastingEntry;
// MODULAR FRAME DRILLING is a machine sheet, like INJECTION MOULDING.
MODELS.mfd = MfdEntry;
// MODULAR FRAME ASSEMBLY is per worker (RAW CASTING's template, its own process).
MODELS.mfa = MfaEntry;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (s) => {
  if (!DATE_RE.test(String(s || ""))) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};
const MAX_ROWS = 500;
// A rejected entry is opened for correction this long — whatever the 2-working-day lock says.
const FIX_WINDOW_MS = 24 * 60 * 60 * 1000;
const FIX_REMARK = "Unlocked for 24 hours so it can be corrected after the OEE review rejection";

// GET /oee-review/access — { canReview } for whoever is logged in, so the
// client knows whether to offer the review page and the shift lock.
exports.getAccess = async (req, res) => {
  try {
    const { isAdmin, role } = await accessOf(req);
    res.status(200).json({ isOk: true, data: { canReview: isAdmin, role } });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /oee-review?status=pending|approved|rejected|all[&sheet=cnc,…][&from&to]
// Flagged entries across every sheet, newest flag first (pending first when
// listing all). Pending is the default.
exports.listReviews = async (req, res) => {
  try {
    const status = String(req.query.status || "pending");
    if (status !== "all" && !REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ isOk: false, message: "Invalid status" });
    }
    const sheets = req.query.sheet ? String(req.query.sheet).split(",").filter((s) => Object.hasOwn(MODELS, s)) : Object.keys(MODELS);
    const query = status === "all" ? { "review.status": { $in: REVIEW_STATUSES } } : { "review.status": status };
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    const lists = await Promise.all(
      sheets.map(async (sheet) =>
        (
          await MODELS[sheet]
            .find(query)
            .select("date machine worker process slot operator itemName drawingNo oee review updatedAt")
            .sort({ "review.flaggedAt": -1 })
            .limit(MAX_ROWS)
            .lean()
        ).map((e) => ({ ...e, sheet })),
      ),
    );
    const rows = lists.flat();
    // An After Powder Coating or RUBBER entry has a worker in its machine's place, and
    // carries its own process (there's no machine to find it through).
    const names = await machineNamesOf(...rows.map(keyOf));
    const machines = await Machine.find({ _id: { $in: rows.map((r) => r.machine).filter(Boolean) } }).select("process").lean();
    const processOf = Object.fromEntries(machines.map((m) => [String(m._id), m.process ? String(m.process) : null]));
    for (const r of rows) if (r.worker && r.process) processOf[String(r.worker)] = String(r.process);
    const processes = await Process.find({ _id: { $in: Object.values(processOf).filter(Boolean) } }).select("processName").lean();
    const processName = Object.fromEntries(processes.map((p) => [String(p._id), p.processName]));
    const order = { pending: 0, rejected: 1, approved: 2 };

    const data = rows
      .map((r) => ({
        _id: String(r._id),
        sheet: r.sheet,
        sheetLabel: SHEET_LABELS[r.sheet],
        date: r.date.toISOString().slice(0, 10),
        machine: String(keyOf(r)),
        machineName: names[String(keyOf(r))] || "—",
        processName: processName[processOf[String(keyOf(r))]] || "",
        slot: r.slot,
        operator: r.operator || "",
        itemName: r.itemName || "",
        drawingNo: r.drawingNo || "",
        oee: r.oee || {},
        review: r.review,
      }))
      .sort(
        (a, b) =>
          order[a.review.status] - order[b.review.status] ||
          new Date(b.review.flaggedAt || 0) - new Date(a.review.flaggedAt || 0),
      )
      .slice(0, MAX_ROWS);
    res.status(200).json({ isOk: true, data });
  } catch (error) {
    console.error("Error listing OEE reviews:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Why a decision can't be applied to the review the reviewer had open — each
// one a 409, so the review dialog reloads the list instead of just failing.
const NO_REVIEW = "This entry doesn't need review any more";
const EDITED = "This entry was edited after you opened it — reload and review the new figures";
const alreadyDecided = (review) => `Already ${review.status} by ${review.decidedBy?.name || "another reviewer"} — reload`;

// PUT /oee-review/:sheet/:id  { decision: "approved"|"rejected", remark, flaggedAt }
// `flaggedAt` is the flag the reviewer was looking at: if the entry has been
// edited (and re-flagged) since, the decision is refused rather than applied
// to figures nobody reviewed. Only a pending review can be decided, so two
// Admins on the same entry can't overwrite each other — the second is told who
// got there first.
exports.decide = async (req, res) => {
  try {
    const { sheet, id } = req.params;
    const Model = Object.hasOwn(MODELS, sheet) ? MODELS[sheet] : null;
    if (!Model || !mongoose.isValidObjectId(id)) return res.status(400).json({ isOk: false, message: "Invalid entry" });
    const decision = String(req.body.decision || "");
    if (!["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ isOk: false, message: "Decision must be approved or rejected" });
    }
    const remark = String(req.body.remark ?? "").trim();
    if (decision === "rejected" && !remark) {
      return res.status(400).json({ isOk: false, message: "A remark is required to reject an entry" });
    }
    if (remark.length > 500) return res.status(400).json({ isOk: false, message: "Remark must be 500 characters or fewer" });

    const entry = await Model.findById(id).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    if (!entry.review) return res.status(409).json({ isOk: false, message: NO_REVIEW });
    if (req.body.flaggedAt && new Date(req.body.flaggedAt).getTime() !== new Date(entry.review.flaggedAt).getTime()) {
      return res.status(409).json({ isOk: false, message: EDITED });
    }
    if (entry.review.status !== "pending") return res.status(409).json({ isOk: false, message: alreadyDecided(entry.review) });

    const actor = await actorOf(req);
    const decidedAt = new Date();
    const updated = await Model.findOneAndUpdate(
      { _id: id, "review.flaggedAt": entry.review.flaggedAt, "review.status": "pending" },
      {
        $set: {
          "review.status": decision,
          "review.decidedBy": actor,
          "review.decidedAt": decidedAt,
          "review.remark": remark,
          // A rejection hands the entry back to be fixed, so it opens for 24 hours
          // even if the 2-working-day lock has closed it (see reopen below for later).
          ...(decision === "rejected" ? { unlockedUntil: new Date(decidedAt.getTime() + FIX_WINDOW_MS) } : {}),
        },
      },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      // Something changed between the read above and this write: say what.
      const now = await Model.findById(id).select("review").lean();
      const sameFlag = now?.review && new Date(now.review.flaggedAt).getTime() === new Date(entry.review.flaggedAt).getTime();
      const message = !now?.review ? NO_REVIEW : sameFlag && now.review.status !== "pending" ? alreadyDecided(now.review) : EDITED;
      return res.status(409).json({ isOk: false, message });
    }

    const names = await machineNamesOf(keyOf(entry));
    const label = labelOf(sheet, entry, names[String(keyOf(entry))] || "");
    await write({
      entityType: "entry",
      sheet,
      entity: entry._id,
      machine: keyOf(entry),
      machineName: names[String(keyOf(entry))] || "",
      date: entry.date.toISOString().slice(0, 10),
      label,
      action: decision,
      metrics: entry.oee || {},
      flagged: entry.review.flagged,
      remark,
      actor,
    });

    if (decision === "rejected") await logEntryUnlock({ sheet, req, entry: updated, remark: FIX_REMARK });

    // Tell whoever last saved the entry (the save that put it over 100%), unless
    // it's the reviewer. `decision` in the reference is what sends them to the
    // data entry sheet to fix it, rather than to the review desk.
    if (entry.updatedBy && String(entry.updatedBy) !== String(req.user._id) && entry.updatedByModel) {
      createNotification(
        entry.updatedByModel,
        entry.updatedBy,
        `OEE review: ${decision === "approved" ? "approved" : "rejected"}`,
        `${label} (${overText(entry.review.flagged)})${remark ? ` — ${remark}` : ""}${decision === "rejected" ? " · Open it to correct it — unlocked for 24 hours" : ""}`,
        "oeeReview",
        { sheet, entry: String(entry._id), date: entry.date.toISOString().slice(0, 10), decision },
      ).catch((error) => console.error("Error notifying about an OEE review decision:", error));
    }

    res.status(200).json({ isOk: true, data: { _id: String(updated._id), sheet, review: updated.review }, message: decision === "approved" ? "Entry approved" : "Entry rejected" });
  } catch (error) {
    console.error("Error deciding an OEE review:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /oee-review/:sheet/:id/reopen — what opening a "rejected" notification does:
// the entry is unlocked for another 24 hours from now, so someone who comes back
// after the first window (or after the 2-working-day lock closed it again) can
// still correct it. Only while the entry is still rejected, and only for who last
// saved it (the person the notification went to) or a Full access user.
exports.reopen = async (req, res) => {
  try {
    const { sheet, id } = req.params;
    const Model = Object.hasOwn(MODELS, sheet) ? MODELS[sheet] : null;
    if (!Model || !mongoose.isValidObjectId(id)) return res.status(400).json({ isOk: false, message: "Invalid entry" });
    const entry = await Model.findById(id).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });
    if (entry.review?.status !== "rejected") {
      return res.status(409).json({ isOk: false, message: "This entry isn't waiting for a correction" });
    }
    const mine = entry.updatedBy && String(entry.updatedBy) === String(req.user._id);
    if (!mine && !(await isAdminUser(req))) {
      return res.status(403).json({ isOk: false, message: "Only the person who saved this entry can reopen it" });
    }
    const unlockedUntil = new Date(Date.now() + FIX_WINDOW_MS);
    const updated = await Model.findOneAndUpdate({ _id: id, "review.status": "rejected" }, { $set: { unlockedUntil } }, { new: true }).lean();
    if (!updated) return res.status(409).json({ isOk: false, message: "This entry isn't waiting for a correction" });
    await logEntryUnlock({ sheet, req, entry: updated, remark: `${FIX_REMARK} (reopened from the notification)` });
    res.status(200).json({ isOk: true, data: { _id: String(updated._id), unlockedUntil }, message: "Unlocked for 24 hours" });
  } catch (error) {
    console.error("Error reopening a rejected entry:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// PUT /oee-review/:sheet/:id/shift — Full access only. A change to a process's
// Operator Planned Shift only reaches entries made after it; this is the
// separate, deliberate way to bring one earlier entry (saved on the old shift,
// say by mistake) onto the process's CURRENT shift. The hours are never typed
// here — they are the process's own setting — and the entry's Availability /
// Performance / Quality are worked out again, so it may be flagged for review
// (or cleared) by the new figures. An entry past the 2-working-day lock must be
// unlocked first, like any edit. Logged as an ordinary update of the entry.
exports.applyShift = async (req, res) => {
  try {
    const { sheet, id } = req.params;
    const Model = Object.hasOwn(MODELS, sheet) ? MODELS[sheet] : null;
    if (!Model || !mongoose.isValidObjectId(id)) return res.status(400).json({ isOk: false, message: "Invalid entry" });
    const entry = await Model.findById(id).lean();
    if (!entry) return res.status(404).json({ isOk: false, message: "Entry not found" });

    const typed = entry.plannedOperatorShiftHours;
    if (typed === undefined || typed === null || !Number.isFinite(Number(typed))) {
      return res.status(409).json({ isOk: false, message: "This entry has no Planned Operator Shift to change" });
    }
    const setting = entry.machine ? await settingForMachine(entry.machine) : await settingForProcess(entry.process);
    if (!setting) {
      return res.status(409).json({ isOk: false, message: "This process has no fixed shift — its hours are typed on each entry, so edit the entry itself" });
    }
    if (Math.abs(Number(typed) - setting.hours) < 0.0005 && entry.plannedLocked !== false) {
      return res.status(409).json({ isOk: false, message: `Already on the current shift (${setting.hours} hr)` });
    }

    const lockMessage = await checkNotLocked(new Date(entry.createdAt).toISOString().slice(0, 10), req.user, entry.unlockedUntil);
    if (lockMessage) return res.status(403).json({ isOk: false, message: lockMessage });

    // The same rule the entry form enforces: the shift can't be shorter than the run.
    const runMin = spanMinutes(entry.machineOnTime, entry.machineOffTime);
    if (runMin !== null && setting.hours * 60 < runMin - 1e-9) {
      const hm = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
      return res.status(400).json({
        isOk: false,
        message: `The current shift (${hm(setting.hours)}) is shorter than this entry's Machine Shift (${hm(runMin / 60)}) — edit the entry's times first`,
      });
    }

    const set = { plannedOperatorShiftHours: setting.hours, plannedLocked: true };
    const owner = ownerFieldOf(sheet);
    const review = reviewFor(sheet, entry, set, {}, await siblingsOf(Model, sheet, { date: entry.date, key: entry[owner] }));
    const unset = review.unset;
    const updated = await Model.findOneAndUpdate(
      { _id: id, plannedOperatorShiftHours: typed },
      {
        $set: { ...set, ...review.set, updatedBy: req.user._id, updatedByModel: req.user.constructor.modelName },
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) return res.status(409).json({ isOk: false, message: "This entry was changed while you were looking at it — reload and try again" });

    await logEntrySave({ sheet, req, before: entry, after: updated, fields: ["plannedOperatorShiftHours"], review });
    // A day's OEE figures are shared — the entries it shares them with are worked out again.
    await reflagSiblings({ sheet, Model, req, before: entry, date: entry.date, key: entry[owner], id: entry._id });
    res.status(200).json({
      isOk: true,
      data: { _id: String(updated._id), plannedOperatorShiftHours: updated.plannedOperatorShiftHours, oee: updated.oee, review: updated.review || null },
      message: `Planned Operator Shift changed from ${Number(typed)} hr to ${setting.hours} hr`,
    });
  } catch (error) {
    console.error("Error applying the current shift to an entry:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// GET /oee-review/logs?[entity=<id>][&entityType=entry|process][&sheet=][&action=][&skip&limit]
// The audit log, newest first — one entry's or process's whole history when
// `entity` is given.
exports.listLogs = async (req, res) => {
  try {
    const query = {};
    if (req.query.entity) {
      if (!mongoose.isValidObjectId(req.query.entity)) return res.status(400).json({ isOk: false, message: "Invalid entity" });
      query.entity = req.query.entity;
    }
    if (req.query.entityType) query.entityType = String(req.query.entityType);
    if (req.query.sheet) query.sheet = String(req.query.sheet);
    if (req.query.action) query.action = { $in: String(req.query.action).split(",") };
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const [total, data] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    ]);
    res.status(200).json({ isOk: true, data, total });
  } catch (error) {
    console.error("Error listing audit logs:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
