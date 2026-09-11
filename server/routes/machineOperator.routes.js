"use strict";
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

const MENU_URL = "/management/machine-operators";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// GET / and GET /:operatorId are intentionally left without a menu-permission
// check — they're the shared operator lookup used by Grinding Data Entry and
// the Dashboard, not just Machine Operator Master itself. Only admin actions
// and the master page's own search are menu-gated.
router.get("/", listMachineOperators);
router.post("/", requireMenuPermission(MENU_URL, "write"), createMachineOperator);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listMachineOperatorsByParams);
router.get("/:operatorId", getMachineOperatorById);
router.put("/:operatorId", requireMenuPermission(MENU_URL, "write"), updateMachineOperator);
router.delete("/:operatorId", requireMenuPermission(MENU_URL, "write"), deleteMachineOperator);

module.exports = router;
