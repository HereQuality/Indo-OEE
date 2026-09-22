const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createMachineOperator,
  updateMachineOperator,
  deleteMachineOperator,
  getMachineOperatorById,
  listMachineOperators,
  listMachineOperatorsByParams,
} = require("../controllers/machineOperator.controller");

const router = express.Router();

const MENU_URL = "/production/operators";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Plain list stays open to every logged-in role — Production Data Entry's
// Operator dropdown uses it, same as Items does for its own plain list.
router.get("/", listMachineOperators);
router.post("/", requireMenuPermission(MENU_URL, "write"), createMachineOperator);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listMachineOperatorsByParams);
router.get("/:operatorId", requireMenuPermission(MENU_URL, "read"), getMachineOperatorById);
router.put("/:operatorId", requireMenuPermission(MENU_URL, "write"), updateMachineOperator);
router.delete("/:operatorId", requireMenuPermission(MENU_URL, "write"), deleteMachineOperator);

module.exports = router;
