const logger = require("../config/logger");
const { getOrCreateSummaryMail } = require("../models/SummaryMailSetting");
const { summarizeRange } = require("../utils/dashboardSummary");
const { isConfigured, sendMail } = require("../services/mailer");
const { buildOeeReportPdf } = require("../utils/oeeReportPdf");
const { recordAudit } = require("../utils/auditTrail");

// Who the audit trail names for a scheduled send (nobody is signed in).
const SCHEDULER = { name: "Scheduler", role: "System" };
const auditSend = (setting, kind, period, recipients, error) =>
  recordAudit({
    entityType: "summaryMail",
    entity: setting._id,
    label: "Summary email",
    action: "sent",
    actor: SCHEDULER,
    remark: `${kind} (scheduled) for ${periodLabel(period)}${error ? ` — NOT sent: ${error.message}` : ` to ${recipients.join(", ")}`}`,
    success: !error,
  });

/**
 * jobs/summaryMail.js
 * ────────────────────
 * Mails the dashboard's OEE and OK Qty summary (utils/dashboardSummary.js)
 * to the addresses on the Company page (models/SummaryMailSetting.js):
 *
 *   daily   at `dailySendAt` IST on each of `dailyDays` (every day at
 *           9:00 AM by default), for the previous day in full — Saturday's
 *           arrives on Sunday morning, Sunday's on Monday. When some weekdays
 *           are unticked, the first send day after a gap covers every day
 *           since the last send day (Mon–Sat only: Monday's covers Sat + Sun)
 *   weekly  at `weeklySendAt` IST on `weeklyDay` (Monday 9:30 AM by default),
 *           for the previous Monday to Sunday, Sunday's entries included
 *
 * `start()` checks once a minute whether either is due (clock in Indian
 * Standard Time, whatever the server's own timezone). A summary is sent at
 * most once per period (`lastDailyFor` / `lastWeeklyFor`), so a restart
 * doesn't repeat one — and one missed while the server was down is sent at
 * the first check after it comes back, as long as its send time has passed
 * that day.
 */
const TZ = "Asia/Kolkata";
const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, "0");

