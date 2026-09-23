const CompanyHoliday = require("../models/CompanyHoliday");
const WeeklyOffSetting = require("../models/WeeklyOffSetting");

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

    const holiday = await CompanyHoliday.findByIdAndUpdate(holidayId, data, { new: true, runValidators: true });
    if (!holiday) return res.status(404).json({ isOk: false, message: "Holiday not found" });
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
    const doc = await getOrCreateWeeklyOff();
    doc.weeklyOffDays = [...new Set(weeklyOffDays)].sort();
    await doc.save();
    res.status(200).json({ isOk: true, data: { weeklyOffDays: doc.weeklyOffDays }, message: "Weekly Off updated" });
  } catch (error) {
    console.error("Error updating weekly off:", error);
    res.status(400).json({ isOk: false, message: error.message });
  }
};
