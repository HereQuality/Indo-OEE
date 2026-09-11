const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createRole,
  listAllRoles,
  updateRole,
  deleteRole,
  getRoleById,
  listRoleByParams,
} = require("../controllers/roleMaster.controller");

const router = express.Router();

const MENU_URL = "/employee-management/role";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/", requireMenuPermission(MENU_URL, "write"), createRole);
router.get("/", listAllRoles);
router.get("/:roleId", requireMenuPermission(MENU_URL, "read"), getRoleById);
router.put("/:roleId", requireMenuPermission(MENU_URL, "write"), updateRole);
router.delete("/:roleId", requireMenuPermission(MENU_URL, "write"), deleteRole);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listRoleByParams);

module.exports = router;
