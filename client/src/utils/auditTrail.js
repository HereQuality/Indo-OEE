/**
 * utils/auditTrail.js
 * ────────────────────
 * What the Audit Trail page, the per-record History modal and the OEE Review
 * audit tab share and that has no React in it: the action vocabulary (kept in
 * step with server models/AuditLog.js), the query string the server takes,
 * and the name of the CSV download.
 */

// Every kind of audit row — label and badge colour. Order is the order the
// Action filter offers them when the server's filter list isn't available.
export const AUDIT_ACTIONS = [
  { key: "create", label: "Created", tone: "success" },
  { key: "update", label: "Edited", tone: "primary" },
  { key: "delete", label: "Deleted", tone: "danger" },
  { key: "unlocked", label: "Unlocked", tone: "warning" },
  { key: "flagged", label: "Over 100%", tone: "warning" },
  { key: "cleared", label: "Back under 100%", tone: "secondary" },
  { key: "approved", label: "Approved", tone: "success" },
  { key: "rejected", label: "Rejected", tone: "danger" },
  { key: "setting", label: "Setting changed", tone: "primary" },
  { key: "marked", label: "Marked Not running", tone: "warning" },
  { key: "unmarked", label: "Not running undone", tone: "secondary" },
  { key: "login", label: "Signed in", tone: "success" },
  { key: "loginFailed", label: "Sign-in failed", tone: "danger" },
  { key: "logout", label: "Signed out", tone: "secondary" },
  { key: "passwordChange", label: "Password changed", tone: "secondary" },
  { key: "passwordReset", label: "Password reset", tone: "secondary" },
  { key: "impersonate", label: "Signed in as another user", tone: "purple" },
  { key: "blocked", label: "Blocked", tone: "danger" },
  { key: "unblocked", label: "Unblocked", tone: "secondary" },
  { key: "sent", label: "Sent", tone: "secondary" },
  { key: "import", label: "Imported", tone: "secondary" },
];

export const ACTION_BY_KEY = Object.fromEntries(AUDIT_ACTIONS.map((a) => [a.key, a]));

// Bootstrap 5.3 subtle badge classes per tone. "purple" has no Bootstrap
// colour of its own, so it's painted inline (see badgeStyle).
const TONE_CLASS = {
  success: "bg-success-subtle text-success-emphasis",
  primary: "bg-primary-subtle text-primary-emphasis",
  danger: "bg-danger-subtle text-danger-emphasis",
  warning: "bg-warning-subtle text-warning-emphasis",
  secondary: "bg-secondary-subtle text-secondary-emphasis",
  purple: "",
};
const PURPLE = { backgroundColor: "#ede9fe", color: "#5b21b6" };

export const actionLabel = (key) => ACTION_BY_KEY[key]?.label || key || "—";
export const actionTone = (key) => ACTION_BY_KEY[key]?.tone || "secondary";
export const badgeClass = (key) => TONE_CLASS[actionTone(key)] ?? TONE_CLASS.secondary;
export const badgeStyle = (key) => (actionTone(key) === "purple" ? PURPLE : undefined);

// Rows whose "changes" list the whole record rather than old → new pairs.
export const wholeSideOf = (action) => (action === "create" ? "to" : action === "delete" ? "from" : null);

export const PAGE_SIZE = 50;

// Everything the page can filter by, in the order the server's query takes them.
export const EMPTY_FILTERS = {
  from: "",
  to: "",
  module: [],
  action: [],
  actor: "",
  q: "",
  sheet: "",
  entity: "",
  machine: "",
  date: "",
};

const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(",") : []).map((s) => String(s).trim()).filter(Boolean);

// The params object for GET /audit-trail — only what's set, lists joined with
// commas, skip/limit always present so a page is always a page.
export const buildAuditQuery = (filters = {}, { skip = 0, limit = PAGE_SIZE } = {}) => {
  const f = { ...EMPTY_FILTERS, ...filters };
  const params = {};
  if (f.from) params.from = f.from;
  if (f.to) params.to = f.to;
  const modules = list(f.module);
  if (modules.length) params.module = modules.join(",");
  const actions = list(f.action);
  if (actions.length) params.action = actions.join(",");
  if (f.actor) params.actor = f.actor;
  const q = String(f.q || "").trim();
  if (q) params.q = q;
  if (f.sheet) params.sheet = f.sheet;
  if (f.entity) params.entity = f.entity;
  if (f.machine) params.machine = f.machine;
  if (f.date) params.date = f.date;
  params.skip = Math.max(0, Number(skip) || 0);
  params.limit = Math.max(1, Number(limit) || PAGE_SIZE);
  return params;
};

// "audit-trail-2026-10-27_2026-11-25.csv" — the dates it was filtered to, or
// "all" for an open end.
export const csvFileName = ({ from, to } = {}) => `audit-trail-${from || "all"}_${to || "all"}.csv`;

// Whether the page is showing one record's history (?entity=… or ?sheet&date&machine).
export const isRecordQuery = (f = {}) => !!(f.entity || (f.sheet && f.date));

// The filters that count as "the user narrowed the list" — the record query
// and the default date range aren't chips.
export const activeChips = (f, { modules = [], actions = [], actors = [] } = {}) => {
  const chips = [];
  for (const m of list(f.module)) chips.push({ key: "module", value: m, label: `Module: ${modules.find((x) => x.key === m)?.label || m}` });
  for (const a of list(f.action)) chips.push({ key: "action", value: a, label: `Action: ${actions.find((x) => x.key === a)?.label || actionLabel(a)}` });
  if (f.actor) chips.push({ key: "actor", value: f.actor, label: `User: ${actors.find((x) => String(x.id) === String(f.actor))?.name || f.actor}` });
  if (String(f.q || "").trim()) chips.push({ key: "q", value: f.q, label: `Search: “${String(f.q).trim()}”` });
  return chips;
};
