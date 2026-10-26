const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireAdmin } = require("../utils/adminAccess");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  getSheet,
  getExtent,
  getFilterOptions,
  getOccupied,
  saveRow,
  deleteRow,
  unlockRow,
} = require("../controllers/printingSheet.controller");

const router = express.Router();

const MENU_URL = "/production/printing-data-entry";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.get("/", requireMenuPermission(MENU_URL, "read"), getSheet);
router.get("/extent", requireMenuPermission(MENU_URL, "read"), getExtent);
router.get("/filter-options", requireMenuPermission(MENU_URL, "read"), getFilterOptions);
router.get("/occupied", requireMenuPermission(MENU_URL, "read"), getOccupied);
router.put("/row", requireMenuPermission(MENU_URL, "write"), saveRow);
router.delete("/row/:id", requireMenuPermission(MENU_URL, "write"), deleteRow);
// Super Admin or Full access, not gated by the page's own write permission — an admin override.
router.put("/row/:id/unlock", requireAdmin, unlockRow);

module.exports = router;
