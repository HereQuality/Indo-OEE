const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createProcess,
  updateProcess,
  deleteProcess,
  getProcessById,
  listProcesses,
  listProcessByParams,
  listProcessGroups,
  getDashboardEntries,
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

router.post("/", requireMenuPermission(MENU_URL, "write"), createProcess);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listProcessByParams);
// Before "/:processId", or "groups" would be read as an id.
router.get("/groups", requireMenuPermission(MENU_URL, "read"), listProcessGroups);
router.get("/:processId", requireMenuPermission(MENU_URL, "read"), getProcessById);
router.put("/:processId", requireMenuPermission(MENU_URL, "write"), updateProcess);
router.delete("/:processId", requireMenuPermission(MENU_URL, "write"), deleteProcess);

module.exports = router;
