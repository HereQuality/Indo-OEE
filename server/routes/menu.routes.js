const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const {
  createMenuGroup,
  getAllMenuGroups,
  updateMenuGroup,
  deleteMenuGroup,
  listMenuGroupByParams,
  getMenuGroupById,
} = require("../controllers/menuGroup.controller");
const {
  createMenuMaster,
  getAllMenuMasters,
  updateMenuMaster,
  deleteMenuMaster,
  listMenuMasterByParams,
  getMenuMasterById,
  getMenuByGroups,
  getMenuTest,
} = require("../controllers/menuMaster.controller");

const router = express.Router();

// Menu Master / Menu Group define what pages exist and how they're grouped
// in the sidebar — that's a SuperAdmin-only capability (you build the app's
// page structure; the client's Admin role only ever assigns access to
// what already exists, via Manage Role).
const superAdminOnly = [protect, authorize("SuperAdmin")];

// ============ MENU GROUP ENDPOINTS ============
router.post("/menu-groups", ...superAdminOnly, createMenuGroup);
router.get("/menu-groups", ...superAdminOnly, getAllMenuGroups);
router.get("/menu-groups/:menuGroupId", ...superAdminOnly, getMenuGroupById);
router.put("/menu-groups/:menuGroupId", ...superAdminOnly, updateMenuGroup);
router.delete("/menu-groups/:menuGroupId", ...superAdminOnly, deleteMenuGroup);
router.post("/menu-groups/search", ...superAdminOnly, listMenuGroupByParams);

// ============ MENU MASTER ENDPOINTS ============
router.post("/menus", ...superAdminOnly, createMenuMaster);
router.get("/menus", ...superAdminOnly, getAllMenuMasters);
// Every authenticated role (SuperAdmin or Operator) needs this one to build their own sidebar
router.get("/menus/by-groups", protect, getMenuByGroups);
router.get("/menus/test", protect, getMenuTest);
router.get("/menus/:menuMasterId", ...superAdminOnly, getMenuMasterById);
router.put("/menus/:menuMasterId", ...superAdminOnly, updateMenuMaster);
router.delete("/menus/:menuMasterId", ...superAdminOnly, deleteMenuMaster);
router.post("/menus/search", ...superAdminOnly, listMenuMasterByParams);

module.exports = router;