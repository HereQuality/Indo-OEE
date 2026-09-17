"use strict";

const express = require("express");
const { getMaintenanceStatus, updateMaintenance } = require("../controllers/maintenance.controller");
const { protect, authorize } = require("../middlewares/auth.middleware");

const router = express.Router();

// Public — the block screen/popup needs to read this
// before we know who, if anyone, is logged in.
router.get("/status", getMaintenanceStatus);

// SuperAdmin only — flips the live kill-switch and/or sets the
// scheduled-maintenance announcement.
router.put("/", protect, authorize("SuperAdmin"), updateMaintenance);

module.exports = router;
