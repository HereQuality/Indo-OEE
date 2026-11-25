const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const { MODULE_LABELS, ACTION_LABELS, ENTITY_TYPES, ACTIONS } = AuditLog;
const { SHEET_LABELS } = require("../utils/entryAudit");

/**
 * controllers/auditTrail.controller.js
 * ─────────────────────────────────────
 * The Audit Trail page (routes/auditTrail.routes.js): one read API over the
 * whole audit log (models/AuditLog.js) — who created / edited / deleted /
 * unlocked / marked what, and when, in every module — with filters, paging
 * and a CSV export.
 *
 *   GET /audit-trail          ?from&to&module&action&actor&q&sheet&entity&machine&date&skip&limit
 *   GET /audit-trail/filters  the module and action lists, and every person seen in the log
 *   GET /audit-trail/export.csv  the same filters, one CSV row per changed field
 *
 * `from` / `to` are Indian Standard Time calendar days (the plant's), applied
 * to each row's createdAt: from 00:00:00 IST to 23:59:59.999 IST. `module`
 * and `action` take comma lists. `q` is matched, case-insensitively, against
 * the row's `search` text (label, who, remark, machine, every change's label /
 * old / new value). The existing GET /oee-review/logs is untouched.
 */

const IST_OFFSET = "+05:30";
const IST_MS = 330 * 60000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 200;
const MAX_EXPORT = 10000;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const list = (raw) => String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);

// The IST day's first / last instant.
const istStart = (day) => new Date(`${day}T00:00:00.000${IST_OFFSET}`);
const istEnd = (day) => new Date(`${day}T23:59:59.999${IST_OFFSET}`);

// The Mongo query for a request's filters, or { error } when one is malformed.
const buildQuery = (q = {}) => {
  const query = {};
  if (q.from || q.to) {
    if ((q.from && !DAY_RE.test(q.from)) || (q.to && !DAY_RE.test(q.to))) return { error: "from / to must be YYYY-MM-DD" };
    query.createdAt = {};
    if (q.from) query.createdAt.$gte = istStart(q.from);
    if (q.to) query.createdAt.$lte = istEnd(q.to);
  }
  const modules = list(q.module);
  if (modules.length) query.entityType = { $in: modules };
  const actions = list(q.action);
  if (actions.length) query.action = { $in: actions };
  if (q.actor) {
    if (!mongoose.isValidObjectId(q.actor)) return { error: "Invalid actor" };
    query["actor.id"] = new mongoose.Types.ObjectId(String(q.actor));
  }
  if (q.entity) {
    if (!mongoose.isValidObjectId(q.entity)) return { error: "Invalid entity" };
    query.entity = new mongoose.Types.ObjectId(String(q.entity));
  }
  if (q.machine) {
    if (!mongoose.isValidObjectId(q.machine)) return { error: "Invalid machine" };
    query.machine = new mongoose.Types.ObjectId(String(q.machine));
  }
  if (q.sheet) query.sheet = String(q.sheet);
  if (q.date) query.date = String(q.date);
  const text = String(q.q || "").trim().toLowerCase();
  if (text) query.search = { $regex: escapeRegex(text) };
  return { query };
};

const paging = (q = {}) => ({
  skip: Math.max(0, parseInt(q.skip, 10) || 0),
  limit: Math.min(MAX_LIMIT, Math.max(1, parseInt(q.limit, 10) || 50)),
});

exports.list = async (req, res) => {
  try {
    const { query, error } = buildQuery(req.query);
    if (error) return res.status(400).json({ isOk: false, message: error });
    const { skip, limit } = paging(req.query);
    const [total, data] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    ]);
    res.status(200).json({ isOk: true, data, total });
  } catch (error) {
    console.error("Error listing the audit trail:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Everyone who has ever done something in the log, by name.
const actorsSeen = async () => {
  const rows = await AuditLog.aggregate([
    { $match: { "actor.id": { $ne: null } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: "$actor.id", name: { $first: "$actor.name" }, role: { $first: "$actor.role" } } },
    { $sort: { name: 1 } },
    { $limit: 500 },
  ]);
  return rows.map((r) => ({ id: r._id, name: r.name || "", role: r.role || "" }));
};

exports.filters = async (req, res) => {
  try {
    res.status(200).json({
      isOk: true,
      data: {
        modules: ENTITY_TYPES.map((key) => ({ key, label: MODULE_LABELS[key] })),
        actions: ACTIONS.map((key) => ({ key, label: ACTION_LABELS[key] })),
        actors: await actorsSeen(),
      },
    });
  } catch (error) {
    console.error("Error listing audit trail filters:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── CSV ──────────────────────────────────────────────────────────────────
const CSV_HEADER = ["Date & time (IST)", "Module", "Action", "Record", "Sheet", "Record date", "Machine", "Field", "From", "To", "Remark", "User", "Role", "Client"];

// dd/mm/yyyy HH:mm:ss in IST.
const istStamp = (d) => {
  const t = new Date(new Date(d).getTime() + IST_MS);
  if (Number.isNaN(t.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`;
};
const cell = (v) => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dmy = (iso) => (iso && DAY_RE.test(iso) ? iso.split("-").reverse().join("/") : iso || "");

// One row per changed field; a log with no changes still gives one row.
const csvRows = (logs) => {
  const rows = [];
  for (const log of logs) {
    const base = [istStamp(log.createdAt), log.module || MODULE_LABELS[log.entityType] || log.entityType || "", ACTION_LABELS[log.action] || log.action || "", log.label || "", log.sheet ? SHEET_LABELS[log.sheet] || log.sheet : "", dmy(log.date)];
    const tail = [log.remark || "", log.actor?.name || "", log.actor?.role || "", log.client || ""];
    const changes = log.changes?.length ? log.changes : [{ label: "", from: null, to: null }];
    for (const c of changes) rows.push([...base, log.machineName || "", c.label || c.field || "", c.from, c.to, ...tail]);
  }
  return rows;
};
const toCsv = (rows) => "﻿" + [CSV_HEADER, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

exports.exportCsv = async (req, res) => {
  try {
    const { query, error } = buildQuery(req.query);
    if (error) return res.status(400).json({ isOk: false, message: error });
    const limit = Math.min(MAX_EXPORT, Math.max(1, parseInt(req.query.limit, 10) || MAX_EXPORT));
    const logs = await AuditLog.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    const name = `audit-trail-${req.query.from || "start"}_${req.query.to || "today"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.status(200).send(toCsv(csvRows(logs)));
  } catch (error) {
    console.error("Error exporting the audit trail:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports._buildQuery = buildQuery;
exports._paging = paging;
exports._csvRows = csvRows;
exports._toCsv = toCsv;
exports._istStamp = istStamp;
exports.CSV_HEADER = CSV_HEADER;
