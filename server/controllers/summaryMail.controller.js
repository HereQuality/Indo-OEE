"use strict";

const { getOrCreateSummaryMail, EMAIL_RE } = require("../models/SummaryMailSetting");
const { isConfigured } = require("../services/mailer");
const { sendSummary, dailyPeriod, weeklyPeriod, istNow, DEFAULT_DAILY_DAYS } = require("../jobs/summaryMail");
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
 * The Company page's "Summary email" card (routes/summaryMail.routes.js):
 * who gets the daily / weekly OEE and OK Qty summary and when, plus a
 * "send now" to check the setup. See jobs/summaryMail.js for the sending.
 */
const serialize = (doc) => ({
  recipients: doc.recipients,
  dailyEnabled: doc.dailyEnabled,
  weeklyEnabled: doc.weeklyEnabled,
  dailySendAt: doc.dailySendAt,
  dailyDays: doc.dailyDays?.length ? [...doc.dailyDays] : [...DEFAULT_DAILY_DAYS],
  weeklySendAt: doc.weeklySendAt,
  weeklyDay: doc.weeklyDay,
  lastDailyFor: doc.lastDailyFor,
  lastWeeklyFor: doc.lastWeeklyFor,
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

exports.getSummaryMail = async (req, res) => {
  try {
    res.status(200).json({ isOk: true, data: serialize(await getOrCreateSummaryMail()) });
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
    res.status(200).json({ isOk: true, data: serialize(doc), message: "Summary email settings saved" });
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
    const result = await sendSummary(kind, kind === "weekly" ? weeklyPeriod(today) : dailyPeriod(today, doc.dailyDays), recipients);
    await recordAudit({ req, entityType: "summaryMail", entity: doc._id, label: "Summary email", action: "sent", remark: `${kind} to ${recipients.join(", ")}` });
    res.status(200).json({ isOk: true, data: result, message: `${kind === "weekly" ? "Weekly" : "Daily"} summary sent to ${recipients.join(", ")}` });
  } catch (error) {
    res.status(400).json({ isOk: false, message: error.message });
  }
};
