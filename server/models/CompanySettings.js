"use strict";
const mongoose = require("mongoose");

/**
 * models/CompanySettings.js
 * ────────────────────────────
 * Single global settings document (singleton, same pattern as
 * CompanyHoliday's admin-managed list) — currently just Weekly Off
 * day(s). Read/written via companyHoliday.controller.js's getWeeklyOff/
 * updateWeeklyOff through getOrCreateSettings below.
 *
 * `weeklyOffDays` is an array of weekday integers (0=Sunday..6=Saturday,
 * matching Date#getDay()).
 */
const CompanySettingsSchema = new mongoose.Schema(
  {
    weeklyOffDays: {
      type: [{ type: Number, min: 0, max: 6 }],
      default: [],
    },
  },
  { timestamps: true },
);

const CompanySettings = mongoose.model("CompanySettings", CompanySettingsSchema);

// Returns the single settings document, creating it with defaults if it
// doesn't exist yet — callers never need to worry about "no settings row".
const getOrCreateSettings = async () => {
  let settings = await CompanySettings.findOne();
  if (!settings) settings = await CompanySettings.create({});
  return settings;
};

module.exports = { CompanySettings, getOrCreateSettings };
