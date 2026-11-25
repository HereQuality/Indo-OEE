const MachineDayStatus = require("../models/MachineDayStatus");
const { isAdminUser } = require("../utils/adminAccess");
const { recordAudit, diffChanges } = require("../utils/auditTrail");
const { machineNamesFor } = require("../utils/machineNames");
const { REASONS, SHEETS } = MachineDayStatus;

/**
 * controllers/machineDayStatus.controller.js
 * ───────────────────────────────────────────
 * "Not running" marks on the data entry sheets (models/MachineDayStatus.js).
 *
 *   GET    /machine-day-status?sheet=vmc&from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET    /machine-day-status/reasons
 *   PUT    /machine-day-status            { sheet, date, machines: [id…] | machine, reasons: [] | reason, remarks }
 *   DELETE /machine-day-status            { sheet, date, machine }
 *
 * PUT marks one machine, or several at once (a whole day off), and saving
 * over an existing mark replaces its reason and remarks.
 *
 * Lock: a mark can be edited or undone only on the day (IST) it was saved.
 * From the next day it is locked for everyone but Admin / Super Admin
 * (Full access), who can still change it.
 *
 * Every mark goes to the audit trail (utils/auditTrail.js): "marked" for a
 * new one, "update" when an existing mark's reasons or remarks change, and
 * "unmarked" when one is undone — each with the reasons and remarks old → new.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const istDay = (d = new Date()) => new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10);
// Locked once the IST day it was saved on has passed.
const isLocked = (s, today = istDay()) => !!s?.createdAt && istDay(s.createdAt) < today;
const bad = (res, message) => res.status(400).json({ success: false, message });
const reasonsOf = (s) => (s.reasons?.length ? s.reasons : [s.reason]).filter(Boolean);
const serialize = (s) => ({
  _id: s._id, sheet: s.sheet, date: s.date, machine: s.machine, reason: s.reason, reasons: reasonsOf(s),
  reasonLabel: reasonsOf(s).map((r) => REASONS[r]?.label || r).join(", "),
  kind: reasonsOf(s).some((r) => REASONS[r]?.kind !== "planned") ? "unplanned" : "planned",
  remarks: s.remarks, markedBy: s.markedBy, createdAt: s.createdAt, updatedAt: s.updatedAt,
  locked: isLocked(s),
});
// The audit trail's view of a mark: its reasons by label, and its remarks.
const MARK_FIELDS = { reasons: "Reasons", remarks: "Remarks" };
const markView = (s) => (s ? { reasons: reasonsOf(s).map((r) => REASONS[r]?.label || r).join(", "), remarks: s.remarks || "" } : {});
const dmy = (iso) => String(iso || "").split("-").reverse().join("/");
// One audit row per machine marked / changed / undone. Never fails the save.
const auditMarks = async (req, { sheet, date, before, after, action }) => {
  try {
    const marks = after.length ? after : before;
    const names = await machineNamesFor(marks.map((m) => String(m.machine)).filter(Boolean));
    for (const mark of marks) {
      const was = before.find((b) => String(b.machine) === String(mark.machine));
      const machineName = names[String(mark.machine)] || "";
      // "marked" lists what was set (like a create), "unmarked" what was undone
      // (like a delete); a changed mark only its differences.
      const what = action === "unmarked" ? "unmarked" : was ? "update" : "marked";
      const diffAs = { marked: "create", unmarked: "delete", update: "update" }[what];
      await recordAudit({
        req,
        entityType: "notRunning",
        entity: mark._id,
        sheet,
        date,
        machine: mark.machine || null,
        machineName,
        label: `${machineName || "Machine"} · ${dmy(date)}`,
        action: what,
        changes: diffChanges(markView(was || mark), what === "unmarked" ? {} : markView(mark), MARK_FIELDS, diffAs),
      });
    }
  } catch (e) {
    console.error("Error logging Not running marks:", e);
  }
};
const whoIs = (req) => req.user?.employeeName || [req.user?.firstName, req.user?.lastName].filter(Boolean).join(" ") || req.user?.name || req.user?.userName || req.user?.username || req.user?.email || "";

exports.reasons = (_req, res) =>
  res.json({ success: true, data: Object.entries(REASONS).map(([value, r]) => ({ value, ...r })) });

exports.list = async (req, res, next) => {
  try {
    const { sheet, from, to } = req.query;
    if (!SHEETS.includes(sheet)) return bad(res, "Unknown sheet");
    const q = { sheet };
    if (ISO.test(from || "") || ISO.test(to || "")) {
      q.date = {};
      if (ISO.test(from || "")) q.date.$gte = from;
      if (ISO.test(to || "")) q.date.$lte = to;
    }
    const rows = await MachineDayStatus.find(q).sort({ date: -1 }).lean();
    res.json({ success: true, data: rows.map(serialize) });
  } catch (e) {
    next(e);
  }
};

exports.upsert = async (req, res, next) => {
  try {
    const { sheet, date } = req.body || {};
    let reasons = [...new Set(Array.isArray(req.body?.reasons) ? req.body.reasons : [req.body?.reason].filter(Boolean))];
    // A description with no reason picked is saved as "Other".
    if (!reasons.length && String(req.body?.remarks || "").trim()) reasons = ["other"];
    const reason = reasons[0];
    const remarks = String(req.body?.remarks || "").trim();
    if (!SHEETS.includes(sheet)) return bad(res, "Unknown sheet");
    if (!ISO.test(date || "")) return bad(res, "Pick a date");
    if (!reasons.length || reasons.some((r) => !REASONS[r])) return bad(res, "Pick a reason");
    if (reasons.includes("other") && !remarks) return bad(res, "Write a remark for 'Other'");
    if (remarks.length > 300) return bad(res, "Remarks must be 300 characters or fewer");
    const today = istDay();
    if (date > today) return bad(res, "A future day can't be marked yet");
    const machines = Array.isArray(req.body.machines) ? req.body.machines.map(String) : [String(req.body.machine ?? "")];
    if (!machines.length) return bad(res, "Pick a machine");
    const markedBy = whoIs(req);
    const existing = await MachineDayStatus.find({ sheet, date, machine: { $in: machines } }).lean();
    if (existing.some((e) => isLocked(e, today)) && !(await isAdminUser(req)))
      return res.status(403).json({ success: false, message: "Already marked and locked — only an Admin can change it after the day it was saved" });
    const saved = await Promise.all(
      [...new Set(machines)].map((machine) =>
        MachineDayStatus.findOneAndUpdate(
          { sheet, date, machine },
          { $set: { reason, reasons, remarks, markedBy } },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
        ),
      ),
    );
    await auditMarks(req, { sheet, date, before: existing, after: saved.map((d) => d.toObject()) });
    res.json({ success: true, message: saved.length === 1 ? "Marked as not running" : `${saved.length} marked as not running`, data: saved.map(serialize) });
  } catch (e) {
    next(e);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { sheet, date } = { ...req.query, ...(req.body || {}) };
    const machine = String((req.body?.machine ?? req.query.machine) || "");
    if (!SHEETS.includes(sheet) || !ISO.test(date || "")) return bad(res, "Unknown mark");
    const mark = await MachineDayStatus.findOne({ sheet, date, machine }).lean();
    if (mark && isLocked(mark) && !(await isAdminUser(req)))
      return res.status(403).json({ success: false, message: "Locked — only an Admin can undo it after the day it was saved" });
    await MachineDayStatus.deleteOne({ sheet, date, machine });
    if (mark) await auditMarks(req, { sheet, date, before: [mark], after: [], action: "unmarked" });
    res.json({ success: true, message: "Mark removed" });
  } catch (e) {
    next(e);
  }
};

exports._serialize = serialize;
exports._auditMarks = auditMarks;
exports._isLocked = isLocked;