// The wall clock in IST: { date: "YYYY-MM-DD", hhmm: "HH:mm", weekday: 0..6 }.
const istNow = (at = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`, weekday };
};

const shiftDay = (iso, days) => new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
const weekdayOf = (iso) => new Date(`${iso}T00:00:00.000Z`).getUTCDay();

// The periods a summary sent on `today` covers.
// Every day: each morning brings the previous day, Saturday's on Sunday.
const DEFAULT_DAILY_DAYS = [0, 1, 2, 3, 4, 5, 6];
// Yesterday — or, when the daily mail skips some weekdays, every day since
// the last send day: with Monday–Saturday sending, Monday's mail covers
// Saturday and Sunday. Starts from the most recent send day before today
// (searching back a week), since that day's mail stopped at its own yesterday.
const dailyPeriod = (today, dailyDays = DEFAULT_DAILY_DAYS) => {
  const days = Array.isArray(dailyDays) && dailyDays.length ? dailyDays : DEFAULT_DAILY_DAYS;
  let from = shiftDay(today, -1);
  for (let back = 1; back <= 7; back++) {
    const d = shiftDay(today, -back);
    if (days.includes(weekdayOf(d))) {
      from = d;
      break;
    }
  }
  return { from, to: shiftDay(today, -1) };
};
const weeklyPeriod = (today) => {
  // The Monday–Sunday week that ended before today.
  const back = ((weekdayOf(today) + 6) % 7) + 7; // days back to the previous week's Monday
  const from = shiftDay(today, -back);
  return { from, to: shiftDay(from, 6) };
};

// ── the message ──
const fmtQty = (n) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtPct = (r) => (Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : "—");
const dmy = (iso) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};
const periodLabel = ({ from, to }) => (from === to ? dmy(from) : `${dmy(from)} to ${dmy(to)}`);
// "18:00" → "6:00 PM"
const to12h = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
};

const buildMessage = (kind, summary) => {
  const label = periodLabel(summary);
  const empty = !summary.processes.length;
  const title = `${kind === "weekly" ? "Weekly" : "Daily"} production summary — ${label}${empty ? " (no entries)" : ""}`;
  const covers = kind === "weekly" ? "Monday to Sunday" : summary.from === summary.to ? "the whole day, all shifts" : "each day in full, all shifts";
  const rows = summary.processes;
  const cell = (v, right = true) => `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:${right ? "right" : "left"};white-space:nowrap">${v}</td>`;
  const head = (v, right = true) => `<th style="padding:8px 12px;border-bottom:2px solid #d1d5db;text-align:${right ? "right" : "left"};font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">${v}</th>`;
  const tile = (name, value, hint) =>
    `<td style="padding:0 8px 0 0"><div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;min-width:140px"><div style="font-size:12px;color:#6b7280">${name}</div><div style="font-size:24px;font-weight:700;color:#111827">${value}</div>${hint ? `<div style="font-size:12px;color:#6b7280">${hint}</div>` : ""}</div></td>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:24px">
    <h2 style="margin:0 0 4px;font-size:18px">${title}</h2>
    <div style="color:#6b7280;font-size:13px;margin-bottom:18px">OEE and OK Qty from the production data entries, all processes (${covers}). The full Efficiency Report — every process and each of its machines — is attached as a PDF.</div>
    <table cellspacing="0" cellpadding="0" style="margin-bottom:20px"><tr>
      ${tile("OEE", fmtPct(summary.oee), `${summary.machineDays} machine-day${summary.machineDays === 1 ? "" : "s"}`)}
      ${tile("OK Qty", fmtQty(summary.okQty), `of ${fmtQty(summary.totalQty)} total`)}
      ${tile("Rejected", fmtQty(summary.rejectedQty), summary.totalQty ? `${(summary.rejectedQty / summary.totalQty * 100).toFixed(1)}% of total` : "")}
      ${tile("Entries", fmtQty(summary.entries), "")}
    </tr></table>
    ${
      rows.length
        ? `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">
      <thead><tr>${head("Process", false)}${head("Entries")}${head("OK Qty")}${head("Total Qty")}${head("Rejected")}${head("OEE")}</tr></thead>
      <tbody>${rows
        .map((p) => `<tr>${cell(p.processName, false)}${cell(fmtQty(p.entries))}${cell(fmtQty(p.okQty))}${cell(fmtQty(p.totalQty))}${cell(fmtQty(p.rejectedQty))}${cell(fmtPct(p.oee))}</tr>`)
        .join("")}
      <tr style="font-weight:700">${cell("All processes", false)}${cell(fmtQty(summary.entries))}${cell(fmtQty(summary.okQty))}${cell(fmtQty(summary.totalQty))}${cell(fmtQty(summary.rejectedQty))}${cell(fmtPct(summary.oee))}</tr></tbody>
    </table>`
        : `<div style="padding:16px;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280"><b style="color:#111827">No production entries were saved for ${label}.</b><br>No machine or process has data for this period, so the figures above are empty. If production ran, the entries are still to be filled in.</div>`
    }
    <div style="color:#9ca3af;font-size:12px;margin-top:18px">OEE is each sheet's own OEE considering losses (Productivity on a worker sheet), averaged over machine-days, as on the Production Dashboard. Sent automatically by ${process.env.APP_NAME || "the OEE app"}.</div>
  </div></body></html>`;
  const text = [
    title,
    `OEE ${fmtPct(summary.oee)} · OK Qty ${fmtQty(summary.okQty)} of ${fmtQty(summary.totalQty)} · Rejected ${fmtQty(summary.rejectedQty)} · Entries ${fmtQty(summary.entries)}`,
    "",
    ...rows.map((p) => `${p.processName}: OK ${fmtQty(p.okQty)} / ${fmtQty(p.totalQty)}, rejected ${fmtQty(p.rejectedQty)}, OEE ${fmtPct(p.oee)} (${p.entries} entries)`),
  ].join("\n");
  return { subject: title, html, text };
};

// Builds and sends one summary: the figures in the mail body, and the full
// Efficiency Report (every process, each machine) attached as a PDF.
// Returns { sent, recipients, period, subject }.
const sendSummary = async (kind, period, recipients) => {
  if (!recipients?.length) throw new Error("No recipients are set");
  const summary = await summarizeRange(period.from, period.to);
  const message = buildMessage(kind, summary);
  const pdf = await buildOeeReportPdf(summary, { title: `${kind === "weekly" ? "Weekly" : "Daily"} Efficiency Report (OEE)` });
  const filename = `OEE-report-${period.from}${period.to !== period.from ? `_to_${period.to}` : ""}.pdf`;
  // Bcc, so no recipient sees who else gets the report.
  await sendMail({ bcc: recipients.join(", "), ...message, attachments: [{ filename, content: pdf, contentType: "application/pdf" }] });
  return { sent: true, recipients, period, subject: message.subject };
};

// When a summary on `days` (weekdays 0..6) at `hhmm` IST next goes out, as a
// Date. `sentFor` is the IST date it was last sent for: today counts only if
// it hasn't gone yet — and when today's time has already passed unsent, the
// answer is `now` (it goes at the next check, within a minute). Pure.
const IST_OFFSET_MS = 330 * 60 * 1000; // India has no daylight saving
const nextSendAt = ({ days, hhmm, sentFor = "" }, now = new Date()) => {
  const list = Array.isArray(days) && days.length ? days.map(Number) : DEFAULT_DAILY_DAYS;
  const today = istNow(now).date;
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  for (let d = 0; d <= 7; d += 1) {
    const date = shiftDay(today, d);
    if (!list.includes(weekdayOf(date))) continue;
    if (d === 0 && sentFor === today) continue;
    const at = new Date(Date.parse(`${date}T00:00:00.000Z`) + (h * 60 + m) * 60000 - IST_OFFSET_MS);
    return at <= now ? now : at;
  }
  return null;
};

