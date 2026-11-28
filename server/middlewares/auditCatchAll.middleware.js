"use strict";
const { recordAudit } = require("../utils/auditTrail");

/**
 * middlewares/auditCatchAll.middleware.js
 * ─────────────────────────────────────────
 * The safety net under the audit log (models/AuditLog.js, Administration ›
 * Logs): every change made through the API ends up in the log, even when the
 * module that made it doesn't write a row of its own.
 *
 * Mounted once in front of every /api/v1 route (app.js). It waits until the
 * response has finished and then, if nothing wrote an audit row during the
 * request (utils/auditTrail.js requestMeta marks req.auditCtx when one is
 * written), adds one generic row:
 *   - for a write (POST / PUT / PATCH / DELETE): who, which module, Created /
 *     Edited / Deleted, the API call and how it ended — failures included
 *     (403 refused, 400 rejected), so "someone tried and it failed" is in the
 *     log too;
 *   - for ANY request the server failed on (HTTP 5xx, reads included): an
 *     "Error" row, so every server error is in the log.
 * A failure's row carries the message the user was shown (the response's
 * `message`), so the log says WHY it failed.
 *
 * Never logged here: reads dressed as POSTs (searches, list filters), the
 * app's own page-view / screen-error reports (they write their own rows), the
 * sign-in / OTP / session calls (auth.controller.js logs sign-ins itself),
 * marking notifications read, the app's version ping, and unknown URLs (404).
 * The request body is never copied — only that the call happened.
 *
 * It never changes a response, never makes one wait and never throws.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Path (after /api/v1) patterns that are not changes, or are logged elsewhere.
const SKIP = [
  /\/search\/?$/i,
  /\/list\/?$/i,
  /\/(read|read-all)\/?$/i,
  /^\/auth\/(login|employee\/login|send-otp|verify-otp|login-status|refresh-session|logout|reset-password)\/?$/i,
  /^\/auth\/me\/preferences\/?$/i,
  /^\/app-update\/report-version\/?$/i,
  /^\/authorizeMenus\/?$/i,
  // The app's own reports (a page opened, a screen error) write their own rows.
  /^\/audit-trail\/(page-view|client-error)\/?$/i,
];

// First path segment → the module (AuditLog MODULE_LABELS key) it belongs to.
const MODULE_OF = {
  auth: "profile",
  departments: "department",
  "company-holidays": "holiday",
  roles: "role",
  companies: "company",
  "operator-roles": "permissions",
  operators: "operator",
  teams: "team",
  tickets: "ticket",
  notifications: "notification",
  machines: "machine",
  "machine-operators": "machineOperator",
  vendors: "vendor",
  items: "item",
  "work-orders": "workOrder",
  "oee-review": "entry",
  kpi: "kpiObjective",
  processes: "process",
  maintenance: "maintenance",
  announcement: "announcement",
  "app-update": "appUpdate",
  "summary-mail": "summaryMail",
  "machine-day-status": "notRunning",
  backups: "backup",
  "menu-groups": "menuGroup",
  menus: "menu",
};
const moduleOf = (segment) => MODULE_OF[segment] || (/-sheet$/.test(segment) ? "entry" : "other");

// A word for the last meaningful segment of the path ("reply", "start-progress").
const VERB_ACTIONS = { send: "sent", import: "import", impersonate: "impersonate", unlock: "unlocked", "reset-password": "passwordReset" };
const isId = (s) => /^[0-9a-f]{24}$/i.test(s) || /^\d+$/.test(s);

/** What the generic row says about a request: { entityType, action, label, entity }. Pure. */
const describeRequest = (method, apiPath) => {
  const parts = String(apiPath || "").split("?")[0].split("/").filter(Boolean);
  const entityType = moduleOf(parts[0] || "");
  const id = parts.find(isId) || null;
  const words = parts.slice(1).filter((p) => !isId(p));
  const verb = words[words.length - 1] || "";
  let action = method === "DELETE" ? "delete" : method === "POST" && !words.length ? "create" : "update";
  if (VERB_ACTIONS[verb]) action = VERB_ACTIONS[verb];
  const pretty = (s) => s.replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const shape = parts.map((p) => (isId(p) ? ":id" : p)).join("/");
  const label = words.length ? pretty(words.join(" · ")) : `/${shape}`;
  return { entityType, action, label, entity: id };
};

const shouldLog = (req, res) => {
  if (req.auditCtx?.audited) return false;
  if (!WRITE_METHODS.has(req.method)) return res.statusCode >= 500;
  if (res.statusCode === 404) return false;
  // Nobody signed in and refused: a stale tab or a bot, not a person's action.
  if (res.statusCode === 401 && !req.user) return false;
  const apiPath = String(req.originalUrl || "").split("?")[0].replace(/^\/api\/v1/, "");
  return !SKIP.some((re) => re.test(apiPath));
};

// The `message` of a JSON error answer, kept short.
const messageOf = (body) => {
  const m = body && typeof body === "object" ? body.message || body.error : null;
  return typeof m === "string" ? m.slice(0, 300) : "";
};

const auditCatchAll = (req, res, next) => {
  try {
    if (req.method === "OPTIONS" || req.method === "HEAD") return next();
    req.auditCtx = { audited: false, message: "" };
    // Remember what an error answer said, without changing it.
    if (typeof res.json === "function") {
      const json = res.json.bind(res);
      res.json = (body) => {
        try {
          if (res.statusCode >= 400) req.auditCtx.message = messageOf(body);
        } catch {
          // never mind
        }
        return json(body);
      };
    }
    res.on("finish", () => {
      try {
        if (!shouldLog(req, res)) return;
        const apiPath = String(req.originalUrl || "").split("?")[0].replace(/^\/api\/v1/, "");
        const d = describeRequest(req.method, apiPath);
        const ok = res.statusCode < 400;
        const serverError = res.statusCode >= 500;
        const why = req.auditCtx.message;
        recordAudit({
          req,
          entityType: d.entityType,
          entity: d.entity,
          label: d.label,
          action: serverError ? "error" : d.action,
          changes: [],
          remark: ok ? "" : `${serverError ? "Server error" : "Failed"} (HTTP ${res.statusCode})${why ? `: ${why}` : ""}`,
          success: ok,
          statusCode: res.statusCode,
          actor: req.user ? undefined : { name: "Not signed in" },
        }).catch(() => {});
      } catch (error) {
        console.error("[audit catch-all] could not record:", error.message);
      }
    });
  } catch {
    // Logging must never be the reason a request fails.
  }
  return next();
};

module.exports = { auditCatchAll, describeRequest, shouldLog, SKIP };
