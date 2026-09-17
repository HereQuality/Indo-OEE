"use strict";

const express = require("express");
const { getAnnouncementStatus, updateAnnouncement } = require("../controllers/announcement.controller");
const { protect, authorize } = require("../middlewares/auth.middleware");

const router = express.Router();

// Public — read by every logged-in session to decide whether to show
// today's toast, same reasoning as maintenance.routes.js's /status.
router.get("/status", getAnnouncementStatus);

// SuperAdmin only — enables/disables the announcement, sets its message
// and display window.
router.put("/", protect, authorize("SuperAdmin"), updateAnnouncement);

module.exports = router;
