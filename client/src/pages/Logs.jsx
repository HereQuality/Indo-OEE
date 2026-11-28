import React, { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Container, Table } from "reactstrap";
import {
  Activity, Archive, ArrowDown, ArrowUp, Ban, Bug, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Copy, Download,
  Eye, FilterX, History, KeyRound, LayoutGrid, Lock, LogIn, LogOut, Mail, Monitor, MoreHorizontal, Pencil, Plus, Radio, RefreshCw, Search,
  Server, Settings, ShieldAlert, SlidersHorizontal, Smartphone, Tag, Trash2, TriangleAlert, Undo2, Unlock, Upload, UserCog, UserRound, Users, X, Zap,
} from "lucide-react";
import { ThemeContext } from "../context/ThemeContext";
import { useAlert } from "../context/AlertContext";
import { Detail as LogDetail } from "../Components/AuditTrail/AuditLogList";
import { exportAuditTrailCsv, getAuditTrail, getAuditTrailFilters, getAuditTrailSummary } from "../api/auditTrail.api";
import { AUDIT_ACTIONS } from "../utils/auditTrail";

/**
 * pages/Logs.jsx — Administration › Logs (was Data Entry › Audit Trail)
 * ──────────────────────────────────────────────────────────────────────
 * Everything that happens in the app, newest first (server models/AuditLog.js): every entry created / edited /
 * deleted / unlocked, every master and setting change, sign-ins (and refused ones), Not-running marks, OEE
 * reviews, mails sent, backups taken and downloaded, every page opened, every error (a server error with its
 * message, a refused change with the reason shown to the user, a crash on someone's screen) — and, through the
 * server's catch-all, any other change made through the API. For a change, WHAT changed ("OK Quantity: 10 → 12").
 *
 *  - All the filters sit behind one "Filters" button (with a count of those in force); the ones in force are also
 *    listed as removable chips under the search box.
 *
 *  - Stat tiles (today / last 7 days) and the 14-day chart are quick filters: click one to narrow the list.
 *  - Top users / top modules / actions are counted over the CURRENT filters; click one to filter by it.
 *  - Filters live in the URL (q, user, action, module, status, client, from, to, sort, page, limit), so a view can
 *    be bookmarked or shared. ?entity=… (or ?sheet&date&machine) is one record's whole history — where a row's
 *    "History" button's "Open in Logs" leads.
 *  - Rows expand in place: the changes, OEE figures, the request, the device, the IP.
 *  - Live: refreshes itself every 30 s while on the first page; Export downloads the filtered view as CSV.
 *  - Every date and time is IST whatever the browser's own zone is.
 */

/* ── IST date/time helpers ───────────────────────────────────────────────────────────────────────── */

const IST_ZONE = "Asia/Kolkata";
const IST_OFFSET_MS = 330 * 60 * 1000;
const pad2 = (n) => String(n).padStart(2, "0");
const istFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: IST_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, hourCycle: "h12",
});
const formatIst = (value, { seconds = true } = {}) => {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return "";
  const p = {};
  istFormat.formatToParts(d).forEach((part) => {
    p[part.type] = part.value;
  });
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}${seconds ? `:${p.second}` : ""} ${String(p.dayPeriod || "").toUpperCase()}`.trim();
};
const formatIstTimeOnly = (value) => {
  const full = formatIst(value);
  const at = full.indexOf(", ");
  return at === -1 ? full : full.slice(at + 2);
};
const relativeTime = (value, now) => {
  const t = new Date(value).getTime();
  if (!value || Number.isNaN(t)) return "";
  const secs = Math.round((now - t) / 1000);
  if (secs < 45) return "just now";
  if (secs < 90) return "1 min ago";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  const months = Math.round(days / 30);
  return months < 12 ? `${months} mo ago` : `${Math.round(days / 365)} y ago`;
};
const istDay = (now, offsetDays = 0) => {
  const d = new Date(now + IST_OFFSET_MS);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offsetDays));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
};
const istMonthStart = (now) => `${istDay(now).slice(0, 8)}01`;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const shortDay = (day) => {
  const d = new Date(`${day}T12:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-IN", { timeZone: IST_ZONE, day: "2-digit", month: "short" });
};
const buildPresets = (now) => [
  { key: "today", label: "Today", from: istDay(now), to: istDay(now) },
  { key: "yesterday", label: "Yesterday", from: istDay(now, -1), to: istDay(now, -1) },
  { key: "7d", label: "Last 7 days", from: istDay(now, -6), to: istDay(now) },
  { key: "30d", label: "Last 30 days", from: istDay(now, -29), to: istDay(now) },
  { key: "month", label: "This month", from: istMonthStart(now), to: istDay(now) },
];

/* ── Device from a user-agent string ─────────────────────────────────────────────────────────────── */

const deviceParts = (ua, client) => {
  const s = String(ua || "");
  if (client === "system" || (!client && !s)) return { browser: "Server", os: "" };
  const fallback = client === "app" ? "Mobile app" : "Unknown device";
  if (!s) return { browser: fallback, os: "" };
  let browser = "";
  if (/Edg(e|A|iOS)?\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/SamsungBrowser\//.test(s)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(s)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";
  else if (/Dart\//.test(s)) browser = "Mobile app";
  else if (/PostmanRuntime/i.test(s)) browser = "Postman";
  else if (/^curl\//i.test(s)) browser = "curl";
  else if (/^(node|axios|undici)/i.test(s)) browser = "API client";
  let os = "";
  const android = s.match(/Android ([\d.]+)/);
  if (android) os = `Android ${android[1].split(".")[0]}`;
  else if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux/.test(s)) os = "Linux";
  return { browser: browser || (os ? "" : fallback), os };
};
const friendlyIp = (ip) => {
  const v = String(ip || "").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!v) return "—";
  if (v === "::1" || v === "127.0.0.1") return "Local (same machine)";
  return v;
};
const isSystemRow = (row) => row.client === "system" || row.actor?.role === "System" || (!row.client && !row.actor?.id && !row.ip);
const sourceOf = (row) => (isSystemRow(row) ? "system" : row.client === "app" ? "app" : "web");

/* ── Colours: one tone table for the action badges, result pills and the chart ───────────────────── */

const TONES = {
  green: { fg: "#15803d", fgDark: "#4ade80", rgb: "22,163,74" },
  red: { fg: "#b91c1c", fgDark: "#f87171", rgb: "220,38,38" },
  slate: { fg: "#475569", fgDark: "#94a3b8", rgb: "100,116,139" },
  sky: { fg: "#0369a1", fgDark: "#38bdf8", rgb: "2,132,199" },
  indigo: { fg: "#4338ca", fgDark: "#a5b4fc", rgb: "79,70,229" },
  emerald: { fg: "#047857", fgDark: "#34d399", rgb: "5,150,105" },
  amber: { fg: "#b45309", fgDark: "#fbbf24", rgb: "217,119,6" },
  gray: { fg: "#4b5563", fgDark: "#9ca3af", rgb: "107,114,128" },
  violet: { fg: "#6d28d9", fgDark: "#c4b5fd", rgb: "124,58,237" },
  rose: { fg: "#be123c", fgDark: "#fda4af", rgb: "225,29,72" },
};

// Order = the chart's stacking order (bottom up). Labels come from utils/auditTrail.js (the server's words).
const ACTION_STYLE = {
  create: { tone: "emerald", dot: "#059669", Icon: Plus },
  update: { tone: "amber", dot: "#d97706", Icon: Pencil },
  delete: { tone: "red", dot: "#dc2626", Icon: Trash2 },
  setting: { tone: "indigo", dot: "#6366f1", Icon: Settings },
  import: { tone: "sky", dot: "#0ea5e9", Icon: Upload },
  unlocked: { tone: "amber", dot: "#f59e0b", Icon: Unlock },
  flagged: { tone: "rose", dot: "#f43f5e", Icon: TriangleAlert },
  cleared: { tone: "slate", dot: "#94a3b8", Icon: Check },
  approved: { tone: "green", dot: "#16a34a", Icon: Check },
  rejected: { tone: "red", dot: "#b91c1c", Icon: X },
  marked: { tone: "amber", dot: "#ca8a04", Icon: Ban },
  unmarked: { tone: "slate", dot: "#64748b", Icon: Undo2 },
  login: { tone: "green", dot: "#22c55e", Icon: LogIn },
  loginFailed: { tone: "rose", dot: "#e11d48", Icon: ShieldAlert },
  logout: { tone: "slate", dot: "#475569", Icon: LogOut },
  passwordChange: { tone: "violet", dot: "#7c3aed", Icon: KeyRound },
  passwordReset: { tone: "violet", dot: "#a78bfa", Icon: KeyRound },
  impersonate: { tone: "violet", dot: "#6d28d9", Icon: UserCog },
  blocked: { tone: "red", dot: "#991b1b", Icon: Ban },
  unblocked: { tone: "slate", dot: "#cbd5e1", Icon: Undo2 },
  sent: { tone: "sky", dot: "#0284c7", Icon: Mail },
  download: { tone: "sky", dot: "#38bdf8", Icon: Download },
  view: { tone: "indigo", dot: "#a5b4fc", Icon: Eye },
  error: { tone: "red", dot: "#7f1d1d", Icon: Bug },
  other: { tone: "gray", dot: "#9ca3af", Icon: MoreHorizontal },
};
const KNOWN_ACTIONS = Object.keys(ACTION_STYLE);
const CHANGE_ACTIONS = ["create", "update", "delete"];
const LABEL_OF = Object.fromEntries(AUDIT_ACTIONS.map((a) => [a.key, a.label]));
const actionLabel = (a) => LABEL_OF[a] || String(a || "Other").replace(/^\w/, (c) => c.toUpperCase());

const useDark = () => useContext(ThemeContext)?.isDarkMode === true;

const Pill = ({ tone = "gray", title, icon: Icon, children }) => {
  const dark = useDark();
  const t = TONES[tone] || TONES.gray;
  return (
    <span
      title={title}
      className="d-inline-flex align-items-center gap-1"
      style={{ background: `rgba(${t.rgb}, ${dark ? 0.2 : 0.12})`, color: dark ? t.fgDark : t.fg, fontSize: "0.7rem", fontWeight: 700, lineHeight: 1.3, padding: "3px 8px", borderRadius: 999, whiteSpace: "nowrap" }}
    >
      {Icon && <Icon size={11} aria-hidden="true" className="flex-shrink-0" />}
      {children}
    </span>
  );
};
const ActionBadge = ({ action }) => {
  const def = ACTION_STYLE[action] || ACTION_STYLE.other;
  return (
    <Pill tone={def.tone} icon={def.Icon}>
      {actionLabel(action)}
    </Pill>
  );
};

// Failed = red (with the HTTP code when there is one), refused = amber "Denied", anything else green "OK".
const resultView = (row) => {
  const code = Number(row.statusCode) || null;
  if (row.action === "error") return { tone: "red", code, word: "Error" };
  if (row.success === false || row.action === "loginFailed") {
    if (code === 401 || code === 403) return { tone: "amber", code, word: "Denied" };
    return { tone: "red", code, word: "Failed" };
  }
  return { tone: "green", code: null, word: "OK" };
};
const ResultPill = ({ row }) => {
  const v = resultView(row);
  return (
    <Pill tone={v.tone} title={v.code ? `HTTP ${v.code} — ${v.word}` : v.word}>
      {v.code ? (
        <>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.code}</span> {v.word}
        </>
      ) : (
        v.word
      )}
    </Pill>
  );
};

