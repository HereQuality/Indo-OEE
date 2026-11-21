const express = require("express");
const { getDashboardReportPdf, emailDashboardReport } = require("../controllers/dashboardReport.controller");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const { requireAdmin } = require("../utils/adminAccess");
const {
  createProcess,
  updateProcess,
  deleteProcess,
  getProcessById,
  listProcesses,
  listProcessByParams,
  getDashboardEntries,
  getShiftAccess,
  setShiftAccess,
} = require("../controllers/process.controller");

const router = express.Router();

const MENU_URL = "/production/processes";
const DASHBOARD_URL = "/production/dashboard";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// The dashboard reads these two, so they follow the dashboard's permission
// (or the master's) rather than requiring access to the master itself.
router.get("/", requireMenuPermission([DASHBOARD_URL, MENU_URL], "read"), listProcesses);
router.get("/entries", requireMenuPermission(DASHBOARD_URL, "read"), getDashboardEntries);
// The dashboard's Efficiency Report as a PDF: download, or mail to the
// Company page's recipients (controllers/dashboardReport.controller.js).
router.get("/entries/report.pdf", requireMenuPermission(DASHBOARD_URL, "read"), getDashboardReportPdf);
// Emailing the report is for Super Admin / Full access only (downloading the PDF is open to the dashboard's readers).
router.post("/entries/report/email", requireMenuPermission(DASHBOARD_URL, "read"), requireAdmin, emailDashboardReport);

router.get("/shift-access", requireMenuPermission([DASHBOARD_URL, MENU_URL], "read"), getShiftAccess);
router.put("/shift-access", setShiftAccess);

router.post("/", requireMenuPermission(MENU_URL, "write"), createProcess);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listProcessByParams);
router.get("/:processId", requireMenuPermission(MENU_URL, "read"), getProcessById);
router.put("/:processId", requireMenuPermission(MENU_URL, "write"), updateProcess);
router.delete("/:processId", requireMenuPermission(MENU_URL, "write"), deleteProcess);

module.exports = router;
