const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  getSheet,
  getExtent,
  getFilterOptions,
  getOccupied,
  saveRow,
  deleteRow,
  unlockRow,
  listOperatorNames,
  listRejectReasons,
} = require("../controllers/productionSheet.controller");

const router = express.Router();

const MENU_URL = "/production/cnc-data-entry";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.get("/", requireMenuPermission(MENU_URL, "read"), getSheet);
router.get("/extent", requireMenuPermission(MENU_URL, "read"), getExtent);
router.get("/filter-options", requireMenuPermission(MENU_URL, "read"), getFilterOptions);
router.get("/occupied", requireMenuPermission(MENU_URL, "read"), getOccupied);
router.get("/operators", requireMenuPermission(MENU_URL, "read"), listOperatorNames);
router.get("/reject-reasons", requireMenuPermission(MENU_URL, "read"), listRejectReasons);
router.put("/row", requireMenuPermission(MENU_URL, "write"), saveRow);
router.delete("/row/:id", requireMenuPermission(MENU_URL, "write"), deleteRow);
// Super Admin only, not gated by the page's own write permission — this is
// an admin override, not a normal data-entry action.
router.put("/row/:id/unlock", authorize("SuperAdmin"), unlockRow);

module.exports = router;
