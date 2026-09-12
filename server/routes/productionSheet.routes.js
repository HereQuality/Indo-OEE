const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const { getSheet, saveRow, deleteRow, listOperatorNames, listRejectReasons } = require("../controllers/productionSheet.controller");

const router = express.Router();

const MENU_URL = "/production/data-entry";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.get("/", requireMenuPermission(MENU_URL, "read"), getSheet);
router.get("/operators", requireMenuPermission(MENU_URL, "read"), listOperatorNames);
router.get("/reject-reasons", requireMenuPermission(MENU_URL, "read"), listRejectReasons);
router.put("/row", requireMenuPermission(MENU_URL, "write"), saveRow);
router.delete("/row/:id", requireMenuPermission(MENU_URL, "write"), deleteRow);

module.exports = router;
