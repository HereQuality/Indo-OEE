"use strict";

const { getOrCreateSummaryMail, EMAIL_RE } = require("../models/SummaryMailSetting");
const AuditLog = require("../models/AuditLog");
const { isConfigured } = require("../services/mailer");
const { sendSummary, dailyPeriod, weeklyPeriod, nextSendAt, istNow, DEFAULT_DAILY_DAYS } = require("../jobs/summaryMail");
const { recordAudit } = require("../utils/auditTrail");

const MAIL_FIELDS = { recipients: "Recipients", dailyEnabled: "Daily summary", weeklyEnabled: "Weekly summary", dailySendAt: "Daily send time", dailyDays: "Daily send days", weeklySendAt: "Weekly send time", weeklyDay: "Weekly day" };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayList = (days) => (days?.length ? days : DEFAULT_DAILY_DAYS).map((d) => DAY_NAMES[d].slice(0, 3)).join(", ");
const mailView = (doc) => ({ recipients: [...(doc.recipients || [])], dailyEnabled: doc.dailyEnabled, weeklyEnabled: doc.weeklyEnabled, dailySendAt: doc.dailySendAt, dailyDays: dayList(doc.dailyDays), weeklySendAt: doc.weeklySendAt, weeklyDay: DAY_NAMES[doc.weeklyDay] ?? doc.weeklyDay });

// The weekdays ticked for the daily mail: 0..6, de-duplicated, in week order.
const parseDays = (raw) => {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const v of list) {
    const d = Number(v);
    if (!Number.isInteger(d) || d < 0 || d > 6) return { error: "Daily send days must be weekdays (0 = Sunday … 6 = Saturday)" };
    if (!out.includes(d)) out.push(d);
  }
  if (!out.length) return { error: "Pick at least one day for the daily mail" };
  return { days: out.sort((a, b) => a - b) };
};

/**
 * controllers/summaryMail.controller.js
 * ──────────────────────────────────────
 * The Company page's "Email reports" tab (routes/summaryMail.routes.js):
 * who gets the daily / weekly OEE and OK Qty summary and when, when each
 * next goes out, the last sends, plus "send now" and "send a test at a time"
 * to check the setup. See jobs/summaryMail.js for the sending.
 */
const serialize = (doc, now = new Date()) => ({
  recipients: doc.recipients,
  dailyEnabled: doc.dailyEnabled,
  weeklyEnabled: doc.weeklyEnabled,
  dailySendAt: doc.dailySendAt,
  dailyDays: doc.dailyDays?.length ? [...doc.dailyDays] : [...DEFAULT_DAILY_DAYS],
  weeklySendAt: doc.weeklySendAt,
  weeklyDay: doc.weeklyDay,
  lastDailyFor: doc.lastDailyFor,
  lastWeeklyFor: doc.lastWeeklyFor,
  // When each next goes out (null when switched off), and the server's clock,
  // so the page can count down without trusting the browser's.
  nextDailyAt: doc.dailyEnabled ? nextSendAt({ days: doc.dailyDays, hhmm: doc.dailySendAt, sentFor: doc.lastDailyFor }, now) : null,
  nextWeeklyAt: doc.weeklyEnabled ? nextSendAt({ days: [doc.weeklyDay], hhmm: doc.weeklySendAt, sentFor: doc.lastWeeklyFor }, now) : null,
  serverTime: now,
  test: doc.testAt ? { at: doc.testAt, kind: doc.testKind, to: [...(doc.testTo || [])], byName: doc.testByName } : null,
  updatedByName: doc.updatedByName,
  updatedAt: doc.updatedAt,
  // Whether the server can send at all (SMTP in .env).
  mailConfigured: isConfigured(),
});

const actorName = (user) => user?.employeeName || user?.name || user?.username || "";

