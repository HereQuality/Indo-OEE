const mongoose = require("mongoose");

/**
 * models/SummaryMailSetting.js
 * ─────────────────────────────
 * Who gets the dashboard's OEE and OK Qty summary by email, and when — one
 * document for the whole company (like WeeklyOffSetting.js), managed on the
 * Company page (client Components/Common/SummaryMailCard.jsx) and acted on
 * by jobs/summaryMail.js:
 *
 *   daily   on each of `dailyDays` (every day by default) at `dailySendAt`
 *           (IST, 9:00 AM by default), covering the previous day in full, so
 *           Saturday's arrives on Sunday — and, when some weekdays are
 *           unticked, on the first send day after a gap every day since the
 *           last send day
 *   weekly  every `weeklyDay` (Monday) at `weeklySendAt` (9:30 AM), covering
 *           the previous Monday to Sunday (Sunday's entries, if any, included)
 *
 * `lastDailyFor` / `lastWeeklyFor` remember the last period mailed, so a
 * restart never sends the same summary twice (or skips one that was due
 * while the server was down for less than a day).
 *
 * `testAt` is a one-off test send booked on the Company page (Email reports
 * tab › "Send a test at"): at that moment the scheduler mails `testKind`
 * ("daily", "weekly" or "both") to `testTo` (or the recipients when empty),
 * then clears it. Kept here, so a restart doesn't lose it.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SummaryMailSettingSchema = new mongoose.Schema(
  {
    recipients: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 50 && arr.every((e) => EMAIL_RE.test(e)),
        message: "Each recipient must be a valid email address (at most 50)",
      },
    },
    dailyEnabled: { type: Boolean, default: true },
    weeklyEnabled: { type: Boolean, default: true },
    // "HH:mm", 24-hour, Indian Standard Time.
    dailySendAt: { type: String, default: "09:00", match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Daily send time must be HH:mm"] },
    // Weekdays the daily mail goes out on (0 = Sunday … 6 = Saturday); every day by default.
    dailyDays: {
      type: [Number],
      default: () => [0, 1, 2, 3, 4, 5, 6],
      validate: {
        validator: (arr) => arr.length >= 1 && arr.every((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        message: "Pick at least one day for the daily mail",
      },
    },
    weeklySendAt: { type: String, default: "09:30", match: [/^([01]\d|2[0-3]):[0-5]\d$/, "Weekly send time must be HH:mm"] },
    // 0 = Sunday … 6 = Saturday, like Date#getDay(); Monday by default.
    weeklyDay: { type: Number, default: 1, min: 0, max: 6 },
    lastDailyFor: { type: String, default: "" },
    lastWeeklyFor: { type: String, default: "" },
    testAt: { type: Date, default: null },
    testKind: { type: String, enum: ["daily", "weekly", "both"], default: "daily" },
    testTo: { type: [String], default: [] },
    testByName: { type: String, default: "" },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true },
);

let cachedId = null;
const getOrCreateSummaryMail = async () => {
  const Model = mongoose.model("SummaryMailSetting");
  if (cachedId) {
    const found = await Model.findById(cachedId);
    if (found) return found;
  }
  const doc = (await Model.findOne({})) || (await Model.create({}));
  cachedId = doc._id;
  return doc;
};

module.exports = mongoose.model("SummaryMailSetting", SummaryMailSettingSchema);
module.exports.getOrCreateSummaryMail = getOrCreateSummaryMail;
module.exports.EMAIL_RE = EMAIL_RE;
