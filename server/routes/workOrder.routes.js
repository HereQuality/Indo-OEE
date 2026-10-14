const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createWorkOrder,
  updateWorkOrder,
  deleteWorkOrder,
  getWorkOrderById,
  listWorkOrders,
  listWorkOrderByParams,
  getWorkOrderProgress,
} = require("../controllers/workOrder.controller");

const router = express.Router();

const MENU_URL = "/production/work-orders";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Plain list stays open to every logged-in role — the data entry sheet uses it
// for its Work Order No. picker.
router.get("/", listWorkOrders);
router.post("/", requireMenuPermission(MENU_URL, "write"), createWorkOrder);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listWorkOrderByParams);
router.get("/progress", requireMenuPermission(MENU_URL, "read"), getWorkOrderProgress);
router.get("/:workOrderId", requireMenuPermission(MENU_URL, "read"), getWorkOrderById);
router.put("/:workOrderId", requireMenuPermission(MENU_URL, "write"), updateWorkOrder);
router.delete("/:workOrderId", requireMenuPermission(MENU_URL, "write"), deleteWorkOrder);

module.exports = router;
