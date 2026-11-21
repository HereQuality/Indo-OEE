"use strict";

const express = require("express");
const { getAppUpdateStatus, updateAppUpdate, reportAppVersion } = require("../controllers/appUpdate.controller");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { releaseAuth } = require("../middlewares/releaseAuth.middleware");

const router = express.Router();

// Public — the mobile app's update gate needs to read this before login
// even resolves.
router.get("/status", getAppUpdateStatus);

// SuperAdmin only — sets the minimum / latest version (one value for both
// Android and iOS) and/or flips the force-update switch.
router.put("/", protect, authorize("SuperAdmin"), updateAppUpdate);

// Machine-to-machine — a build/release script reports what version it just
// published (see releaseAuth.middleware.js + mobile/scripts/report_version.sh), not a logged-in person.
router.post("/report-version", releaseAuth, reportAppVersion);

module.exports = router;
