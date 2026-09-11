const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createOperatorRoles,
  getOperatorRoles,
  updateOperatorRoles,
} = require("../controllers/operatorRoles.controller");

const router = express.Router();

// NOTE: GET is intentionally NOT gated by requireMenuPermission. Every
// logged-in Operator calls GET /:roleId with their OWN roleId to
// resolve their own permissions and build their sidebar (see
// MenuContext.fetchOperatorRoles) — gating it on "manage-role" write
// access would break every operator's menu on login. Only the
// mutating endpoints (assigning permissions to a role) are
// Manage-Role-permission-gated.
const MENU_URL = "/employee-management/manage-role";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/", requireMenuPermission(MENU_URL, "write"), createOperatorRoles);
router.get("/:roleId", getOperatorRoles);
router.put("/:roleId", requireMenuPermission(MENU_URL, "write"), updateOperatorRoles);

module.exports = router;
