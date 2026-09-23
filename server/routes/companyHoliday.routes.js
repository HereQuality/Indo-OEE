const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  getAllHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  getWeeklyOff,
  updateWeeklyOff,
} = require("../controllers/companyHoliday.controller");

const router = express.Router();

const MENU_URL = "/employee-management/company-holidays";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Every logged-in role can read the calendar (it's what the production
// entry lock is checked against), same as department listing — only
// adding/editing needs the page's own "write" permission.
router.get("/", getAllHolidays);
router.get("/weekly-off", getWeeklyOff);
router.post("/", requireMenuPermission(MENU_URL, "write"), createHoliday);
router.put("/:holidayId", requireMenuPermission(MENU_URL, "write"), updateHoliday);
router.delete("/:holidayId", requireMenuPermission(MENU_URL, "write"), deleteHoliday);
router.put("/weekly-off/update", requireMenuPermission(MENU_URL, "write"), updateWeeklyOff);

module.exports = router;
