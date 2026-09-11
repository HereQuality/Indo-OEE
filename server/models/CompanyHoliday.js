const mongoose = require("mongoose");

/**
 * models/CompanyHoliday.js
 * ────────────────────────────
 * Admin-managed list of days the company doesn't operate — public
 * holidays, festivals, a scheduled plant shutdown, etc. Single global
 * list (this is a single-tenant deployment, same as Company Management —
 * see server/utils/resolveCompanyId.js), managed from Operator
 * Management > Company Holidays by whichever roles are granted access
 * via Manage Role (see server/routes/companyHoliday.routes.js).
 *
 * `date` is the anchor calendar date. For a one-off holiday (e.g. a
 * specific shutdown day) it's used as-is. For `isRecurringYearly` ones
 * (Republic Day, Independence Day, ...) only its month/day are reused —
 * the year is just whatever year it was first entered in (see
 * client/src/pages/CompanyHolidays.jsx#formatHolidayDate, which hides the
 * year for these so it never reads as "only applies in 2020").
 */
const CompanyHolidaySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    date: {
      type: Date,
      required: true,
    },
    isRecurringYearly: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

CompanyHolidaySchema.index({ date: 1 });

module.exports = mongoose.model("CompanyHoliday", CompanyHolidaySchema);