// The addresses typed in: one per line / comma / space, trimmed, lowercased, de-duplicated.
const parseRecipients = (raw) => {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,;]+/);
  const out = [];
  for (const e of list.map((x) => String(x).trim().toLowerCase()).filter(Boolean)) {
    if (!EMAIL_RE.test(e)) return { error: `"${e}" is not a valid email address` };
    if (!out.includes(e)) out.push(e);
  }
  return { recipients: out };
};

// The last sends (scheduled, test and "send now"), from the audit log.
const recentSends = async () =>
  AuditLog.find({ entityType: "summaryMail", action: "sent" })
    .sort({ createdAt: -1 })
    .limit(15)
    .select("createdAt remark success actor.name")
    .lean()
    .then((rows) => rows.map((r) => ({ at: r.createdAt, remark: r.remark, success: r.success !== false && !/NOT sent/.test(r.remark || ""), by: r.actor?.name || "" })));

exports.getSummaryMail = async (req, res) => {
  try {
    const [doc, history] = await Promise.all([getOrCreateSummaryMail(), recentSends().catch(() => [])]);
    res.status(200).json({ isOk: true, data: { ...serialize(doc), history } });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.updateSummaryMail = async (req, res) => {
  try {
    const { recipients, dailyEnabled, weeklyEnabled, dailySendAt, dailyDays, weeklySendAt, weeklyDay } = req.body;
    const doc = await getOrCreateSummaryMail();
    const before = mailView(doc);
    if (recipients !== undefined) {
      const parsed = parseRecipients(recipients);
      if (parsed.error) return res.status(400).json({ isOk: false, message: parsed.error });
      doc.recipients = parsed.recipients;
    }
    if (dailyDays !== undefined) {
      const parsed = parseDays(dailyDays);
      if (parsed.error) return res.status(400).json({ isOk: false, message: parsed.error });
      doc.dailyDays = parsed.days;
    }
    if (dailyEnabled !== undefined) doc.dailyEnabled = !!dailyEnabled;
    if (weeklyEnabled !== undefined) doc.weeklyEnabled = !!weeklyEnabled;
    if (dailySendAt !== undefined) doc.dailySendAt = String(dailySendAt);
    if (weeklySendAt !== undefined) doc.weeklySendAt = String(weeklySendAt);
    if (weeklyDay !== undefined) doc.weeklyDay = Number(weeklyDay);
    doc.updatedByName = actorName(req.user);
    await doc.save();
    await recordAudit({ req, entityType: "summaryMail", entity: doc._id, label: "Summary email", action: "setting", before, after: mailView(doc), fields: MAIL_FIELDS });
    const history = await recentSends().catch(() => []);
    res.status(200).json({ isOk: true, data: { ...serialize(doc), history }, message: "Summary email settings saved" });
  } catch (error) {
    res.status(400).json({ isOk: false, message: error.message });
  }
};

// POST /summary-mail/send { kind: "daily" | "weekly", to?: "a@b.com" }
// Sends that summary right now — the daily one for what today's scheduled
// daily would cover (the previous day, or the days since the last send day),
// the weekly one for the previous Monday–Sunday — to the saved recipients
// (or just `to`, to check the setup).
exports.sendSummaryNow = async (req, res) => {
  try {
    if (!isConfigured()) return res.status(400).json({ isOk: false, message: "Email isn't set up on the server (SMTP_HOST, SMTP_USER, SMTP_PASS in .env)" });
    const kind = req.body.kind === "weekly" ? "weekly" : "daily";
    const doc = await getOrCreateSummaryMail();
    let recipients = doc.recipients;
    if (req.body.to) {
      const parsed = parseRecipients(req.body.to);
      if (parsed.error) return res.status(400).json({ isOk: false, message: parsed.error });
      recipients = parsed.recipients;
    }
    if (!recipients.length) return res.status(400).json({ isOk: false, message: "Add at least one recipient first" });
    const today = istNow().date;
    let result;
    try {
      result = await sendSummary(kind, kind === "weekly" ? weeklyPeriod(today) : dailyPeriod(today, doc.dailyDays), recipients);
    } catch (error) {
      await recordAudit({ req, entityType: "summaryMail", entity: doc._id, label: "Summary email", action: "sent", remark: `${kind} (send now) — NOT sent: ${error.message}`, success: false, statusCode: 400 });
      return res.status(400).json({ isOk: false, message: `Not sent: ${error.message}` });
    }
    await recordAudit({ req, entityType: "summaryMail", entity: doc._id, label: "Summary email", action: "sent", remark: `${kind} (send now) to ${recipients.join(", ")}` });
    res.status(200).json({ isOk: true, data: result, message: `${kind === "weekly" ? "Weekly" : "Daily"} summary sent to ${recipients.join(", ")}` });
  } catch (error) {
    res.status(400).json({ isOk: false, message: error.message });
  }
};

// The moment "HH:mm" IST next comes round: today, or tomorrow when it has passed.
const nextIstTime = (hhmm, now = new Date()) => {
  const every = [0, 1, 2, 3, 4, 5, 6];
  const at = nextSendAt({ days: every, hhmm }, now);
  return at > now ? at : nextSendAt({ days: every, hhmm, sentFor: istNow(now).date }, now);
};

// POST /summary-mail/test { at: "HH:mm" (IST) | inMinutes: n, kind: "daily" | "weekly" | "both", to?: "a@b.com" }
// Books one test send: the scheduler mails it when the time comes (the next
// "HH:mm" — today, or tomorrow if it has passed), exactly as a scheduled one
// goes out. Replaces any test already booked.
exports.scheduleTest = async (req, res) => {
  try {
    if (!isConfigured()) return res.status(400).json({ isOk: false, message: "Email isn't set up on the server (SMTP_HOST, SMTP_USER, SMTP_PASS in .env)" });
    const now = new Date();
    let at;
    if (req.body.inMinutes !== undefined) {
      const mins = Number(req.body.inMinutes);
      if (!Number.isInteger(mins) || mins < 1 || mins > 24 * 60) return res.status(400).json({ isOk: false, message: "Minutes must be between 1 and 1440" });
      at = new Date(now.getTime() + mins * 60000);
    } else {
      const hhmm = String(req.body.at || "");
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return res.status(400).json({ isOk: false, message: "Pick a time (HH:mm)" });
      at = nextIstTime(hhmm, now);
    }
    const kind = ["daily", "weekly", "both"].includes(req.body.kind) ? req.body.kind : "daily";
    const doc = await getOrCreateSummaryMail();
    let to = [];
    if (req.body.to) {
      const parsed = parseRecipients(req.body.to);
      if (parsed.error) return res.status(400).json({ isOk: false, message: parsed.error });
      to = parsed.recipients;
    }
    if (!to.length && !doc.recipients.length) return res.status(400).json({ isOk: false, message: "Add at least one recipient first, or type an address to send the test to" });
    doc.testAt = at;
    doc.testKind = kind;
    doc.testTo = to;
    doc.testByName = actorName(req.user);
    await doc.save();
    const when = at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
    await recordAudit({ req, entityType: "summaryMail", entity: doc._id, label: "Summary email", action: "setting", remark: `Test ${kind} booked for ${when} IST to ${(to.length ? to : doc.recipients).join(", ")}` });
    res.status(200).json({ isOk: true, data: serialize(doc), message: `Test booked for ${when}. It goes out within a minute of that time.` });
  } catch (error) {
    res.status(400).json({ isOk: false, message: error.message });
  }
};

// DELETE /summary-mail/test — cancels the booked test send.
exports.cancelTest = async (req, res) => {
  try {
    const doc = await getOrCreateSummaryMail();
    if (doc.testAt) {
      doc.testAt = null;
      doc.testTo = [];
      await doc.save();
      await recordAudit({ req, entityType: "summaryMail", entity: doc._id, label: "Summary email", action: "setting", remark: "Test send cancelled" });
    }
    res.status(200).json({ isOk: true, data: serialize(doc), message: "Test send cancelled" });
  } catch (error) {
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports._nextIstTime = nextIstTime;
