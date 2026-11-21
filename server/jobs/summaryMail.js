const logger = require("../config/logger");
const { getOrCreateSummaryMail } = require("../models/SummaryMailSetting");
const { summarizeRange } = require("../utils/dashboardSummary");
const { isConfigured, sendMail } = require("../services/mailer");
const { buildOeeReportPdf } = require("../utils/oeeReportPdf");

/**
 * jobs/summaryMail.js
 * ────────────────────
 * Mails the dashboard's OEE and OK Qty summary (utils/dashboardSummary.js)
 * to the addresses on the Company page (models/SummaryMailSetting.js):
 *
 *   daily   at `dailySendAt` IST every day (6:00 PM by default), for that same
 *           day — whatever was entered from 12:00 AM up to the send time
 *   weekly  at `weeklySendAt` IST on `weeklyDay` (Monday 8:00 AM by default),
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
const dailyPeriod = (today) => ({ from: today, to: today });
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

const buildMessage = (kind, summary, { sentAt = "" } = {}) => {
  const label = periodLabel(summary);
  const title = `${kind === "weekly" ? "Weekly" : "Daily"} production summary — ${label}`;
  const covers = kind === "weekly" ? "Monday to Sunday" : `entries saved from 12:00 AM${sentAt ? ` to ${sentAt}` : ""}`;
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
        : `<div style="padding:16px;border:1px dashed #d1d5db;border-radius:10px;color:#6b7280">No entries were saved for ${label}.</div>`
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
  const clock = istNow();
  const message = buildMessage(kind, summary, { sentAt: clock.date === period.to ? to12h(clock.hhmm) : "" });
  const pdf = await buildOeeReportPdf(summary, { title: `${kind === "weekly" ? "Weekly" : "Daily"} Efficiency Report (OEE)` });
  const filename = `OEE-report-${period.from}${period.to !== period.from ? `_to_${period.to}` : ""}.pdf`;
  await sendMail({ to: recipients.join(", "), ...message, attachments: [{ filename, content: pdf, contentType: "application/pdf" }] });
  return { sent: true, recipients, period, subject: message.subject };
};

// One check: sends whatever is due right now. Exported for tests/manual runs;
// `now` can be given.
const tick = async (now = new Date()) => {
  if (!isConfigured()) return;
  const setting = await getOrCreateSummaryMail();
  if (!setting.recipients.length) return;
  const clock = istNow(now);
  if (setting.dailyEnabled && clock.hhmm >= setting.dailySendAt && setting.lastDailyFor !== clock.date) {
    try {
      await sendSummary("daily", dailyPeriod(clock.date), setting.recipients);
      setting.lastDailyFor = clock.date;
      await setting.save();
      logger.info(`Daily summary mailed for ${dailyPeriod(clock.date).from} to ${setting.recipients.length} recipient(s)`);
    } catch (error) {
      logger.error(`Daily summary mail failed: ${error.message}`);
    }
  }
  if (setting.weeklyEnabled && clock.weekday === setting.weeklyDay && clock.hhmm >= setting.weeklySendAt && setting.lastWeeklyFor !== clock.date) {
    try {
      const period = weeklyPeriod(clock.date);
      await sendSummary("weekly", period, setting.recipients);
      setting.lastWeeklyFor = clock.date;
      await setting.save();
      logger.info(`Weekly summary mailed for ${period.from}–${period.to} to ${setting.recipients.length} recipient(s)`);
    } catch (error) {
      logger.error(`Weekly summary mail failed: ${error.message}`);
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
  timer = setInterval(() => tick().catch((e) => logger.error(`Summary mail check failed: ${e.message}`)), 60 * 1000);
  timer.unref?.();
  logger.info("Summary mail: checking every minute (IST)");
};

module.exports = { start, tick, sendSummary, buildMessage, dailyPeriod, weeklyPeriod, istNow, to12h };
