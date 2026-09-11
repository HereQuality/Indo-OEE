const CompanyHoliday = require("../models/CompanyHoliday");
const { getOrCreateSettings } = require("../models/CompanySettings");

// Create
exports.createCompanyHoliday = async (req, res) => {
  try {
    const { name, date, isRecurringYearly } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ isOk: false, message: "Name is required" });
    }
    if (!date) {
      return res.status(400).json({ isOk: false, message: "Date is required" });
    }

    const holiday = await CompanyHoliday.create({
      name: name.trim(),
      date,
      isRecurringYearly: !!isRecurringYearly,
    });

    res.status(201).json({ isOk: true, data: holiday, message: "Holiday added successfully" });
  } catch (error) {
    console.error("Error creating company holiday:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update
exports.updateCompanyHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, isRecurringYearly } = req.body;
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ isOk: false, message: "Name is required" });
    }

    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (date !== undefined) update.date = date;
    if (isRecurringYearly !== undefined) update.isRecurringYearly = !!isRecurringYearly;

    const holiday = await CompanyHoliday.findByIdAndUpdate(id, update, { new: true, runValidators: true });
    if (!holiday) return res.status(404).json({ isOk: false, message: "Holiday not found" });

    res.status(200).json({ isOk: true, data: holiday, message: "Holiday updated successfully" });
  } catch (error) {
    console.error("Error updating company holiday:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.deleteCompanyHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const holiday = await CompanyHoliday.findByIdAndDelete(id);
    if (!holiday) return res.status(404).json({ isOk: false, message: "Holiday not found" });
    res.status(200).json({ isOk: true, message: "Holiday deleted successfully" });
  } catch (error) {
    console.error("Error deleting company holiday:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all — sorted by calendar month/day (not year) so a recurring
// yearly holiday and a one-off both sort the way an admin actually scans
// a holiday list (Jan -> Dec), regardless of what year `date` happens to
// be stored against.
exports.listCompanyHolidays = async (req, res) => {
  try {
    const holidays = await CompanyHoliday.find({}).lean();
    holidays.sort((a, b) => {
      const da = new Date(a.date);
      const db = new Date(b.date);
      return (da.getUTCMonth() - db.getUTCMonth()) || (da.getUTCDate() - db.getUTCDate());
    });
    res.status(200).json({ isOk: true, data: holidays });
  } catch (error) {
    console.error("Error listing company holidays:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Weekly Off — company-wide day(s) off. This is the ONLY place
// weekly-off is configured; there is no other/hardcoded day-off logic
// anywhere else in this feature. ──

exports.getWeeklyOff = async (req, res) => {
  try {
    const settings = await getOrCreateSettings();
    res.status(200).json({ isOk: true, data: { weeklyOffDays: settings.weeklyOffDays || [] } });
  } catch (error) {
    console.error("Error fetching weekly off:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.updateWeeklyOff = async (req, res) => {
  try {
    const { weeklyOffDays } = req.body;
    if (!Array.isArray(weeklyOffDays) || weeklyOffDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      return res.status(400).json({ isOk: false, message: "weeklyOffDays must be an array of integers 0-6." });
    }

    const settings = await getOrCreateSettings();
    settings.weeklyOffDays = [...new Set(weeklyOffDays.map(Number))].sort();
    await settings.save();

    res.status(200).json({
      isOk: true,
      data: { weeklyOffDays: settings.weeklyOffDays },
      message: "Weekly Off updated successfully",
    });
  } catch (error) {
    console.error("Error updating weekly off:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
