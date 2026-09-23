const mongoose = require("mongoose");

/**
 * models/WeeklyOffSetting.js
 * ────────────────────────────
 * Which day(s) of the week the company doesn't operate at all — a single
 * document for the whole app (there's one company in practice; see
 * Company.js), read/written through controllers/companyHoliday.controller.js
 * getWeeklyOff/updateWeeklyOff. 0=Sunday … 6=Saturday, same as Date#getDay().
 *
 * Defaults to Sunday only until someone changes it in Company Holidays.
 */
const WeeklyOffSettingSchema = new mongoose.Schema(
  {
    weeklyOffDays: {
      type: [Number],
      default: [0],
      validate: {
        validator: (arr) => arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: "weeklyOffDays must be integers 0–6",
      },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("WeeklyOffSetting", WeeklyOffSettingSchema);
