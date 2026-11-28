"use strict";

const express = require("express");
const { protect } = require("../middlewares/auth.middleware");
const { requireAdmin } = require("../utils/adminAccess");
const { getSummaryMail, updateSummaryMail, sendSummaryNow, scheduleTest, cancelTest } = require("../controllers/summaryMail.controller");

const router = express.Router();

// Super Admin / Full access only — it's a company-wide setting (Company page).
router.use(protect, requireAdmin);

router.get("/", getSummaryMail);
router.put("/", updateSummaryMail);
router.post("/send", sendSummaryNow);
router.post("/test", scheduleTest);
router.delete("/test", cancelTest);

module.exports = router;
