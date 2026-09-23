const mongoose = require("mongoose");

/**
 * models/CompanyHoliday.js
 * ─────────────────────────
 * A specific day the company doesn't operate — a named holiday (e.g.
 * "Independence Day"), one-off or repeating every year. The OTHER kind of
 * non-working day, the weekly off (e.g. every Sunday), lives separately on
 * WeeklyOffSetting since it isn't a date, it's a day-of-week rule.
 *
 * Together these two drive the production entry lock (see
 * server/utils/workingDays.js): an entry can be edited/deleted until 2
 * *working* days after its own date have passed, where a working day skips
 * both the weekly-off day(s) and any active holiday here.
 *
 * `date`'s year is meaningless for a recurring-yearly holiday — only its
 * month/day are used every year — but Mongoose needs a real Date, so it's
 * whatever year the holiday was first entered in. The client formats it
 * without a year for those (see formatHolidayDate in CompanyHolidays.jsx).
 */
const CompanyHolidaySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Holiday name is required"],
      trim: true,
      maxlength: [80, "Name must be 80 characters or fewer"],
    },
    date: {
      type: Date,
      required: [true, "Date is required"],
    },
    isRecurringYearly: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("CompanyHoliday", CompanyHolidaySchema);
