"use strict";
/**
 * middlewares/editWindow.middleware.js
 *
 * Enforces the "2 working days" edit window on Production Entries
 * (see server/utils/workingDays.js for the working-day math — the
 * configured weekly-off day(s) don't count, and Company Holidays don't
 * count either). Applied to PUT/DELETE routes for :entryId, after
 * requireMenuPermission has already confirmed the user has write access to
 * the page at all. SuperAdmin bypasses this, same convention as
 * requireMenuPermission's own SuperAdmin bypass.
 */

const ProductionEntry = require("../models/ProductionEntry");
const CompanyHoliday = require("../models/CompanyHoliday");
const { CompanySettings } = require("../models/CompanySettings");
const AppError = require("../utils/AppError");
const { isEntryEditable, buildHolidaySet } = require("../utils/workingDays");

const requireEditWindow = async (req, res, next) => {
  try {
    if (req.user?.roleType === "SuperAdmin") return next();

    const entry = await ProductionEntry.findById(req.params.entryId).select("date");
    if (!entry) return next(new AppError("Entry not found", 404));

    const [holidays, settings] = await Promise.all([
      CompanyHoliday.find({}).select("date isRecurringYearly").lean(),
      CompanySettings.findOne().select("weeklyOffDays").lean(),
    ]);
    const holidaySet = buildHolidaySet(holidays);

    if (!isEntryEditable(entry.date, new Date(), 2, holidaySet, settings?.weeklyOffDays)) {
      return next(
        new AppError(
          "Edit window closed — entries can only be edited within 2 working days.",
          423
        )
      );
    }

    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireEditWindow };
