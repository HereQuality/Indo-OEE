const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeById,
  listAllEmployees,
  listTeamMembers,
  listEmployeesByParams,
  listAllEmployeesByDepartment,
  resetPassword,
  impersonateEmployee,
} = require("../controllers/operator.controller");

const { uploadProfilePic } = require("../middlewares/upload.middleware");
const { rewriteUploadPaths } = require("../utils/fileUrl");

const router = express.Router();

const MENU_URL = "/employee-management/employee";
const TEAM_MEMBERS_URLS = ["/access-panel", "/employee-management/team-members"];

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// ── Operator Management page endpoints ──────────────────────────────────────
router.post("/", requireMenuPermission(MENU_URL, "write"), uploadProfilePic.single("profilePic"), rewriteUploadPaths, createEmployee);
router.get("/", requireMenuPermission(MENU_URL, "read"), listAllEmployees);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listEmployeesByParams);
router.post("/department/:departmentId", requireMenuPermission(MENU_URL, "read"), listAllEmployeesByDepartment);

// ── Team Members page endpoints (separate permission, must be BEFORE /:employeeId) ──
// Static sub-paths must come before dynamic /:employeeId or Express will
// match "team-members" as an employeeId and hit the wrong handler.
router.get("/team-members/list", requireMenuPermission(TEAM_MEMBERS_URLS, "read"), listTeamMembers);
router.post("/:employeeId/impersonate", requireMenuPermission(TEAM_MEMBERS_URLS, "write"), impersonateEmployee);

// ── Dynamic employee ID routes ────────────────────────────────────────────
router.get("/:employeeId", requireMenuPermission(MENU_URL, "read"), getEmployeeById);
router.put("/:employeeId", requireMenuPermission(MENU_URL, "write"), uploadProfilePic.single("profilePic"), rewriteUploadPaths, updateEmployee);
router.delete("/:employeeId", requireMenuPermission(MENU_URL, "write"), deleteEmployee);
router.post("/:employeeId/reset-password", requireMenuPermission(MENU_URL, "write"), resetPassword);

module.exports = router;


