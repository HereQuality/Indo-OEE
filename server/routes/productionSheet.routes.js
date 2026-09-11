const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const { getSheet, saveRow, listOperatorNames } = require("../controllers/productionSheet.controller");

const router = express.Router();

const MENU_URL = "/production/data-entry";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.get("/", requireMenuPermission(MENU_URL, "read"), getSheet);
router.get("/operators", requireMenuPermission(MENU_URL, "read"), listOperatorNames);
router.put("/row", requireMenuPermission(MENU_URL, "write"), saveRow);

module.exports = router;
