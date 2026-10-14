const mongoose = require("mongoose");
const ProductionEntry = require("../models/ProductionEntry");
const VmcEntry = require("../models/VmcEntry");
const SpmEntry = require("../models/SpmEntry");
const RivetEntry = require("../models/RivetEntry");
const PressEntry = require("../models/PressEntry");
const ContactEntry = require("../models/ContactEntry");
const Machine = require("../models/Machine");
const Process = require("../models/Process");
const AuditLog = require("../models/AuditLog");
const { REVIEW_STATUSES } = require("../models/entryCommon");
const { accessOf, actorOf } = require("../utils/adminAccess");
const { SHEET_LABELS, labelOf, machineNamesOf, write, overText } = require("../utils/entryAudit");
const { createNotification } = require("../services/notification.service");

/**
 * controllers/oeeReview.controller.js
 * ─────────────────────────────────────
 * Admin review of entries whose Availability, Performance or Quality went
 * above 100% (flagged on save — see utils/entryAudit.js), and the audit log.
 * Everything here except /access is Admin / Super Admin only (route-level
 * requireAdmin). Figures are shown exactly as saved — never capped.
 */
const MODELS = { cnc: ProductionEntry, vmc: VmcEntry, spm: SpmEntry, rivet: RivetEntry, press: PressEntry, contact: ContactEntry };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (s) => {
  if (!DATE_RE.test(String(s || ""))) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
};
const MAX_ROWS = 500;

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
    const sheets = req.query.sheet ? String(req.query.sheet).split(",").filter((s) => MODELS[s]) : Object.keys(MODELS);
    const query = status === "all" ? { "review.status": { $in: REVIEW_STATUSES } } : { "review.status": status };
    const from = parseDay(req.query.from);
    const to = parseDay(req.query.to);
    if (from || to) query.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    const lists = await Promise.all(
      sheets.map(async (sheet) =>
        (
          await MODELS[sheet]
            .find(query)
            .select("date machine slot operator itemName drawingNo oee review updatedAt")
            .sort({ "review.flaggedAt": -1 })
            .limit(MAX_ROWS)
            .lean()
        ).map((e) => ({ ...e, sheet })),
      ),
    );
    const rows = lists.flat();
    const names = await machineNamesOf(...rows.map((r) => r.machine));
    const machines = await Machine.find({ _id: { $in: rows.map((r) => r.machine) } }).select("process").lean();
    const processOf = Object.fromEntries(machines.map((m) => [String(m._id), m.process ? String(m.process) : null]));
    const processes = await Process.find({ _id: { $in: Object.values(processOf).filter(Boolean) } }).select("processName").lean();
    const processName = Object.fromEntries(processes.map((p) => [String(p._id), p.processName]));
    const order = { pending: 0, rejected: 1, approved: 2 };

    const data = rows
      .map((r) => ({
        _id: String(r._id),
        sheet: r.sheet,
        sheetLabel: SHEET_LABELS[r.sheet],
        date: r.date.toISOString().slice(0, 10),
        machine: String(r.machine),
        machineName: names[String(r.machine)] || "—",
        processName: processName[processOf[String(r.machine)]] || "",
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

// PUT /oee-review/:sheet/:id  { decision: "approved"|"rejected", remark, flaggedAt }
// `flaggedAt` is the flag the reviewer was looking at: if the entry has been
// edited (and re-flagged) since, the decision is refused rather than applied
// to figures nobody reviewed.
exports.decide = async (req, res) => {
  try {
    const { sheet, id } = req.params;
    const Model = MODELS[sheet];
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
    if (!entry.review) return res.status(400).json({ isOk: false, message: "This entry doesn't need review any more" });
    if (req.body.flaggedAt && new Date(req.body.flaggedAt).getTime() !== new Date(entry.review.flaggedAt).getTime()) {
      return res.status(409).json({ isOk: false, message: "This entry was edited after you opened it — reload and review the new figures" });
    }

    const actor = await actorOf(req);
    const decidedAt = new Date();
    const updated = await Model.findOneAndUpdate(
      { _id: id, "review.flaggedAt": entry.review.flaggedAt },
      { $set: { "review.status": decision, "review.decidedBy": actor, "review.decidedAt": decidedAt, "review.remark": remark } },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      return res.status(409).json({ isOk: false, message: "This entry was edited after you opened it — reload and review the new figures" });
    }

    const names = await machineNamesOf(entry.machine);
    const label = labelOf(sheet, entry, names[String(entry.machine)] || "");
    await write({
      entityType: "entry",
      sheet,
      entity: entry._id,
      machine: entry.machine,
      machineName: names[String(entry.machine)] || "",
      date: entry.date.toISOString().slice(0, 10),
      label,
      action: decision,
      metrics: entry.oee || {},
      flagged: entry.review.flagged,
      remark,
      actor,
    });

    // Tell whoever last saved the entry, unless it's the reviewer.
    if (entry.updatedBy && String(entry.updatedBy) !== String(req.user._id) && entry.updatedByModel) {
      createNotification(
        entry.updatedByModel,
        entry.updatedBy,
        `OEE review: ${decision === "approved" ? "approved" : "rejected"}`,
        `${label} (${overText(entry.review.flagged)})${remark ? ` — ${remark}` : ""}`,
        "oeeReview",
        { sheet, entry: String(entry._id) },
      ).catch((error) => console.error("Error notifying about an OEE review decision:", error));
    }

    res.status(200).json({ isOk: true, data: { _id: String(updated._id), sheet, review: updated.review }, message: decision === "approved" ? "Entry approved" : "Entry rejected" });
  } catch (error) {
    console.error("Error deciding an OEE review:", error);
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
