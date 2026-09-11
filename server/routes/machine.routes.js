const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createMachine,
  updateMachine,
  deleteMachine,
  getMachineById,
  listMachines,
  listMachineByParams,
} = require("../controllers/machine.controller");

const router = express.Router();

const MENU_URL = "/management/machines";

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/", requireMenuPermission(MENU_URL, "write"), createMachine);
// Plain list-all stays ungated — it's also consumed elsewhere (e.g. the
// OEE Dashboard's machine filter dropdown) by any authenticated role,
// independent of Management menu access.
router.get("/", listMachines);
router.get("/:machineId", requireMenuPermission(MENU_URL, "read"), getMachineById);
router.put("/:machineId", requireMenuPermission(MENU_URL, "write"), updateMachine);
router.delete("/:machineId", requireMenuPermission(MENU_URL, "write"), deleteMachine);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listMachineByParams);

module.exports = router;
