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
} = require("../controllers/process.controller");

const router = express.Router();

const MENU_URL = "/management/processes";

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/", requireMenuPermission(MENU_URL, "write"), createProcess);
// Plain list-all stays ungated — it's also consumed elsewhere (e.g. the
// OEE Dashboard's process filter dropdown) by any authenticated role,
// independent of Management menu access.
router.get("/", listProcesses);
router.get("/:processId", requireMenuPermission(MENU_URL, "read"), getProcessById);
router.put("/:processId", requireMenuPermission(MENU_URL, "write"), updateProcess);
router.delete("/:processId", requireMenuPermission(MENU_URL, "write"), deleteProcess);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listProcessByParams);

module.exports = router;
