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

const MENU_URL = "/production/machines";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Plain list stays open to every logged-in role — the data entry sheet
// needs it to lay out its rows.
router.get("/", listMachines);
router.post("/", requireMenuPermission(MENU_URL, "write"), createMachine);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listMachineByParams);
router.get("/:machineId", requireMenuPermission(MENU_URL, "read"), getMachineById);
router.put("/:machineId", requireMenuPermission(MENU_URL, "write"), updateMachine);
router.delete("/:machineId", requireMenuPermission(MENU_URL, "write"), deleteMachine);

module.exports = router;
