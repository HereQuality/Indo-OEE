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
} = require("../controllers/rawCastingSheet.controller");

const router = express.Router();

// RAW CASTING (sheet key "rawCasting") — its own page, on AFTER POWDER COATING's template.
const MENU_URL = "/production/raw-casting-data-entry";

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