const AVATAR_TINTS = [
  { bg: "#EEF2FF", fg: "#4338CA" }, { bg: "#ECFDF5", fg: "#047857" }, { bg: "#FFF7ED", fg: "#C2410C" },
  { bg: "#FDF2F8", fg: "#BE185D" }, { bg: "#EFF6FF", fg: "#1D4ED8" }, { bg: "#F5F3FF", fg: "#6D28D9" }, { bg: "#F0FDFA", fg: "#0F766E" },
];
const Avatar = ({ name = "", size = 28, system = false }) => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const { bg, fg } = system ? { bg: "#F1F5F9", fg: "#475569" } : AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4, fontWeight: 700, flexShrink: 0 }}>
      {system ? <Server size={size * 0.5} /> : (name.charAt(0) || "?").toUpperCase()}
    </span>
  );
};

/* ── URL-backed filter state ─────────────────────────────────────────────────────────────────────── */

const PAGE_SIZES = [25, 50, 100];
const STATUS_OPTIONS = [{ value: "success", label: "Success" }, { value: "failed", label: "Failed" }];
const SOURCE_OPTIONS = [{ value: "web", label: "Web" }, { value: "app", label: "App" }, { value: "system", label: "System" }];
const PARAM_DEFAULTS = { sort: "newest", limit: 50, page: 1 };
const FILTER_KEYS = ["q", "user", "action", "module", "status", "client", "from", "to", "views", "entity", "sheet", "date", "machine", "page"];
const csv = (v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

const readFilters = (sp) => {
  const page = parseInt(sp.get("page"), 10);
  const limit = parseInt(sp.get("limit"), 10);
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  return {
    q: sp.get("q") || "",
    user: sp.get("user") || sp.get("actor") || "",
    action: csv(sp.get("action")),
    module: csv(sp.get("module")),
    status: csv(sp.get("status")).filter((v) => ["success", "failed"].includes(v)),
    client: csv(sp.get("client")).filter((v) => ["web", "app", "system"].includes(v)),
    from: DAY_RE.test(from) ? from : "",
    to: DAY_RE.test(to) ? to : "",
    entity: sp.get("entity") || "",
    sheet: sp.get("sheet") || "",
    date: sp.get("date") || "",
    machine: sp.get("machine") || "",
    sort: sp.get("sort") === "oldest" ? "oldest" : "newest",
    views: sp.get("views") === "0" ? "0" : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    limit: PAGE_SIZES.includes(limit) ? limit : 50,
  };
};
const patchParams = (current, patch) => {
  const next = new URLSearchParams(current);
  Object.entries(patch).forEach(([key, value]) => {
    const isEmpty = value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (key === "user") next.delete("actor");
    if (isEmpty || PARAM_DEFAULTS[key] === value) next.delete(key);
    else next.set(key, Array.isArray(value) ? value.join(",") : String(value));
  });
  return next;
};
// The filters as utils/auditTrail.js buildAuditQuery takes them.
const apiFilters = (f) => ({
  from: f.from,
  to: f.to || f.from,
  module: f.module,
  action: f.action,
  actor: f.user,
  q: f.q,
  sheet: f.sheet,
  entity: f.entity,
  machine: f.machine,
  date: f.date,
  status: f.status,
  client: f.client,
  sort: f.sort,
  views: f.views,
});

const fmtNum = (n) => Number(n || 0).toLocaleString("en-IN");
const sameList = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
const toggleIn = (list, item) => (list.includes(item) ? list.filter((v) => v !== item) : [...list, item]);
const copyText = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
};

/* ── Small pieces ────────────────────────────────────────────────────────────────────────────────── */

const Field = ({ label, htmlFor, children }) => (
  <div className="al-field">
    <label className="al-label" htmlFor={htmlFor}>
      {label}
    </label>
    {children}
  </div>
);

