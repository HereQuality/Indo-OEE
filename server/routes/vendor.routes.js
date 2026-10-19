const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createVendor,
  updateVendor,
  deleteVendor,
  getVendorById,
  listVendors,
  listVendorsByParams,
} = require("../controllers/vendor.controller");

const router = express.Router();

const MENU_URL = "/production/vendors";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Plain list stays open to every logged-in role — every entry form's Vendor
// Name box uses it, same as Machine Operators does for its own plain list.
router.get("/", listVendors);
router.post("/", requireMenuPermission(MENU_URL, "write"), createVendor);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listVendorsByParams);
router.get("/:vendorId", requireMenuPermission(MENU_URL, "read"), getVendorById);
router.put("/:vendorId", requireMenuPermission(MENU_URL, "write"), updateVendor);
router.delete("/:vendorId", requireMenuPermission(MENU_URL, "write"), deleteVendor);

module.exports = router;
