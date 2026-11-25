const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");
const { recordAudit, plain } = require("../utils/auditTrail");

// The audit trail's view of a holiday: its date as a day.
const HOLIDAY_FIELDS = { name: "Holiday", date: "Date", isRecurringYearly: "Every year", isActive: "Active" };
const holidayView = (h) => (h ? { ...plain(h), date: h.date ? new Date(h.date).toISOString().slice(0, 10) : null } : {});
const auditHoliday = (req, action, before, after, remark) =>
  recordAudit({ req, entityType: "holiday", entity: (after || before)?._id, label: (after || before)?.name || "", action, before: holidayView(before), after: holidayView(after), fields: HOLIDAY_FIELDS, remark });
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayNames = (days = []) => days.map((d) => DAY_NAMES[d] || d).join(", ");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

exports.getAllHolidays = async (req, res) => {
  try {
    const holidays = await CompanyHoliday.find({ isActive: true }).sort({ date: 1 });
    res.status(200).json({ isOk: true, data: holidays });
  } catch (error) {
    console.error("Error fetching company holidays:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.createHoliday = async (req, res) => {
  try {
    const { name, date, isRecurringYearly } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ isOk: false, message: "Name is required" });
    if (!DATE_RE.test(String(date || ""))) return res.status(400).json({ isOk: false, message: "A valid date is required" });

    const holiday = await CompanyHoliday.create({
      name: String(name).trim(),
      date: new Date(`${date}T00:00:00.000Z`),
      isRecurringYearly: !!isRecurringYearly,
    });
    await auditHoliday(req, "create", null, holiday);
    res.status(201).json({ isOk: true, data: holiday, message: "Holiday added" });
  } catch (error) {
    console.error("Error creating company holiday:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports.updateHoliday = async (req, res) => {
  try {
    const { holidayId } = req.params;
    const { name, date, isRecurringYearly } = req.body;
    const data = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ isOk: false, message: "Name is required" });
      data.name = String(name).trim();
    }
    if (date !== undefined) {
      if (!DATE_RE.test(String(date || ""))) return res.status(400).json({ isOk: false, message: "A valid date is required" });
      data.date = new Date(`${date}T00:00:00.000Z`);
    }
    if (isRecurringYearly !== undefined) data.isRecurringYearly = !!isRecurringYearly;

    const before = await CompanyHoliday.findById(holidayId).lean();
    const holiday = await CompanyHoliday.findByIdAndUpdate(holidayId, data, { new: true, runValidators: true });
    if (!holiday) return res.status(404).json({ isOk: false, message: "Holiday not found" });
    await auditHoliday(req, "update", before, holiday);
    res.status(200).json({ isOk: true, data: holiday, message: "Holiday updated" });
  } catch (error) {
    console.error("Error updating company holiday:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};

exports.deleteHoliday = async (req, res) => {
  try {
    const holiday = await CompanyHoliday.findByIdAndDelete(req.params.holidayId);
    if (!holiday) return res.status(404).json({ isOk: false, message: "Holiday not found" });
    await auditHoliday(req, "delete", holiday, null);
    res.status(200).json({ isOk: true, message: "Holiday deleted" });
  } catch (error) {
    console.error("Error deleting company holiday:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// One document for the whole app — created on first read if it doesn't
// exist yet, so the client never has to handle a 404 for "not set up".
const getOrCreateWeeklyOff = async () => {
  let doc = await WeeklyOffSetting.findOne();
  if (!doc) doc = await WeeklyOffSetting.create({});
  return doc;
};

exports.getWeeklyOff = async (req, res) => {
  try {
    const doc = await getOrCreateWeeklyOff();
    res.status(200).json({ isOk: true, data: { weeklyOffDays: doc.weeklyOffDays } });
  } catch (error) {
    console.error("Error fetching weekly off:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.updateWeeklyOff = async (req, res) => {
  try {
    const { weeklyOffDays } = req.body;
    if (!Array.isArray(weeklyOffDays) || !weeklyOffDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return res.status(400).json({ isOk: false, message: "weeklyOffDays must be an array of integers 0–6" });
    }
    // A week with no working day at all would mean the entry lock's
    // "2 working days" never arrive (utils/workingDays.js).
    if (new Set(weeklyOffDays).size >= 7) {
      return res.status(400).json({ isOk: false, message: "At least one day of the week must stay a working day — all 7 can't be Weekly Off" });
    }
    const doc = await getOrCreateWeeklyOff();
    const before = [...(doc.weeklyOffDays || [])];
    doc.weeklyOffDays = [...new Set(weeklyOffDays)].sort();
    await doc.save();
    await recordAudit({ req, entityType: "weeklyOff", entity: doc._id, label: "Weekly Off", action: "setting", changes: [{ field: "weeklyOffDays", label: "Weekly Off days", from: dayNames(before) || null, to: dayNames(doc.weeklyOffDays) || null }].filter((c) => c.from !== c.to) });
    res.status(200).json({ isOk: true, data: { weeklyOffDays: doc.weeklyOffDays }, message: "Weekly Off updated" });
  } catch (error) {
    console.error("Error updating weekly off:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};
