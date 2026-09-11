const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDeparmentById,
  listDepartments,
  listDepartmentByParams,
} = require("../controllers/department.controller");

const router = express.Router();

const MENU_URL = "/employee-management/department";

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/", requireMenuPermission(MENU_URL, "write"), createDepartment);
router.get("/", listDepartments);
router.get("/:departmentId", requireMenuPermission(MENU_URL, "read"), getDeparmentById);
router.put("/:departmentId", requireMenuPermission(MENU_URL, "write"), updateDepartment);
router.delete("/:departmentId", requireMenuPermission(MENU_URL, "write"), deleteDepartment);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listDepartmentByParams);

module.exports = router;