// A checkbox dropdown for one multi-pick filter (Action, Module, Result, Source).
const MultiPick = ({ id, noun, icon: Icon, options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const text = value.length === 0 ? `All ${noun.toLowerCase()}s` : value.length === 1 ? options.find((o) => o.value === value[0])?.label || value[0] : `${value.length} ${noun.toLowerCase()}s`;
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle.toLowerCase())) : options;
  return (
    <div ref={ref} className="position-relative">
      <button id={id} type="button" className="al-pick" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={text}>
        <span className="d-inline-flex align-items-center gap-2 text-truncate">
          <Icon size={14} className="text-muted flex-shrink-0" aria-hidden="true" />
          <span className="text-truncate">{text}</span>
        </span>
        <ChevronDown size={14} className="text-muted flex-shrink-0" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open && (
        <div className="al-menu" role="group" aria-label={noun}>
          {options.length > 8 && (
            <input type="search" autoFocus className="form-control form-control-sm mb-2" placeholder={`Search ${noun.toLowerCase()}s`} value={needle} onChange={(e) => setNeedle(e.target.value)} />
          )}
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {shown.map((o) => (
              <label key={o.value} className="al-menu-row">
                <input type="checkbox" className="form-check-input m-0" checked={value.includes(o.value)} onChange={() => onChange(toggleIn(value, o.value))} />
                <span className="text-truncate">{o.label}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="text-muted small px-2 py-1">Nothing matches.</div>}
          </div>
          {value.length > 0 && (
            <button type="button" className="al-mini-link mt-1" onClick={() => onChange([])}>
              <X size={12} aria-hidden="true" /> Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const UserCell = ({ row, onUser, size = 30 }) => {
  const name = row.actor?.name || (isSystemRow(row) ? "System" : "Unknown user");
  return (
    <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
      <Avatar name={name} size={size} system={isSystemRow(row)} />
      <div style={{ minWidth: 0 }}>
        {row.actor?.id ? (
          <button
            type="button"
            className="al-link text-truncate"
            title={`Show only ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              onUser(row);
            }}
          >
            {name}
          </button>
        ) : (
          <span className="fw-semibold text-truncate d-block" style={{ fontSize: "0.84rem" }}>
            {name}
          </span>
        )}
        <div className="text-muted text-truncate" style={{ fontSize: "0.72rem" }}>
          {row.actor?.role || "—"}
        </div>
      </div>
    </div>
  );
};

const DeviceCell = ({ row, stacked = false }) => {
  const source = sourceOf(row);
  const Icon = source === "system" ? Server : source === "app" ? Smartphone : Monitor;
  const { browser, os } = deviceParts(row.userAgent, source);
  return (
    <span className="d-inline-flex align-items-center gap-2" title={row.userAgent || undefined} style={{ minWidth: 0 }}>
      <Icon size={15} className="text-muted flex-shrink-0" aria-label={source} role="img" />
      {stacked ? (
        <span style={{ lineHeight: 1.25, minWidth: 0 }}>
          <span className="d-block text-truncate" style={{ fontSize: "0.8rem" }}>
            {browser || os}
          </span>
          {browser && os && (
            <span className="d-block text-muted" style={{ fontSize: "0.72rem" }}>
              {os}
            </span>
          )}
        </span>
      ) : (
        <span style={{ fontSize: "0.78rem" }}>{[browser, os].filter(Boolean).join(" · ")}</span>
      )}
    </span>
  );
};

const changeCount = (row) => (Array.isArray(row.changes) ? row.changes.length : 0);

const WhatCell = ({ row, onRecord }) => {
  const n = changeCount(row);
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: "0.84rem", overflowWrap: "anywhere" }}>
        {row.entity ? (
          <button
            type="button"
            className="al-target al-target-btn"
            title={`Show the full history of ${row.label || "this record"}`}
            onClick={(e) => {
              e.stopPropagation();
              onRecord(row);
            }}
          >
            <Tag size={10} aria-hidden="true" /> <span className="text-truncate">{row.label || "Record"}</span>
          </button>
        ) : (
          <span className="fw-medium">{row.label || [row.method, row.path].filter(Boolean).join(" ") || "—"}</span>
        )}
      </div>
      <div className="d-flex flex-wrap align-items-center gap-2" style={{ marginTop: 3 }}>
        {n > 0 && (
          <span className="al-change-count">
            {n} {n === 1 ? "change" : "changes"}
          </span>
        )}
        {row.remark && (
          <span className="text-muted text-truncate" style={{ fontSize: "0.74rem", maxWidth: "100%" }} title={row.remark}>
            {row.remark}
          </span>
        )}
      </div>
    </div>
  );
};

const TimeCell = ({ row, now, align = "start", small = false }) => (
  <span className="d-block" style={{ textAlign: align, whiteSpace: "nowrap" }}>
    <span className="d-block fw-medium" style={{ fontSize: small ? "0.76rem" : "0.82rem" }}>
      {formatIst(row.createdAt)}
    </span>
    <span className="d-block text-muted" style={{ fontSize: small ? "0.7rem" : "0.72rem" }}>
      {relativeTime(row.createdAt, now)}
    </span>
  </span>
);

const DetailItem = ({ label, children, mono = false }) => (
  <div className="al-detail">
    <dt>{label}</dt>
    <dd style={mono ? { fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.78rem", overflowWrap: "anywhere" } : { overflowWrap: "anywhere" }}>{children}</dd>
  </div>
);

const RowDetails = ({ row, now, moduleLabel, onUser, onRecord }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  const hasBody = changeCount(row) > 0 || row.remark || row.flagged?.length || row.metrics?.availability != null;
  return (
    <div className="al-details" onClick={(e) => e.stopPropagation()}>
      {hasBody ? (
        <div className="al-changes">
          <div className="al-label">{changeCount(row) === 0 ? "Details" : row.action === "create" ? "What was added" : row.action === "delete" ? "What was removed" : "What changed"}</div>
          <LogDetail log={row} />
        </div>
      ) : (
        CHANGE_ACTIONS.includes(row.action) &&
        row.success !== false && (
          <div className="text-muted mb-2" style={{ fontSize: "0.8rem" }}>
            No field-level details were recorded for this event.
          </div>
        )
      )}
      <dl className="al-detail-list">
        <DetailItem label="Time (IST)">
          {formatIst(row.createdAt)} <span className="text-muted">· {relativeTime(row.createdAt, now)}</span>
        </DetailItem>
        <DetailItem label="User">
          {row.actor?.name || (isSystemRow(row) ? "System" : "Unknown user")}
          {row.actor?.role ? (
            <div className="text-muted" style={{ fontSize: "0.76rem" }}>
              {row.actor.role}
            </div>
          ) : null}
        </DetailItem>
        <DetailItem label="Module">{moduleLabel(row)}</DetailItem>
        {row.label && <DetailItem label="Record">{row.label}</DetailItem>}
        {row.machineName && <DetailItem label="Machine">{row.machineName}</DetailItem>}
        {(row.method || row.path) && (
          <DetailItem label="Request" mono>
            {[row.method, row.path].filter(Boolean).join(" ")}
          </DetailItem>
        )}
        {row.statusCode ? (
          <DetailItem label="Status code" mono>
            {row.statusCode}
          </DetailItem>
        ) : null}
        <DetailItem label="Device">
          <DeviceCell row={row} />
        </DetailItem>
        <DetailItem label="IP address" mono>
          {friendlyIp(row.ip)}
        </DetailItem>
      </dl>
      <div className="d-flex flex-wrap gap-2 mt-3">
        {row.actor?.id && (
          <Button color="light" size="sm" className="border d-inline-flex align-items-center gap-2 al-act" onClick={() => onUser(row)}>
            <Users size={14} aria-hidden="true" /> Only this user
          </Button>
        )}
        {row.entity && (
          <Button color="light" size="sm" className="border d-inline-flex align-items-center gap-2 al-act" onClick={() => onRecord(row)}>
            <History size={14} aria-hidden="true" /> Record history
          </Button>
        )}
        <Button
          color="light"
          size="sm"
          className="border d-inline-flex align-items-center gap-2 al-act"
          onClick={async () => {
            if (await copyText(JSON.stringify(row, null, 2))) setCopied(true);
          }}
        >
          {copied ? <Check size={14} className="text-success" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied ? "Copied" : "Copy JSON"}
        </Button>
      </div>
    </div>
  );
};

const markerFor = (row, open) => {
  if (open) return "inset 3px 0 0 #6366f1";
  const tone = resultView(row).tone;
  if (tone === "red") return "inset 3px 0 0 #dc2626";
  if (tone === "amber") return "inset 3px 0 0 #d97706";
  return undefined;
};

const COLS = 8;

const LogRow = memo(function LogRow({ row, now, open, onToggle, onUser, onRecord, moduleLabel }) {
  const toggle = () => onToggle(row._id);
  return (
    <>
      <tr
        className={`al-row${open ? " al-row-open" : ""}`}
        onClick={toggle}
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <td style={{ boxShadow: markerFor(row, open), paddingRight: 0 }}>
          <ChevronRight size={15} className="text-muted al-chevron" aria-hidden="true" style={{ transform: open ? "rotate(90deg)" : "none" }} />
        </td>
        <td>
          <TimeCell row={row} now={now} />
        </td>
        <td>
          <UserCell row={row} onUser={onUser} />
        </td>
        <td>
          <ActionBadge action={row.action} />
        </td>
        <td style={{ fontSize: "0.82rem", overflowWrap: "break-word" }}>{moduleLabel(row)}</td>
        <td>
          <WhatCell row={row} onRecord={onRecord} />
        </td>
        <td>
          <ResultPill row={row} />
        </td>
        <td className="al-col-wide">
          <DeviceCell row={row} stacked />
          <div className="text-muted text-truncate" style={{ fontSize: "0.7rem", fontFamily: "var(--font-mono, ui-monospace, monospace)" }} title={row.ip || undefined}>
            {friendlyIp(row.ip)}
          </div>
        </td>
      </tr>
      {open && (
        <tr className="al-detail-row">
          <td colSpan={COLS}>
            <RowDetails row={row} now={now} moduleLabel={moduleLabel} onUser={onUser} onRecord={onRecord} />
          </td>
        </tr>
      )}
    </>
  );
});

const LogCard = memo(function LogCard({ row, now, open, onToggle, onUser, onRecord, moduleLabel }) {
  const toggle = () => onToggle(row._id);
  return (
    <div className={`al-card${open ? " al-card-open" : ""}`} style={{ boxShadow: markerFor(row, open) }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
          <ActionBadge action={row.action} />
          <TimeCell row={row} now={now} align="end" small />
        </div>
        <UserCell row={row} onUser={onUser} size={32} />
        <div className="mt-2">
          <WhatCell row={row} onRecord={onRecord} />
        </div>
        <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
          <ResultPill row={row} />
          <span className="text-muted" style={{ fontSize: "0.74rem" }}>
            {moduleLabel(row)}
          </span>
          <span className="ms-auto d-inline-flex align-items-center gap-1 text-muted" style={{ fontSize: "0.74rem" }}>
            {open ? "Hide details" : "Details"} <ChevronDown size={13} aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none" }} />
          </span>
        </div>
      </div>
      {open && <RowDetails row={row} now={now} moduleLabel={moduleLabel} onUser={onUser} onRecord={onRecord} />}
    </div>
  );
});

const SkeletonRows = ({ count = 8 }) => (
  <div aria-hidden="true">
    {Array.from({ length: count }, (_, i) => (
      <div key={i} className="d-flex align-items-center gap-3 px-3 py-3" style={{ borderBottom: "1px solid var(--panel-border)" }}>
        <div className="al-skel" style={{ width: 30, height: 30, borderRadius: "50%" }} />
        <div className="flex-grow-1">
          <div className="al-skel" style={{ width: "40%" }} />
          <div className="al-skel mt-2" style={{ width: "70%", height: 8 }} />
        </div>
        <div className="al-skel" style={{ width: 64, height: 18, borderRadius: 999 }} />
      </div>
    ))}
  </div>
);

const StateCard = ({ icon: Icon, tone = "#6366f1", title, children, action }) => (
  <div className="text-center px-3 py-5">
    <div className="d-inline-flex align-items-center justify-content-center mb-3" style={{ width: 56, height: 56, borderRadius: 16, background: `${tone}1f`, color: tone }}>
      <Icon size={26} aria-hidden="true" />
    </div>
    <div className="fw-semibold" style={{ fontSize: "1rem", color: "var(--panel-text)" }}>
      {title}
    </div>
    {children && (
      <div className="text-muted mx-auto mt-1" style={{ fontSize: "0.85rem", maxWidth: 440 }}>
        {children}
      </div>
    )}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

const StatTile = ({ icon: Icon, label, value, color, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className="al-tile text-start"
    style={{
      border: active ? `1.5px solid ${color}` : "1px solid var(--panel-border)",
      boxShadow: active ? `0 4px 14px ${color}33` : "0 1px 2px rgba(15,23,42,.04)",
      background: active ? `linear-gradient(0deg, ${color}14, ${color}14), var(--panel-bg)` : "var(--panel-bg)",
    }}
  >
    <span className="d-flex align-items-center justify-content-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 10, background: `linear-gradient(135deg, ${color}22, ${color}11)`, color }}>
      <Icon size={17} aria-hidden="true" />
    </span>
    <span style={{ minWidth: 0 }}>
      <span className="d-block text-muted" style={{ fontSize: "0.64rem", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", lineHeight: 1.3 }}>
        {label}
      </span>
      <span className="d-block fw-bold" style={{ fontSize: "1.3rem", color: "var(--panel-text)", lineHeight: 1.15 }}>
        {value}
      </span>
    </span>
  </button>
);

/* ── 14-day chart (plain CSS stacked bars) ───────────────────────────────────────────────────────── */

const ActivityChart = ({ days, activeDay, onPickDay }) => {
  const max = Math.max(1, ...days.map((d) => d.total));
  const order = [...KNOWN_ACTIONS, ...new Set(days.flatMap((d) => Object.keys(d.actions || {})).filter((a) => !KNOWN_ACTIONS.includes(a)))];
  const present = order.filter((a) => days.some((d) => d.actions?.[a]));
  const dotOf = (a) => (ACTION_STYLE[a] || ACTION_STYLE.other).dot;
  return (
    <div>
      <div className="al-chart" role="group" aria-label="Events per day, last 14 days">
        {days.map((d) => {
          const active = activeDay === d.day;
          const tip = `${shortDay(d.day)}: ${fmtNum(d.total)} events${d.total ? ` — ${present.filter((a) => d.actions?.[a]).map((a) => `${actionLabel(a)} ${fmtNum(d.actions[a])}`).join(", ")}` : ""}`;
          return (
            <button key={d.day} type="button" className={`al-bar-col${active ? " al-bar-active" : ""}`} title={tip} aria-label={tip} aria-pressed={active} onClick={() => onPickDay(d.day)}>
              <span className="al-bar-count">{d.total ? fmtNum(d.total) : ""}</span>
              <span className="al-bar" style={{ height: `${Math.max(d.total ? 3 : 0, (d.total / max) * 100)}%` }}>
                {present.map((a) => (d.actions?.[a] ? <span key={a} style={{ flexGrow: d.actions[a], background: dotOf(a) }} /> : null))}
              </span>
              <span className="al-bar-day">{shortDay(d.day).split(" ")[0]}</span>
            </button>
          );
        })}
      </div>
      {present.length > 0 && (
        <div className="d-flex flex-wrap gap-3 mt-2" aria-hidden="true">
          {present.map((a) => (
            <span key={a} className="d-inline-flex align-items-center gap-1 text-muted" style={{ fontSize: "0.72rem" }}>
              <span className="al-dot" style={{ background: dotOf(a) }} /> {actionLabel(a)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

const BarList = ({ items, onPick, activeKey, empty }) => {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length)
    return (
      <div className="text-muted" style={{ fontSize: "0.8rem" }}>
        {empty}
      </div>
    );
  return (
    <div className="d-flex flex-column gap-1">
      {items.map((i) => (
        <button key={i.key} type="button" className="al-barlist-row" aria-pressed={activeKey === i.key} title={`Show only ${i.label}`} onClick={() => onPick(i)}>
          <span className="al-barlist-fill" style={{ width: `${(i.count / max) * 100}%`, background: "rgba(99,102,241,.16)" }} />
          <span className="al-barlist-text text-truncate">
            {i.label}
            {i.sub ? <span className="text-muted"> · {i.sub}</span> : null}
          </span>
          <span className="al-barlist-count">{fmtNum(i.count)}</span>
        </button>
      ))}
    </div>
  );
};

const Pager = ({ page, pages, onChange }) => {
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  return (
    <div className="d-flex flex-wrap align-items-center justify-content-center gap-1 px-3 py-3" style={{ borderTop: "1px solid var(--panel-border)" }}>
      <button type="button" className="al-chip al-chip-sm" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page">
        <ChevronLeft size={13} aria-hidden="true" />
      </button>
      {nums.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && p - nums[i - 1] > 1 && <span className="text-muted px-1">…</span>}
          <button type="button" className="al-chip al-chip-sm" aria-current={p === page ? "page" : undefined} style={p === page ? { borderColor: "#6366f1", background: "#6366f122" } : undefined} onClick={() => onChange(p)}>
            {p}
          </button>
        </React.Fragment>
      ))}
      <button type="button" className="al-chip al-chip-sm" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Next page">
        <ChevronRight size={13} aria-hidden="true" />
      </button>
    </div>
  );
};

/* ── The page ────────────────────────────────────────────────────────────────────────────────────── */

const Logs = () => {
  const toast = useAlert();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  useEffect(() => {
    document.title = `Logs | ${window.localStorage.getItem("companyName") || import.meta.env.VITE_APP_NAME || "OEE"}`;
  }, []);

  // Every change of a filter starts again from page 1; only a page change keeps its own page.
  const update = useCallback((patch) => setSearchParams((prev) => patchParams(prev, "page" in patch ? patch : { ...patch, page: 1 }), { replace: true }), [setSearchParams]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const [live, setLive] = useState(true);
  const rangeInvalid = !!(filters.from && filters.to && filters.from > filters.to);
  const recordMode = !!(filters.entity || (filters.sheet && filters.date));
  const params = useMemo(() => apiFilters(filters), [filters]);
  const canPoll = live && filters.page === 1 && filters.sort === "newest";
  const listQuery = useQuery({
    queryKey: ["logs", params, filters.page, filters.limit],
    queryFn: async () => (await getAuditTrail(params, { skip: (filters.page - 1) * filters.limit, limit: filters.limit }))?.data || {},
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
    staleTime: 0,
    refetchInterval: canPoll ? 30000 : false,
    refetchIntervalInBackground: false,
    retry: (count, err) => err?.response?.status !== 403 && count < 1,
  });
  const summaryQuery = useQuery({
    queryKey: ["logsSummary"],
    queryFn: async () => (await getAuditTrailSummary())?.data?.data || null,
    staleTime: 0,
    refetchInterval: live ? 60000 : false,
    retry: (count, err) => err?.response?.status !== 403 && count < 1,
  });
  const filtersQuery = useQuery({
    queryKey: ["logsFilters"],
    queryFn: async () => (await getAuditTrailFilters())?.data?.data || {},
    staleTime: 60 * 1000,
    retry: (count, err) => err?.response?.status !== 403 && count < 1,
  });
  const denied = [listQuery, summaryQuery, filtersQuery].some((q) => q.error?.response?.status === 403);

  const data = rangeInvalid ? { data: [], total: 0, stats: {} } : listQuery.data;
  const rows = useMemo(() => (Array.isArray(data?.data) ? data.data : []), [data]);
  const total = data?.total || 0;
  const stats = data?.stats || {};
  const pages = Math.max(1, Math.ceil(total / filters.limit));
  const loadingFirst = listQuery.isLoading && !data;
  const dim = listQuery.isFetching && listQuery.isPlaceholderData;
  const listError = listQuery.isError && !denied ? listQuery.error?.response?.data?.message || listQuery.error?.message || "Could not load the logs." : null;

  // A page past the end (a stale link, the last rows filtered away): step back to the last real page.
  useEffect(() => {
    if (!data || listQuery.isPlaceholderData) return;
    if (filters.page > pages) update({ page: pages });
  }, [data, filters.page, pages, listQuery.isPlaceholderData, update]);

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["logs"] });
    queryClient.invalidateQueries({ queryKey: ["logsSummary"] });
    queryClient.invalidateQueries({ queryKey: ["logsFilters"] });
  }, [queryClient]);

  /* ── search box: typed locally, written to the address 400 ms after the last keystroke ── */
  const [searchText, setSearchText] = useState(filters.q);
  useEffect(() => {
    const text = searchText.trim();
    if (text === filters.q) return undefined;
    const t = setTimeout(() => update({ q: text }), text ? 400 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);
  useEffect(() => {
    setSearchText((cur) => (cur.trim() === filters.q ? cur : filters.q));
  }, [filters.q]);

  /* ── options ── */
  const actors = useMemo(() => (Array.isArray(filtersQuery.data?.actors) ? filtersQuery.data.actors : []), [filtersQuery.data]);
  const moduleOptions = useMemo(() => (filtersQuery.data?.modules || []).map((m) => ({ value: m.key, label: m.label })), [filtersQuery.data]);
  const moduleLabelOf = useMemo(() => Object.fromEntries(moduleOptions.map((m) => [m.value, m.label])), [moduleOptions]);
  const moduleLabel = useCallback((row) => row.module || moduleLabelOf[row.entityType] || row.entityType || "—", [moduleLabelOf]);
  const actionOptions = useMemo(() => {
    const fromServer = (filtersQuery.data?.actions || []).map((a) => a.key);
    return [...new Set([...fromServer, ...KNOWN_ACTIONS])].map((a) => ({ value: a, label: actionLabel(a) }));
  }, [filtersQuery.data]);
  const userLabel = useMemo(() => {
    if (!filters.user) return "";
    const u = actors.find((x) => String(x.id) === filters.user) || rows.find((r) => String(r.actor?.id) === filters.user)?.actor;
    return u?.name || "Selected user";
  }, [filters.user, actors, rows]);

  const filterByUser = useCallback((row) => row?.actor?.id && update({ user: String(row.actor.id) }), [update]);
  const openRecord = useCallback((row) => row?.entity && update({ entity: String(row.entity), sheet: "", date: "", machine: "", from: "", to: "" }), [update]);

  /* ── quick filters ── */
  const presets = useMemo(() => buildPresets(now), [now]);
  const activePreset = presets.find((p) => p.from === filters.from && (p.to === filters.to || (!filters.to && p.to === p.from)))?.key || "";
  const today = istDay(now);
  const weekFrom = istDay(now, -6);
  const isToday = filters.from === today && (filters.to === today || !filters.to);
  const isWeek = filters.from === weekFrom && filters.to === today;
  const s = summaryQuery.data;
  // Each tile is a quick filter: click to show just those rows, click again to go back to everything.
  const OFF = { from: "", to: "", action: [], module: [], status: [], views: "" };
  const quick = (key, on, patch) => ({ key, on, apply: (active) => update(active ? OFF : { ...OFF, ...patch }) });
  const tiles = [
    { icon: Zap, label: "Events today", value: s?.todayActions, color: "#6366f1", ...quick("today", isToday && !filters.action.length && !filters.module.length && !filters.status.length && filters.views === "0", { from: today, to: today, views: "0" }) },
    { icon: Users, label: "Active users today", value: s?.activeUsersToday, color: "#0ea5e9", ...quick("users", false, { from: today, to: today }) },
    { icon: LogIn, label: "Sign-ins today", value: s?.loginsToday, color: "#16a34a", ...quick("logins", isToday && sameList(filters.action, ["login"]), { from: today, to: today, action: ["login"] }) },
    { icon: Eye, label: "Pages opened today", value: s?.viewsToday, color: "#818cf8", ...quick("views", isToday && sameList(filters.action, ["view"]), { from: today, to: today, action: ["view"] }) },
    { icon: ShieldAlert, label: "Failed sign-ins · 7 days", value: s?.failedLogins7d, color: "#e11d48", ...quick("failed", isWeek && sameList(filters.action, ["loginFailed"]), { from: weekFrom, to: today, action: ["loginFailed"] }) },
    { icon: Bug, label: "Errors & failures · 7 days", value: s?.errors7d, color: "#b91c1c", ...quick("errors", isWeek && sameList(filters.status, ["failed"]) && !filters.action.length, { from: weekFrom, to: today, status: ["failed"] }) },
    { icon: Pencil, label: "Changes · 7 days", value: s?.changes7d, color: "#d97706", ...quick("changes", isWeek && sameList(filters.action, CHANGE_ACTIONS), { from: weekFrom, to: today, action: CHANGE_ACTIONS }) },
    { icon: Archive, label: "Backups · 7 days", value: s?.backups7d, color: "#0f766e", ...quick("backups", isWeek && sameList(filters.module, ["backup"]), { from: weekFrom, to: today, module: ["backup"] }) },
  ];

  /* ── filter helpers ── */
  const hasActive = !!(filters.q || filters.user || filters.action.length || filters.module.length || filters.status.length || filters.client.length || filters.from || filters.to || filters.views || recordMode);
  // How many filter groups are in force — the number on the Filters button.
  const activeCount = [filters.user, filters.action.length, filters.module.length, filters.status.length, filters.client.length, filters.from || filters.to, filters.views].filter(Boolean).length;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const clearAll = () => {
    setSearchText("");
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        FILTER_KEYS.forEach((k) => next.delete(k));
        next.delete("actor");
        return next;
      },
      { replace: true },
    );
  };
  const chips = [];
  const listValue = (list, options, noun) => (list.length === 1 ? options.find((o) => o.value === list[0])?.label || list[0] : `${list.length} ${noun}s`);
  if (filters.user) chips.push({ key: "user", label: "User", value: userLabel, clear: () => update({ user: "" }) });
  if (filters.action.length) chips.push({ key: "action", label: "Action", value: listValue(filters.action, actionOptions, "action"), clear: () => update({ action: [] }) });
  if (filters.module.length) chips.push({ key: "module", label: "Module", value: listValue(filters.module, moduleOptions, "module"), clear: () => update({ module: [] }) });
  if (filters.status.length) chips.push({ key: "status", label: "Result", value: listValue(filters.status, STATUS_OPTIONS, "result"), clear: () => update({ status: [] }) });
  if (filters.client.length) chips.push({ key: "client", label: "Source", value: listValue(filters.client, SOURCE_OPTIONS, "source"), clear: () => update({ client: [] }) });
  if (filters.views === "0") chips.push({ key: "views", label: "Pages opened", value: "hidden", clear: () => update({ views: "" }) });
  if (filters.from || filters.to) {
    const preset = presets.find((p) => p.key === activePreset);
    const value = preset ? preset.label : filters.from === filters.to || !filters.to ? shortDay(filters.from) : `${filters.from ? shortDay(filters.from) : "…"} – ${filters.to ? shortDay(filters.to) : "…"}`;
    chips.push({ key: "date", label: "Date", value, clear: () => update({ from: "", to: "" }) });
  }

  /* ── expand / paging ── */
  const [openIds, setOpenIds] = useState(() => new Set());
  const toggleRow = useCallback((id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const listRef = useRef(null);
  const goToPage = (p) => {
    update({ page: p });
    listRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  /* ── export ── */
  const [exporting, setExporting] = useState(false);
  const runExport = async () => {
    setExporting(true);
    try {
      await exportAuditTrailCsv(params);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Could not export the logs. Try again.");
    } finally {
      setExporting(false);
    }
  };

  /* ── breakdowns ── */
  const topUsers = (stats.topUsers || []).map((u) => ({ key: String(u.id), label: u.name || "Unknown", sub: u.role, count: u.count }));
  const topModules = Object.entries(stats.modules || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([m, n]) => ({ key: m, label: moduleLabelOf[m] || m, count: n }));
  const actionChips = Object.entries(stats.actions || {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const days = s?.days || [];
  const chartDay = filters.from && (filters.to === filters.from || !filters.to) ? filters.from : "";
  const firstRow = total === 0 ? 0 : (Math.min(filters.page, pages) - 1) * filters.limit + 1;
  const lastRow = total === 0 ? 0 : firstRow + rows.length - 1;

  if (denied) {
    return (
      <div className="page-content al-root">
        <style>{PAGE_CSS}</style>
        <Container fluid>
          <Card className="mb-0 al-panel">
            <StateCard icon={Lock} tone="#dc2626" title="You don't have access to this page">
              Ask the Super Admin to tick “Logs” for your role in Manage Role.
            </StateCard>
          </Card>
        </Container>
      </div>
    );
  }

  return (
    <div className="page-content al-root">
      <style>{PAGE_CSS}</style>
      <Container fluid>
        {/* Header */}
        <div className="al-head mb-3">
          <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
            <div className="al-head-icon">
              <Activity size={19} color="#fff" aria-hidden="true" />
            </div>
            <div style={{ minWidth: 0 }}>
              <h5 className="mb-0" style={{ color: "var(--panel-text)", fontWeight: 800 }}>
                Logs
              </h5>
              <div style={{ fontSize: "0.78rem", color: "var(--panel-text-muted)" }}>Everything that happens in the app — every change, sign-in, setting and backup, with what changed</div>
            </div>
          </div>
          <div className="d-flex flex-wrap align-items-center gap-2">
            {listQuery.dataUpdatedAt ? (
              <span className="text-muted d-none d-md-inline" style={{ fontSize: "0.76rem" }}>
                Updated {formatIstTimeOnly(listQuery.dataUpdatedAt)} IST
              </span>
            ) : null}
            <button
              type="button"
              className={`al-chip${live ? " al-live-on" : ""}`}
              aria-pressed={live}
              onClick={() => setLive((v) => !v)}
              title={live ? "Refreshes itself every 30 seconds — click to pause" : "Paused — click to refresh on its own again"}
            >
              <Radio size={13} aria-hidden="true" /> {live ? "Live" : "Paused"}
            </button>
            <Button color="light" className="border d-inline-flex align-items-center gap-2 al-act" onClick={refreshAll} disabled={listQuery.isFetching}>
              <RefreshCw size={14} className={listQuery.isFetching ? "al-spin" : undefined} aria-hidden="true" /> Refresh
            </Button>
          </div>
        </div>

        {/* Stat tiles — each one is also a quick filter */}
        <div className="al-stats mb-3" role="group" aria-label="Summary">
          {tiles.map((t) => (
            <StatTile key={t.key} icon={t.icon} label={t.label} value={s ? fmtNum(t.value) : "…"} color={t.color} active={t.on} onClick={() => t.apply(t.on)} />
          ))}
        </div>

        {/* Chart + breakdowns */}
        <div className="al-insights mb-3">
          <Card className="mb-0 al-panel p-3">
            <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
              <span className="al-panel-title">
                <CalendarDays size={15} aria-hidden="true" /> Activity, last 14 days
              </span>
              {chartDay && (
                <button type="button" className="al-mini-link" onClick={() => update({ from: "", to: "" })}>
                  Show all days
                </button>
              )}
            </div>
            {summaryQuery.isLoading ? <div className="al-skel" style={{ height: 150, borderRadius: 10 }} /> : <ActivityChart days={days} activeDay={chartDay} onPickDay={(day) => update(chartDay === day ? { from: "", to: "" } : { from: day, to: day })} />}
          </Card>
          <Card className="mb-0 al-panel p-3">
            <div className="al-panel-title mb-2">
              <Users size={15} aria-hidden="true" /> Top users
            </div>
            {loadingFirst ? <div className="al-skel" style={{ height: 150, borderRadius: 10 }} /> : <BarList items={topUsers} activeKey={filters.user} empty="No signed-in activity matches these filters." onPick={(i) => update({ user: filters.user === i.key ? "" : i.key })} />}
          </Card>
          <Card className="mb-0 al-panel p-3">
            <div className="al-panel-title mb-2">
              <LayoutGrid size={15} aria-hidden="true" /> Top modules
            </div>
            {loadingFirst ? (
              <div className="al-skel" style={{ height: 150, borderRadius: 10 }} />
            ) : (
              <BarList items={topModules} activeKey={filters.module.length === 1 ? filters.module[0] : ""} empty="Nothing matches these filters." onPick={(i) => update({ module: filters.module.length === 1 && filters.module[0] === i.key ? [] : [i.key] })} />
            )}
            {actionChips.length > 0 && (
              <div className="d-flex flex-wrap gap-1 mt-3" aria-label="Actions in these results">
                {actionChips.map(([a, n]) => {
                  const on = filters.action.includes(a);
                  const dot = (ACTION_STYLE[a] || ACTION_STYLE.other).dot;
                  return (
                    <button
                      key={a}
                      type="button"
                      className="al-chip al-chip-sm"
                      aria-pressed={on}
                      style={on ? { borderColor: dot, background: `${dot}22` } : undefined}
                      onClick={() => update({ action: toggleIn(filters.action, a) })}
                      title={on ? `Stop filtering by ${actionLabel(a)}` : `Show only ${actionLabel(a)}`}
                    >
                      <span className="al-dot" style={{ background: dot }} /> {actionLabel(a)} <span className="al-count">{fmtNum(n)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Record timeline banner */}
        {recordMode && (
          <div className="al-timeline-banner mb-3" role="status">
            <History size={16} aria-hidden="true" />
            <span style={{ minWidth: 0 }}>
              Full history of <strong className="text-break">{rows[0]?.label || "this record"}</strong>
            </span>
            <button type="button" className="al-mini-link ms-auto" onClick={() => update({ entity: "", sheet: "", date: "", machine: "" })}>
              <X size={13} aria-hidden="true" /> Back to all activity
            </button>
          </div>
        )}

        {/* Search + filters + export */}
        <Card className="mb-3 al-panel" style={{ overflow: "visible" }}>
          <div className="p-2 p-sm-3">
            <div className="al-toolbar">
              <div className="position-relative al-search">
                <Search size={14} className="text-muted" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", zIndex: 1 }} aria-hidden="true" />
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search record, user, value, remark, page or IP"
                  aria-label="Search the logs"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="form-control form-control-sm al-input"
                  style={{ paddingLeft: 32, paddingRight: searchText ? 34 : undefined }}
                />
                {searchText && (
                  <button type="button" className="al-input-clear" aria-label="Clear search" onClick={() => setSearchText("")}>
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
              <button
                type="button"
                className={`al-filter-btn${filtersOpen ? " al-filter-btn-open" : ""}`}
                aria-expanded={filtersOpen}
                aria-controls="al-filter-panel"
                onClick={() => setFiltersOpen((o) => !o)}
              >
                <SlidersHorizontal size={14} aria-hidden="true" /> Filters
                {activeCount > 0 && <span className="al-filter-count">{activeCount}</span>}
                <ChevronDown size={14} aria-hidden="true" style={{ transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform .15s ease" }} />
              </button>
              {hasActive && (
                <button type="button" className="al-chip" onClick={clearAll}>
                  <FilterX size={13} aria-hidden="true" /> Clear filters
                </button>
              )}
              <Button color="light" className="border d-inline-flex align-items-center gap-2 al-act" onClick={runExport} disabled={exporting || rangeInvalid || total === 0} title="Download the filtered events as a CSV file (up to 10,000 rows)">
                <Download size={14} className={exporting ? "al-spin" : undefined} aria-hidden="true" /> {exporting ? "Exporting…" : "Export CSV"}
              </Button>
            </div>

            {filtersOpen && (
              <div id="al-filter-panel" className="al-filter-panel">
                <div className="al-label">Date</div>
                <div className="d-flex flex-wrap gap-1 mb-2" role="group" aria-label="Date">
                  {presets.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className="al-chip al-chip-sm"
                      aria-pressed={activePreset === p.key}
                      style={activePreset === p.key ? { borderColor: "#6366f1", background: "#6366f122" } : undefined}
                      onClick={() => update(activePreset === p.key ? { from: "", to: "" } : { from: p.from, to: p.to })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="al-filter-grid">
                  <Field label="From" htmlFor="al-from">
                    <input id="al-from" type="date" className="form-control form-control-sm al-input" value={filters.from} max={filters.to || undefined} onChange={(e) => update({ from: e.target.value })} />
                  </Field>
                  <Field label="To" htmlFor="al-to">
                    <input id="al-to" type="date" className="form-control form-control-sm al-input" value={filters.to} min={filters.from || undefined} onChange={(e) => update({ to: e.target.value })} />
                  </Field>
                  <Field label="User" htmlFor="al-user">
                    <div className="position-relative">
                      <UserRound size={14} className="text-muted" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} aria-hidden="true" />
                      <select id="al-user" className="form-select form-select-sm al-input" style={{ paddingLeft: 30 }} value={filters.user} onChange={(e) => update({ user: e.target.value })}>
                        <option value="">All users</option>
                        {actors.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                            {u.role ? ` (${u.role})` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </Field>
                  <Field label="Action" htmlFor="al-action">
                    <MultiPick id="al-action" noun="Action" icon={Zap} options={actionOptions} value={filters.action} onChange={(next) => update({ action: next })} />
                  </Field>
                  <Field label="Module" htmlFor="al-module">
                    <MultiPick id="al-module" noun="Module" icon={LayoutGrid} options={moduleOptions} value={filters.module} onChange={(next) => update({ module: next })} />
                  </Field>
                  <Field label="Result" htmlFor="al-status">
                    <MultiPick id="al-status" noun="Result" icon={Check} options={STATUS_OPTIONS} value={filters.status} onChange={(next) => update({ status: next })} />
                  </Field>
                  <Field label="Source" htmlFor="al-client">
                    <MultiPick id="al-client" noun="Source" icon={Monitor} options={SOURCE_OPTIONS} value={filters.client} onChange={(next) => update({ client: next })} />
                  </Field>
                  <Field label="Pages opened" htmlFor="al-views">
                    <label className="al-switch" htmlFor="al-views">
                      <input id="al-views" type="checkbox" className="form-check-input m-0" checked={filters.views !== "0"} onChange={(e) => update({ views: e.target.checked ? "" : "0" })} />
                      <span>{filters.views === "0" ? "Hidden" : "Shown"}</span>
                    </label>
                  </Field>
                </div>
                <div className="d-flex justify-content-end mt-2">
                  <button type="button" className="al-mini-link" onClick={() => setFiltersOpen(false)}>
                    Done
                  </button>
                </div>
              </div>
            )}

            {rangeInvalid && (
              <div className="d-flex align-items-center gap-2 mt-2" role="alert" style={{ fontSize: "0.8rem", color: "#dc2626" }}>
                <TriangleAlert size={14} aria-hidden="true" /> The start date is after the end date, so nothing can match.
              </div>
            )}
            {chips.length > 0 && (
              <div className="d-flex flex-wrap align-items-center gap-2 mt-2" aria-label="Filters applied">
                {chips.map((c) => (
                  <span key={c.key} className="al-active-chip">
                    <span className="text-muted">{c.label}:</span> <strong>{c.value}</strong>
                    <button type="button" aria-label={`Remove ${c.label} filter`} title={`Remove ${c.label} filter`} onClick={c.clear}>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Results */}
        <Card className="mb-0 al-panel" style={{ overflow: "hidden" }} innerRef={listRef}>
          <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--panel-border)" }}>
            <span style={{ fontSize: "0.85rem", fontWeight: 600 }} role="status" aria-live="polite">
              {data ? (total === 0 ? "No events" : `Showing ${fmtNum(firstRow)}–${fmtNum(lastRow)} of ${fmtNum(total)} ${total === 1 ? "event" : "events"}`) : listError ? "Could not load events" : "Loading events…"}
              {data && stats.uniqueUsers ? (
                <span className="text-muted fw-normal">
                  {" "}
                  · {fmtNum(stats.uniqueUsers)} {stats.uniqueUsers === 1 ? "person" : "people"}
                </span>
              ) : null}
              {data && stats.failed ? <span className="fw-normal" style={{ color: "#dc2626" }}> · {fmtNum(stats.failed)} failed</span> : null}
            </span>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <button type="button" className="al-chip" onClick={() => update({ sort: filters.sort === "newest" ? "oldest" : "newest" })} title="Change the order of the list">
                {filters.sort === "newest" ? <ArrowDown size={13} aria-hidden="true" /> : <ArrowUp size={13} aria-hidden="true" />}
                {filters.sort === "newest" ? "Newest first" : "Oldest first"}
              </button>
              <label className="d-inline-flex align-items-center gap-2 mb-0" htmlFor="al-page-size" style={{ fontSize: "0.78rem" }}>
                <span className="text-muted">Per page</span>
                <select id="al-page-size" className="form-select form-select-sm al-input" style={{ width: "auto", minWidth: 70 }} value={filters.limit} onChange={(e) => update({ limit: parseInt(e.target.value, 10) })}>
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {listError ? (
            <StateCard
              icon={TriangleAlert}
              tone="#dc2626"
              title="Could not load the logs"
              action={
                <Button color="light" className="border d-inline-flex align-items-center gap-2 al-act" onClick={() => listQuery.refetch()}>
                  <RefreshCw size={14} aria-hidden="true" /> Retry
                </Button>
              }
            >
              {listError}
            </StateCard>
          ) : loadingFirst ? (
            <SkeletonRows />
          ) : rows.length === 0 ? (
            <StateCard
              icon={hasActive ? FilterX : Activity}
              title={recordMode ? "No changes recorded for this record yet" : hasActive ? "Nothing matches these filters" : "Nothing has been recorded yet"}
              action={
                hasActive ? (
                  <button type="button" className="al-chip" onClick={clearAll}>
                    <FilterX size={13} aria-hidden="true" /> Clear filters
                  </button>
                ) : null
              }
            >
              {recordMode ? "Changes made from now on are listed here." : hasActive ? "Try a wider date range, another user, or fewer filters." : "Changes, sign-ins and backups show up here as people use the app."}
            </StateCard>
          ) : (
            <div className="al-results-body" style={{ opacity: dim ? 0.6 : 1, transition: "opacity .15s" }}>
              <div className="al-view-table">
                <Table hover className="mb-0 align-middle al-table">
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: "16%" }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 130 }} />
                    <col />
                    <col style={{ width: 100 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="visually-hidden">Details</span>
                      </th>
                      <th scope="col">Time (IST)</th>
                      <th scope="col">User</th>
                      <th scope="col">Action</th>
                      <th scope="col">Module</th>
                      <th scope="col">What happened</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="al-col-wide">
                        Device · IP
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <LogRow key={row._id} row={row} now={now} open={openIds.has(row._id)} onToggle={toggleRow} onUser={filterByUser} onRecord={openRecord} moduleLabel={moduleLabel} />
                    ))}
                  </tbody>
                </Table>
              </div>
              <div className="al-view-cards">
                {rows.map((row) => (
                  <LogCard key={row._id} row={row} now={now} open={openIds.has(row._id)} onToggle={toggleRow} onUser={filterByUser} onRecord={openRecord} moduleLabel={moduleLabel} />
                ))}
              </div>
              <Pager page={Math.min(filters.page, pages)} pages={pages} onChange={goToPage} />
            </div>
          )}
        </Card>
        <div className="text-muted mt-2 d-flex align-items-center gap-1" style={{ fontSize: "0.72rem" }}>
          <Clock size={11} aria-hidden="true" /> Times are IST. Passwords, codes and tokens are never recorded — only that they changed. Logs can't be edited or deleted.
        </div>
      </Container>
    </div>
  );
};

/* ── Styles that cannot be inline (pseudo-classes, media / container queries) ────────────────────── */

const PAGE_CSS = `
.al-root .al-panel { border-radius:14px; border:1px solid var(--panel-border); background:var(--panel-bg); }
.al-root .al-head { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-radius:16px; background:var(--panel-bg); border:1px solid var(--panel-border); box-shadow:0 1px 3px rgba(15,23,42,.04); }
.al-root .al-head-icon { width:40px; height:40px; border-radius:12px; background:linear-gradient(135deg,#4f46e5,#6366f1); display:flex; align-items:center; justify-content:center; flex-shrink:0; }
.al-root .al-panel-title { display:inline-flex; align-items:center; gap:6px; font-size:.82rem; font-weight:700; color:var(--panel-text); }
.al-root .al-label { display:block; margin:0 0 4px; font-size:.68rem; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:var(--panel-text-muted); }
.al-root .al-field { min-width:0; }
.al-root .al-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
.al-root .al-search { flex:1 1 240px; min-width:0; }
.al-root .al-filter-grid { display:grid; gap:10px; grid-template-columns:repeat(2, minmax(0,1fr)); }
@media (min-width:768px) { .al-root .al-filter-grid { grid-template-columns:repeat(4, minmax(0,1fr)); } }
.al-root .al-filter-btn { display:inline-flex; align-items:center; gap:6px; min-height:38px; padding:4px 12px; border-radius:8px; border:1px solid var(--panel-border); background:var(--panel-bg-subtle); color:var(--panel-text); font-size:.84rem; font-weight:600; }
.al-root .al-filter-btn:hover, .al-root .al-filter-btn-open { border-color:#6366f1; }
.al-root .al-filter-count { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px; padding:0 6px; border-radius:999px; background:#6366f1; color:#fff; font-size:.7rem; font-weight:700; }
.al-root .al-filter-panel { margin-top:10px; padding:12px; border-radius:12px; border:1px solid var(--panel-border); background:var(--panel-bg-subtle); }
.al-root .al-switch { display:flex; align-items:center; gap:8px; min-height:38px; margin:0; font-size:.84rem; color:var(--panel-text); cursor:pointer; }
.al-root .al-pick { display:flex; align-items:center; justify-content:space-between; gap:6px; width:100%; min-height:38px; padding:4px 10px; border-radius:8px; border:1px solid var(--bs-border-color, var(--panel-border)); background:var(--bs-body-bg, var(--panel-bg)); color:var(--panel-text); font-size:.84rem; text-align:left; }
.al-root .al-menu { position:absolute; z-index:30; top:calc(100% + 4px); left:0; min-width:100%; width:max-content; max-width:300px; padding:8px; border-radius:10px; border:1px solid var(--panel-border); background:var(--panel-bg); box-shadow:0 10px 30px rgba(15,23,42,.14); }
.al-root .al-menu-row { display:flex; align-items:center; gap:8px; padding:5px 8px; border-radius:6px; font-size:.8rem; color:var(--panel-text); cursor:pointer; margin:0; }
.al-root .al-menu-row:hover { background:var(--panel-bg-subtle); }
.al-root .al-active-chip { display:inline-flex; align-items:center; gap:4px; max-width:100%; padding:3px 4px 3px 10px; border-radius:999px; border:1px solid var(--panel-border); background:var(--panel-bg-subtle); color:var(--panel-text); font-size:.76rem; }
.al-root .al-active-chip strong { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:220px; }
.al-root .al-active-chip button { display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border:0; border-radius:999px; background:transparent; color:var(--panel-text-muted); padding:0; }
.al-root .al-active-chip button:hover { background:var(--panel-border); color:var(--panel-text); }
.al-root .al-input { min-height:38px; font-size:.84rem; border-radius:8px; }
.al-root .al-act { min-height:36px; }
.al-root .al-input-clear { position:absolute; right:4px; top:50%; transform:translateY(-50%); width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border:0; background:transparent; color:var(--panel-text-muted); border-radius:6px; }
.al-root .al-input-clear:hover { background:var(--panel-border); color:var(--panel-text); }
.al-root .al-stats { display:grid; gap:10px; grid-template-columns:repeat(2, minmax(0,1fr)); }
@media (min-width:768px) { .al-root .al-stats { grid-template-columns:repeat(4, minmax(0,1fr)); } }
@media (min-width:1200px) { .al-root .al-stats { grid-template-columns:repeat(4, minmax(0,1fr)); } }
.al-root .al-tile { display:flex; align-items:center; gap:12px; width:100%; height:100%; padding:12px 14px; border-radius:12px; transition:box-shadow .15s ease, border-color .15s ease; }
.al-root .al-tile:hover { box-shadow:0 4px 12px rgba(15,23,42,.08) !important; }
.al-root .al-insights { display:grid; gap:12px; grid-template-columns:1fr; }
@media (min-width:768px) { .al-root .al-insights { grid-template-columns:1fr 1fr; } .al-root .al-insights > :first-child { grid-column:1 / -1; } }
@media (min-width:1200px) { .al-root .al-insights { grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr); } .al-root .al-insights > :first-child { grid-column:auto; } }
.al-root .al-chart { display:grid; grid-template-columns:repeat(14, minmax(0,1fr)); gap:4px; align-items:end; height:160px; }
.al-root .al-bar-col { display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; min-width:0; padding:0; border:0; background:transparent; border-radius:6px; cursor:pointer; color:var(--panel-text-muted); }
.al-root .al-bar-col:hover .al-bar, .al-root .al-bar-active .al-bar { outline:2px solid #6366f1; outline-offset:1px; }
.al-root .al-bar { display:flex; flex-direction:column-reverse; width:70%; max-width:28px; border-radius:5px 5px 2px 2px; overflow:hidden; background:var(--panel-border); }
.al-root .al-bar > span { display:block; min-height:2px; }
.al-root .al-bar-count { font-size:.62rem; font-weight:700; margin-bottom:2px; font-variant-numeric:tabular-nums; white-space:nowrap; }
.al-root .al-bar-day { font-size:.64rem; margin-top:4px; font-variant-numeric:tabular-nums; }
.al-root .al-bar-active .al-bar-day { color:var(--panel-text); font-weight:800; }
@media (max-width:420px) { .al-root .al-bar-count { display:none; } }
.al-root .al-barlist-row { position:relative; display:flex; align-items:center; gap:8px; width:100%; min-height:30px; padding:4px 8px; border:1px solid transparent; border-radius:8px; background:transparent; color:var(--panel-text); text-align:left; overflow:hidden; font-size:.8rem; }
.al-root .al-barlist-row:hover { border-color:var(--panel-border); }
.al-root .al-barlist-row[aria-pressed="true"] { border-color:#6366f1; }
.al-root .al-barlist-fill { position:absolute; left:0; top:0; bottom:0; border-radius:8px; pointer-events:none; }
.al-root .al-barlist-text { position:relative; flex:1 1 auto; min-width:0; }
.al-root .al-barlist-count { position:relative; font-weight:700; font-variant-numeric:tabular-nums; color:var(--panel-text-muted); }
.al-root .al-mini-link { display:inline-flex; align-items:center; gap:4px; border:0; background:transparent; padding:2px 4px; font-size:.76rem; font-weight:600; color:#4f46e5; border-radius:6px; }
.dark .al-root .al-mini-link { color:#a5b4fc; }
.al-root .al-mini-link:hover { text-decoration:underline; }
.al-root .al-timeline-banner { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:10px 14px; border-radius:12px; border:1px solid rgba(99,102,241,.35); background:rgba(99,102,241,.08); color:var(--panel-text); font-size:.84rem; }
.al-root .al-chip { display:inline-flex; align-items:center; gap:6px; min-height:32px; padding:4px 12px; border-radius:999px; border:1px solid var(--panel-border); background:var(--panel-bg-subtle); color:var(--panel-text); font-size:.76rem; font-weight:600; line-height:1.2; cursor:pointer; white-space:nowrap; }
.al-root .al-chip:disabled { opacity:.45; cursor:default; }
.al-root .al-chip-sm { min-height:28px; padding:3px 10px; font-size:.72rem; }
.al-root .al-chip:hover:not(:disabled) { background:var(--panel-border); }
.al-root .al-chip .al-count { color:var(--panel-text-muted); font-weight:700; font-variant-numeric:tabular-nums; }
.al-root .al-live-on { border-color:rgba(22,163,74,.5); color:#15803d; background:rgba(22,163,74,.1); }
.dark .al-root .al-live-on { color:#4ade80; }
.al-root .al-live-on svg { animation:al-pulse 1.6s ease-in-out infinite; }
.al-root .al-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; display:inline-block; }

.al-root .al-results-body { container-type:inline-size; }
.al-root .al-view-table { display:none; }
.al-root .al-view-cards { display:block; }
@container (min-width: 860px) {
  .al-root .al-view-table { display:block; }
  .al-root .al-view-cards { display:none; }
  .al-root .al-col-wide { display:none; }
}
@container (min-width: 1100px) {
  .al-root td.al-col-wide, .al-root th.al-col-wide { display:table-cell; }
}
.al-root .al-table { table-layout:fixed; width:100%; }
.al-root th.al-col-wide { width:140px; }
.al-root .al-table thead th { background:var(--panel-bg-subtle); font-size:.7rem; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:var(--panel-text-muted); white-space:nowrap; }
.al-root tr.al-row { cursor:pointer; }
.al-root tr.al-row:focus-visible { outline:2px solid #2563eb; outline-offset:-2px; }
.al-root tr.al-row-open > td { background-color:rgba(99,102,241,.07) !important; }
.al-root tr.al-detail-row > td { padding:0 !important; background:var(--panel-bg-subtle) !important; }
.al-root .al-chevron { transition:transform .15s ease; }
.al-root .al-link { display:block; max-width:100%; padding:0; border:0; background:none; font-size:.84rem; font-weight:600; color:var(--panel-text); text-align:left; }
.al-root .al-link:hover { color:#4f46e5; text-decoration:underline; }
.dark .al-root .al-link:hover { color:#a5b4fc; }
.al-root .al-target { display:inline-flex; align-items:center; gap:4px; max-width:100%; padding:1px 8px; border-radius:6px; background:var(--panel-bg-subtle); border:1px solid var(--panel-border); color:var(--panel-text); font-size:.76rem; font-weight:600; overflow:hidden; white-space:nowrap; }
.al-root .al-target-btn { cursor:pointer; }
.al-root .al-target-btn:hover { border-color:#6366f1; }
.al-root .al-change-count { font-size:.7rem; font-weight:700; color:#b45309; white-space:nowrap; }
.dark .al-root .al-change-count { color:#fbbf24; }

.al-root .al-card { padding:12px 16px; border-bottom:1px solid var(--panel-border); }
.al-root .al-card > [role="button"] { cursor:pointer; outline-offset:2px; border-radius:8px; }
.al-root .al-card-open { background:rgba(99,102,241,.05); }
.al-root .al-card .al-details { margin:12px -4px 0; border-radius:10px; border:1px solid var(--panel-border); }

.al-root .al-details { padding:14px 16px 16px 44px; color:var(--panel-text); cursor:default; }
@media (max-width:860px) { .al-root .al-details { padding:12px; } }
.al-root .al-changes { margin-bottom:14px; }
.al-root .al-detail-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px 16px; margin:0; }
.al-root .al-detail { min-width:0; margin:0; }
.al-root .al-detail dt { margin:0 0 3px; font-size:.66rem; font-weight:700; letter-spacing:.3px; text-transform:uppercase; color:var(--panel-text-muted); }
.al-root .al-detail dd { margin:0; font-size:.82rem; color:var(--panel-text); }

.al-root .al-skel { height:10px; border-radius:6px; background:var(--panel-border); animation:al-pulse 1.4s ease-in-out infinite; }
@keyframes al-pulse { 50% { opacity:.45; } }
@keyframes al-rotate { to { transform:rotate(360deg); } }
.al-root .al-spin { animation:al-rotate .9s linear infinite; }
@media (prefers-reduced-motion: reduce) { .al-root .al-skel, .al-root .al-spin, .al-root .al-live-on svg { animation:none; } }
@media (max-width:576px) {
  .al-root .al-input, .al-root .al-pick, .al-root .al-filter-btn { font-size:16px !important; min-height:44px; }
  .al-root .al-act { min-height:44px; }
  .al-root .al-head { padding:10px 12px; }
}
`;

export default Logs;
