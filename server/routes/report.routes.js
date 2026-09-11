const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const { downloadOeeReport, downloadDashboardOeeReport, downloadDailyOeeTrendReport, downloadEfficiencyCardReport } = require("../controllers/report.controller");

const router = express.Router();

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Reuses the Dashboard's own "read" permission — downloading a report is a
// Dashboard capability, not a separate page that needs its own menu entry.
router.get("/oee", requireMenuPermission("/dashboard", "read"), downloadOeeReport);
router.get("/oee/dashboard", requireMenuPermission("/dashboard", "read"), downloadDashboardOeeReport);
router.get("/oee/card", requireMenuPermission("/dashboard", "read"), downloadEfficiencyCardReport);
// POST (not GET) since the already-computed chart data is sent in the body.
router.post("/oee/trend", requireMenuPermission("/dashboard", "read"), downloadDailyOeeTrendReport);

module.exports = router;