// After a send fails (mail server down, wrong password), wait this long before
// trying the same summary again, so the log isn't filled with one failure a minute.
const RETRY_AFTER_MS = 15 * 60 * 1000;
const failedAt = { daily: 0, weekly: 0 };
const mayTry = (kind, now) => now.getTime() - failedAt[kind] >= RETRY_AFTER_MS;

// A booked test send (Company page › Email reports › "Send a test at"), once
// its time has come: mailed, logged, cleared — sent or not, so it never repeats.
const runTest = async (setting, now) => {
  if (!setting.testAt || setting.testAt > now) return;
  const kinds = setting.testKind === "both" ? ["daily", "weekly"] : [setting.testKind === "weekly" ? "weekly" : "daily"];
  const recipients = setting.testTo?.length ? [...setting.testTo] : [...setting.recipients];
  const by = setting.testByName;
  setting.testAt = null;
  setting.testTo = [];
  await setting.save();
  const today = istNow(now).date;
  const dailyDays = setting.dailyDays?.length ? setting.dailyDays : DEFAULT_DAILY_DAYS;
  for (const kind of kinds) {
    const period = kind === "weekly" ? weeklyPeriod(today) : dailyPeriod(today, dailyDays);
    let error = null;
    try {
      if (!recipients.length) throw new Error("No recipients are set");
      await sendSummary(kind, period, recipients);
      logger.info(`Test ${kind} summary mailed to ${recipients.join(", ")}`);
    } catch (e) {
      error = e;
      logger.error(`Test ${kind} summary mail failed: ${e.message}`);
    }
    await recordAudit({
      entityType: "summaryMail",
      entity: setting._id,
      label: "Summary email",
      action: "sent",
      actor: SCHEDULER,
      remark: `TEST ${kind}${by ? ` booked by ${by}` : ""} for ${periodLabel(period)}${error ? ` — NOT sent: ${error.message}` : ` to ${recipients.join(", ")}`}`,
      success: !error,
    });
  }
};

// One check: sends whatever is due right now. Exported for tests/manual runs;
// `now` can be given.
const tick = async (now = new Date()) => {
  if (!isConfigured()) return;
  const setting = await getOrCreateSummaryMail();
  await runTest(setting, now);
  if (!setting.recipients.length) return;
  const clock = istNow(now);
  const dailyDays = setting.dailyDays?.length ? setting.dailyDays : DEFAULT_DAILY_DAYS;
  if (setting.dailyEnabled && dailyDays.includes(clock.weekday) && clock.hhmm >= setting.dailySendAt && setting.lastDailyFor !== clock.date && mayTry("daily", now)) {
    const period = dailyPeriod(clock.date, dailyDays);
    try {
      await sendSummary("daily", period, setting.recipients);
      setting.lastDailyFor = clock.date;
      await setting.save();
      logger.info(`Daily summary mailed for ${period.from}${period.to !== period.from ? `–${period.to}` : ""} to ${setting.recipients.length} recipient(s)`);
      await auditSend(setting, "daily", period, setting.recipients);
    } catch (error) {
      failedAt.daily = now.getTime();
      logger.error(`Daily summary mail failed: ${error.message} — trying again in 15 minutes`);
      await auditSend(setting, "daily", period, setting.recipients, error);
    }
  }
  if (setting.weeklyEnabled && clock.weekday === setting.weeklyDay && clock.hhmm >= setting.weeklySendAt && setting.lastWeeklyFor !== clock.date && mayTry("weekly", now)) {
    const period = weeklyPeriod(clock.date);
    try {
      await sendSummary("weekly", period, setting.recipients);
      setting.lastWeeklyFor = clock.date;
      await setting.save();
      logger.info(`Weekly summary mailed for ${period.from}–${period.to} to ${setting.recipients.length} recipient(s)`);
      await auditSend(setting, "weekly", period, setting.recipients);
    } catch (error) {
      failedAt.weekly = now.getTime();
      logger.error(`Weekly summary mail failed: ${error.message} — trying again in 15 minutes`);
      await auditSend(setting, "weekly", period, setting.recipients, error);
    }
  }
};

let timer = null;
const start = () => {
  if (timer) return;
  if (!isConfigured()) {
    logger.info("Summary mail: SMTP isn't set in .env, so no summaries will be sent");
    return;
  }
  // One check at a time: building a PDF can take longer than the minute.
  let busy = false;
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    tick()
      .catch((e) => logger.error(`Summary mail check failed: ${e.message}`))
      .finally(() => {
        busy = false;
      });
  }, 60 * 1000);
  timer.unref?.();
  logger.info("Summary mail: checking every minute (IST)");
};

module.exports = { start, tick, sendSummary, buildMessage, dailyPeriod, weeklyPeriod, nextSendAt, istNow, to12h, DEFAULT_DAILY_DAYS, _failedAt: failedAt };
