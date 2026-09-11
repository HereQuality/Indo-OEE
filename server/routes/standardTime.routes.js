"use strict";
const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createStandardTime,
  updateStandardTime,
  deleteStandardTime,
  getStandardTimeById,
  listStandardTimes,
  searchStandardTimes,
} = require("../controllers/standardTime.controller");

const router = express.Router();

const MENU_URL = "/management/standard-time";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// GET / (?machine=<id>&isActive=true) and GET /:stdId are intentionally left
// without a menu-permission check — they're the shared standard-time lookup
// used by Grinding Data Entry, not just Standard Time Master itself. Only
// admin actions and the master page's own search are menu-gated.
router.get("/", listStandardTimes);
router.post("/", requireMenuPermission(MENU_URL, "write"), createStandardTime);
router.post("/search", requireMenuPermission(MENU_URL, "read"), searchStandardTimes);
router.get("/:stdId", getStandardTimeById);
router.put("/:stdId", requireMenuPermission(MENU_URL, "write"), updateStandardTime);
router.delete("/:stdId", requireMenuPermission(MENU_URL, "write"), deleteStandardTime);

module.exports = router;
