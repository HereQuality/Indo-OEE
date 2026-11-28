const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const { MODULE_LABELS, ACTION_LABELS, ENTITY_TYPES, ACTIONS } = AuditLog;
const { SHEET_LABELS } = require("../utils/entryAudit");
const { recordAudit } = require("../utils/auditTrail");

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
 *   GET /audit-trail/summary  the stat tiles (today / 7 days) and the last 14 days per day, per action
 *   POST /audit-trail/page-view    { path, title } — the web app reports a page it opened (any signed-in user, about themselves)
 *   POST /audit-trail/client-error { message, path, stack, source } — the web app reports a crash on the user's screen
 *
 * Also `status` (success,failed) and `client` (web,app,system) as comma
 * lists. The list answer carries `stats` over the same filters (people,
 * failures, per action, per module, top users) for Administration › Logs.
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
  // "Hide pages opened": everything but the page views (unless an action filter already decides).
  else if (q.views === "0") query.action = { $ne: "view" };
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
  const statuses = list(q.status).filter((v) => v === "success" || v === "failed");
  if (statuses.length === 1) query.success = statuses[0] === "success" ? { $ne: false } : false;
  const clients = list(q.client).filter((v) => ["web", "app", "system"].includes(v));
  if (clients.length) {
    // Rows from before "system" existed have client "" and no request behind them.
    query.client = { $in: clients.includes("system") ? [...clients, ""] : clients };
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
    const direction = req.query.sort === "oldest" ? 1 : -1;
    const [total, data, facets] = await Promise.all([
      AuditLog.countDocuments(query),
      AuditLog.find(query).sort({ createdAt: direction, _id: direction }).skip(skip).limit(limit).lean(),
      req.query.stats === "0"
        ? null
        : AuditLog.aggregate([
            { $match: query },
            {
              $facet: {
                users: [{ $group: { _id: { $ifNull: ["$actor.id", "$actor.name"] } } }, { $count: "n" }],
                failed: [{ $match: { success: false } }, { $count: "n" }],
                actions: [{ $group: { _id: "$action", n: { $sum: 1 } } }],
                modules: [{ $group: { _id: "$entityType", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 30 }],
                topUsers: [
                  { $match: { "actor.id": { $ne: null } } },
                  { $group: { _id: "$actor.id", n: { $sum: 1 }, name: { $last: "$actor.name" }, role: { $last: "$actor.role" } } },
                  { $sort: { n: -1 } },
                  { $limit: 8 },
                ],
              },
            },
          ]).allowDiskUse(true),
    ]);
    const f = facets?.[0] || {};
    const count = (arr) => (arr && arr[0] ? arr[0].n : 0);
    const toMap = (arr) => Object.fromEntries((arr || []).map((x) => [x._id, x.n]));
    const stats = facets
      ? {
          total,
          uniqueUsers: count(f.users),
          failed: count(f.failed),
          actions: toMap(f.actions),
          modules: toMap(f.modules),
          topUsers: (f.topUsers || []).map((u) => ({ id: u._id, name: u.name || "", role: u.role || "", count: u.n })),
        }
      : undefined;
    res.status(200).json({ isOk: true, data, total, stats });
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

// The IST calendar day `offset` days from today, as its first instant.
const istDayStart = (offset = 0, now = Date.now()) => {
  const d = new Date(now + IST_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset) - IST_MS);
};

exports.summary = async (req, res) => {
  try {
    const todayStart = istDayStart(0);
    const weekStart = istDayStart(-6);
    const chartStart = istDayStart(-13);
    const CHANGES = ["create", "update", "delete"];
    const [facets] = await AuditLog.aggregate([
      { $match: { createdAt: { $gte: chartStart } } },
      {
        $facet: {
          today: [{ $match: { createdAt: { $gte: todayStart }, action: { $ne: "view" } } }, { $count: "n" }],
          loginsToday: [{ $match: { createdAt: { $gte: todayStart }, action: "login" } }, { $count: "n" }],
          viewsToday: [{ $match: { createdAt: { $gte: todayStart }, action: "view" } }, { $count: "n" }],
          errors: [{ $match: { createdAt: { $gte: weekStart }, success: false } }, { $count: "n" }],
          activeToday: [{ $match: { createdAt: { $gte: todayStart }, "actor.id": { $ne: null } } }, { $group: { _id: "$actor.id" } }, { $count: "n" }],
          failedLogins: [{ $match: { createdAt: { $gte: weekStart }, action: "loginFailed" } }, { $count: "n" }],
          deletes: [{ $match: { createdAt: { $gte: weekStart }, action: "delete" } }, { $count: "n" }],
          changes: [{ $match: { createdAt: { $gte: weekStart }, action: { $in: CHANGES } } }, { $count: "n" }],
          backups: [{ $match: { createdAt: { $gte: weekStart }, entityType: "backup", action: "create" } }, { $count: "n" }],
          perDay: [{ $group: { _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Asia/Kolkata" } }, action: "$action" }, n: { $sum: 1 } } }],
        },
      },
    ]);
    const count = (arr) => (arr && arr[0] ? arr[0].n : 0);
    const days = [];
    for (let i = 13; i >= 0; i -= 1) days.push({ day: new Date(istDayStart(-i).getTime() + IST_MS).toISOString().slice(0, 10), total: 0, actions: {} });
    const byDay = new Map(days.map((d) => [d.day, d]));
    for (const row of facets?.perDay || []) {
      const d = byDay.get(row._id.day);
      if (!d) continue;
      d.actions[row._id.action] = (d.actions[row._id.action] || 0) + row.n;
      d.total += row.n;
    }
    res.set("Cache-Control", "no-store");
    res.status(200).json({
      isOk: true,
      data: {
        todayActions: count(facets?.today),
        activeUsersToday: count(facets?.activeToday),
        loginsToday: count(facets?.loginsToday),
        viewsToday: count(facets?.viewsToday),
        errors7d: count(facets?.errors),
        failedLogins7d: count(facets?.failedLogins),
        deletes7d: count(facets?.deletes),
        changes7d: count(facets?.changes),
        backups7d: count(facets?.backups),
        days,
      },
    });
  } catch (error) {
    console.error("Error loading the logs summary:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Reported by the web app itself ───────────────────────────────────────
// A page path as the app shows it, without its role slug: "/hqepl/logs" → "/logs".
const cleanPage = (raw) => {
  const p = String(raw || "").split("?")[0].trim();
  if (!/^\/[A-Za-z0-9/_-]{0,200}$/.test(p)) return "";
  return p.replace(/^\/[^/]+(?=\/)/, "") || p;
};
// "Logs | Indo Electricals" → "Logs".
const cleanTitle = (raw) => String(raw || "").split("|")[0].trim().slice(0, 120);

// The same person opening the same page again within a minute is one visit.
const recentViews = new Map();
const VIEW_GAP_MS = 60 * 1000;

exports.pageView = async (req, res) => {
  try {
    const page = cleanPage(req.body?.path);
    if (!page) return res.status(400).json({ isOk: false, message: "path must be a page path such as /hqepl/logs." });
    const key = `${req.user?._id}|${page}`;
    const last = recentViews.get(key) || 0;
    if (Date.now() - last > VIEW_GAP_MS) {
      recentViews.set(key, Date.now());
      if (recentViews.size > 5000) recentViews.clear();
      await recordAudit({ req, entityType: "page", label: cleanTitle(req.body?.title) || page, action: "view", page });
    } else if (req.auditCtx) req.auditCtx.audited = true;
    res.status(200).json({ isOk: true });
  } catch {
    res.status(200).json({ isOk: true }); // never bother anyone over a log line
  }
};

// At most this many screen errors per person per hour (a loop must not flood the log).
const errorBudget = new Map();
const ERRORS_PER_HOUR = 30;

exports.clientError = async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim().slice(0, 300);
    if (!message) return res.status(400).json({ isOk: false, message: "message is required." });
    const key = String(req.user?._id || req.ip);
    const hour = Math.floor(Date.now() / 3600000);
    const b = errorBudget.get(key);
    const used = b && b.hour === hour ? b.n : 0;
    if (used >= ERRORS_PER_HOUR) {
      if (req.auditCtx) req.auditCtx.audited = true;
      return res.status(200).json({ isOk: true });
    }
    errorBudget.set(key, { hour, n: used + 1 });
    if (errorBudget.size > 5000) errorBudget.clear();
    const page = cleanPage(req.body?.path) || "";
    const source = String(req.body?.source || "screen").slice(0, 40);
    const firstFrame = String(req.body?.stack || "").split("\n").slice(0, 3).join(" | ").slice(0, 500);
    await recordAudit({
      req,
      entityType: "page",
      label: message,
      action: "error",
      page,
      success: false,
      remark: [`Error on the user's screen (${source})`, firstFrame].filter(Boolean).join(" — "),
    });
    res.status(200).json({ isOk: true });
  } catch {
    res.status(200).json({ isOk: true });
  }
};

// ── CSV ──────────────────────────────────────────────────────────────────
const CSV_HEADER = ["Date & time (IST)", "Module", "Action", "Record", "Sheet", "Record date", "Machine", "Field", "From", "To", "Remark", "User", "Role", "Client", "Result", "IP", "Request"];

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
    const tail = [log.remark || "", log.actor?.name || "", log.actor?.role || "", log.client || "", log.success === false ? `Failed${log.statusCode ? ` (${log.statusCode})` : ""}` : "OK", log.ip || "", [log.method, log.path].filter(Boolean).join(" ")];
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
    const name = `logs-${req.query.from || "start"}_${req.query.to || "today"}.csv`;
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
exports._istDayStart = istDayStart;
exports._cleanPage = cleanPage;
exports.CSV_HEADER = CSV_HEADER;
