"use strict";

const mongoose = require("mongoose");
const Process = require("../models/Process");
const Machine = require("../models/Machine");
const MachineOperator = require("../models/MachineOperator");
const { viewableProcessIds } = require("../utils/processAccess");
const { summarizeRange } = require("../utils/dashboardSummary");
const { buildOeeReportPdf } = require("../utils/oeeReportPdf");
const { isConfigured, sendMail } = require("../services/mailer");
const { getOrCreateSummaryMail, EMAIL_RE } = require("../models/SummaryMailSetting");

/**
 * controllers/dashboardReport.controller.js
 * ──────────────────────────────────────────
 * The Production Dashboard's Efficiency Report (OEE) as a PDF, for the
 * dashboard's own period / process / machine scope:
 *
 *   GET  /processes/entries/report.pdf?from&to[&process][&machine=id1,id2]
 *   POST /processes/entries/report/email  { from, to, process?, machine?, recipients? }
 *
 * Scope follows the dashboard: a process the user can't view is refused;
 * "All processes" covers just theirs. One machine ticked = that machine's
 * figures; none = the process's machines combined (and every process's).
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366 * 5;
const parseList = (raw) => String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);

// Works out the scope and the summary, or { error, status }.
const reportFor = async (req, q) => {
  const { from, to } = q;
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "") || to < from) return { error: "Valid 'from' and 'to' dates (YYYY-MM-DD) are required", status: 400 };
  if ((new Date(to) - new Date(from)) / 86400000 > MAX_RANGE_DAYS) return { error: "Date range can't exceed 5 years", status: 400 };
  const processes = await Process.find().select("processName dataEntryMenu isActive").lean();
  const viewable = await viewableProcessIds(req, processes);
  let processIds = viewable ? new Set([...viewable].map(String)) : null;
  let processLabel = "All processes";
  if (q.process) {
    if (!mongoose.isValidObjectId(q.process)) return { error: "Invalid process", status: 400 };
    if (viewable && !viewable.has(String(q.process))) return { error: "You don't have access to this process's dashboard", status: 403 };
    processIds = new Set([String(q.process)]);
    processLabel = processes.find((p) => String(p._id) === String(q.process))?.processName || "Process";
  }
  const machineIds = parseList(q.machine);
  if (machineIds.some((id) => !mongoose.isValidObjectId(id))) return { error: "Invalid machine", status: 400 };
  let machineLabel = "All machines";
  if (machineIds.length) {
    const [ms, ws] = await Promise.all([
      Machine.find({ _id: { $in: machineIds } }).select("machineName").lean(),
      MachineOperator.find({ _id: { $in: machineIds } }).select("name").lean(),
    ]);
    machineLabel = [...ms.map((m) => m.machineName), ...ws.map((w) => w.name)].join(", ") || "Selected machines";
  }
  const summary = await summarizeRange(from, to, { processIds, machineIds });
  const actor = req.user?.employeeName || req.user?.name || req.user?.username || "";
  const pdf = await buildOeeReportPdf(summary, { processLabel, machineLabel, generatedBy: actor });
  const filename = `OEE-report-${processLabel.replace(/[^\w-]+/g, "_")}-${from}${to !== from ? `_to_${to}` : ""}.pdf`;
  return { summary, pdf, filename, processLabel, machineLabel };
};

exports.getDashboardReportPdf = async (req, res) => {
  try {
    const r = await reportFor(req, req.query);
    if (r.error) return res.status(r.status).json({ isOk: false, message: r.error });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${r.filename}"`);
    res.send(r.pdf);
  } catch (error) {
    console.error("Error building the dashboard report:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Mails the report to the Company page's saved recipients, or to `recipients`
// (addresses separated by commas / spaces / new lines).
exports.emailDashboardReport = async (req, res) => {
  try {
    if (!isConfigured()) return res.status(400).json({ isOk: false, message: "Email isn't set up on the server (SMTP_HOST, SMTP_USER, SMTP_PASS in .env)" });
    const r = await reportFor(req, req.body || {});
    if (r.error) return res.status(r.status).json({ isOk: false, message: r.error });
    let recipients = (await getOrCreateSummaryMail()).recipients;
    if (req.body.recipients) {
      const raw = Array.isArray(req.body.recipients) ? req.body.recipients.join(",") : String(req.body.recipients);
      recipients = parseList(raw.replace(/[\s;]+/g, ",")).map((e) => e.toLowerCase());
      const bad = recipients.find((e) => !EMAIL_RE.test(e));
      if (bad) return res.status(400).json({ isOk: false, message: `"${bad}" is not a valid email address` });
    }
    if (!recipients.length) return res.status(400).json({ isOk: false, message: "No recipients: add them on the Company page or type an address" });
    const { summary } = r;
    const period = summary.from === summary.to ? summary.from : `${summary.from} to ${summary.to}`;
    const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
    const subject = `Efficiency Report (OEE) — ${r.processLabel} — ${period}`;
    const text = `${subject}\nMachines: ${r.machineLabel}\nOEE ${pct(summary.oee)} · Availability ${pct(summary.availability)} · Performance ${pct(summary.performance)} · Quality ${pct(summary.quality)}\nOK Qty ${summary.okQty} of ${summary.totalQty} · Rejected ${summary.rejectedQty} · ${summary.entries} entries\n\nThe full report is attached as a PDF.`;
    const html = `<p><b>${subject}</b><br>Machines: ${r.machineLabel}</p><p>OEE <b>${pct(summary.oee)}</b> · Availability ${pct(summary.availability)} · Performance ${pct(summary.performance)} · Quality ${pct(summary.quality)}<br>OK Qty <b>${summary.okQty}</b> of ${summary.totalQty} · Rejected ${summary.rejectedQty} · ${summary.entries} entries</p><p>The full report — the process and each of its machines — is attached as a PDF.</p>`;
    await sendMail({ to: recipients.join(", "), subject, text, html, attachments: [{ filename: r.filename, content: r.pdf, contentType: "application/pdf" }] });
    res.status(200).json({ isOk: true, message: `Report sent to ${recipients.join(", ")}` });
  } catch (error) {
    console.error("Error emailing the dashboard report:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};
