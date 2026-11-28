const AuditLog = require("../models/AuditLog");
const { MODULE_LABELS, ACTION_LABELS, ENTITY_TYPES, ACTIONS } = AuditLog;
const { actorOf } = require("./adminAccess");

/**
 * utils/auditTrail.js
 * ─────────────────────
 * One call that every module makes after a successful write, so the audit
 * trail (models/AuditLog.js) gets a row for it:
 *
 *   await recordAudit({ req, entityType: "machine", entity: m._id, label: m.machineName,
 *                       action: "update", before, after, fields: { machineName: "Machine", isActive: "Active" } });
 *
 *  - diffChanges works out `changes` (field, label, from, to) from the record
 *    before and after over `fields` — an object { path: "Label" } or a list of
 *    paths (dotted paths reach inside sub-documents). Values are compared the
 *    way a person reads them: ObjectIds by their string, Dates by ISO, lists by
 *    their JSON, booleans as Yes / No, blanks as null. Unchanged fields are
 *    left out; a create shows every field with from = null, a delete every
 *    field with to = null.
 *  - An "update" that changed nothing writes no row (returns null), unless a
 *    remark says why it still matters.
 *  - Who did it comes from the signed-in user (utils/adminAccess.js actorOf);
 *    an event with nobody signed in (a failed sign-in) passes `actor` itself.
 *  - `module`, `client` (web / app), `ip` and `search` are filled in here.
 *
 * Logging never fails the request it describes: every error is reported and
 * null comes back, the same rule utils/entryAudit.js and ItemLog follow.
 * Callers pass display values where ids would read badly (a process name
 * instead of its id) by handing over pre-mapped before / after objects — nothing
 * is populated here.
 */

const SKIP_FIELDS = new Set(["_id", "__v", "createdAt", "updatedAt", "id"]);

// A document as plain data.
const plain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc || {});

const get = (obj, path) => String(path).split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);

const isObjectId = (v) => !!v && typeof v === "object" && (v._bsontype === "ObjectId" || v._bsontype === "ObjectID" || typeof v.toHexString === "function");

// A stored value as the log shows it: blanks → null, Yes / No, dates as ISO,
// ids as text, a list of plain values joined, anything else as JSON.
const present = (v) => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (isObjectId(v)) return String(v);
  if (v instanceof Map) return present(Object.fromEntries(v));
  if (Array.isArray(v)) {
    if (!v.length) return null;
    const items = v.map(present);
    return items.every((x) => x === null || typeof x !== "object") ? items.filter((x) => x !== null).join(", ") || null : JSON.stringify(items);
  }
  if (typeof v === "object") {
    const keys = Object.keys(v).filter((k) => !SKIP_FIELDS.has(k));
    if (!keys.length) return null;
    return JSON.stringify(Object.fromEntries(keys.map((k) => [k, present(v[k])])));
  }
  return String(v);
};

// `fields` as [path, label] pairs; with none given, every key of before / after.
const fieldPairs = (before, after, fields) => {
  if (Array.isArray(fields)) return fields.map((f) => [f, f]);
  if (fields && typeof fields === "object") return Object.entries(fields);
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !SKIP_FIELDS.has(k));
  return keys.map((k) => [k, k]);
};

// Field-by-field old → new over `fields`; for a create every field that has a
// value (from = null), for a delete every field that had one (to = null).
const diffChanges = (before, after, fields, action = "update") => {
  const b = plain(before);
  const a = plain(after);
  const out = [];
  for (const [field, label] of fieldPairs(b, a, fields)) {
    const from = action === "create" ? null : present(get(b, field));
    const to = action === "delete" ? null : present(get(a, field));
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    out.push({ field, label: label || field, from, to });
  }
  return out;
};

// Which client sent the request, from where, on what device, and the API
// call itself. The app says so in its body (`client: "app"`), an X-Client
// header or its Dart user agent; everything else is the web. No request = the
// server itself ("system": the daily backup, a scheduled mail).
//
// Every audit row is written through here, so it is also where a request is
// marked as logged: the catch-all (middlewares/auditCatchAll.middleware.js)
// then knows not to add a generic row for the same request.
const requestMeta = (req) => {
  if (!req) return { client: "system", ip: "", userAgent: "", method: "", path: "" };
  if (req.auditCtx) req.auditCtx.audited = true;
  const userAgent = String(req.headers?.["user-agent"] || "").slice(0, 300);
  const isApp = req.body?.client === "app" || req.headers?.["x-client"] === "app" || /^Dart\//.test(userAgent);
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    client: isApp ? "app" : "web",
    ip: forwarded || req.ip || req.socket?.remoteAddress || "",
    userAgent,
    method: req.method || "",
    path: String(req.originalUrl || req.url || "").split("?")[0].slice(0, 300),
  };
};

// Everything a person might search a row by, lowercased in one string.
const searchText = (row) => {
  const parts = [row.label, row.actor?.name, row.actor?.role, row.remark, row.machineName, row.date, row.module, row.path, row.ip];
  for (const c of row.changes || []) parts.push(c.label, c.from, c.to);
  return parts
    .filter((v) => v !== null && v !== undefined && v !== "")
    .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
    .join(" ")
    .toLowerCase()
    .slice(0, 8000);
};

// { id: name } for the records `ids` name in `Model`, by `field` — so a caller
// can log a process by its name instead of its id.
const nameMap = async (Model, ids, field) => {
  const unique = [...new Set((ids || []).flat().filter(Boolean).map((v) => String(v?._id || v)))];
  if (!unique.length) return {};
  const rows = await Model.find({ _id: { $in: unique } }).select(field).lean();
  return Object.fromEntries(rows.map((r) => [String(r._id), r[field]]));
};

const recordAudit = async ({
  req,
  entityType,
  entity = null,
  label = "",
  action,
  before,
  after,
  fields,
  changes,
  remark = "",
  sheet = null,
  date = "",
  machine = null,
  machineName = "",
  actor,
  metrics,
  flagged,
  success,
  statusCode,
  page,
} = {}) => {
  try {
    const list = Array.isArray(changes) ? changes : diffChanges(before, after, fields, action);
    if (action === "update" && !list.length && !remark) return null;
    const who = req?.user ? await actorOf(req) : { ...(actor || {}) };
    const row = {
      entityType,
      module: MODULE_LABELS[entityType] || "",
      sheet,
      entity: entity || null,
      machine: machine || null,
      machineName: machineName || "",
      date: date || "",
      label: label || "",
      action,
      changes: list,
      remark: remark || "",
      actor: who,
      ...requestMeta(req),
    };
    // A page opened in the web app: the page's own address, not the API call that reported it.
    if (page) {
      row.method = "VIEW";
      row.path = String(page).slice(0, 300);
    }
    if (success === false) row.success = false;
    if (statusCode) row.statusCode = statusCode;
    if (metrics) row.metrics = metrics;
    if (flagged) row.flagged = flagged;
    row.search = searchText(row);
    return await AuditLog.create(row);
  } catch (error) {
    console.error("Error writing audit trail:", error);
    return null;
  }
};

module.exports = { recordAudit, diffChanges, requestMeta, searchText, present, plain, nameMap, MODULE_LABELS, ACTION_LABELS, ENTITY_TYPES, ACTIONS };
