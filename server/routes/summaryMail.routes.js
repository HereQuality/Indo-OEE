"use strict";

const express = require("express");
const { protect } = require("../middlewares/auth.middleware");
const { requireAdmin } = require("../utils/adminAccess");
const { getSummaryMail, updateSummaryMail, sendSummaryNow } = require("../controllers/summaryMail.controller");

const router = express.Router();

// Super Admin / Full access only — it's a company-wide setting (Company page).
router.use(protect, requireAdmin);

router.get("/", getSummaryMail);
router.put("/", updateSummaryMail);
router.post("/send", sendSummaryNow);

module.exports = router;
