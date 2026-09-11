"use strict";
/**
 * routes/companyHoliday.routes.js
 * ────────────────────────────
 * Company Holidays lives under Operator Management (Administration >
 * Company Holidays doesn't gate write access to SuperAdmin alone) — any
 * role granted access to this menu via Manage Role can read/fill it, same
 * shape as department.routes.js/holiday.routes.js.
 */
const express = require("express");
const {
  createCompanyHoliday,
  updateCompanyHoliday,
  deleteCompanyHoliday,
  listCompanyHolidays,
  getWeeklyOff,
  updateWeeklyOff,
} = require("../controllers/companyHoliday.controller");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");

const router = express.Router();

const MENU_URL = "/employee-management/company-holidays";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Registered ahead of the "/:id" routes below so "weekly-off" is never
// swallowed as an :id param.
// Read is ungated (same reasoning as listCompanyHolidays below) — every
// logged-in user needs the weekly-off days for Grinding Data Entry's
// client-side edit-window check, not just Company Holidays itself.
router.get("/weekly-off", getWeeklyOff);
router.put("/weekly-off", requireMenuPermission(MENU_URL, "write"), updateWeeklyOff);

router.post("/", requireMenuPermission(MENU_URL, "write"), createCompanyHoliday);
router.get("/", listCompanyHolidays);
router.put("/:id", requireMenuPermission(MENU_URL, "write"), updateCompanyHoliday);
router.delete("/:id", requireMenuPermission(MENU_URL, "write"), deleteCompanyHoliday);

module.exports = router;
