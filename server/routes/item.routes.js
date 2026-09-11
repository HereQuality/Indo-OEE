const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  createItem,
  updateItem,
  deleteItem,
  getItemById,
  listItems,
  listItemByParams,
} = require("../controllers/item.controller");

const router = express.Router();

const MENU_URL = "/management/items";

// Apply auth middleware to all routes
router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.post("/", requireMenuPermission(MENU_URL, "write"), createItem);
// Plain list-all stays ungated, same convention as Process/Machine, in
// case other pages need it as dropdown data later.
router.get("/", listItems);
router.get("/:itemId", requireMenuPermission(MENU_URL, "read"), getItemById);
router.put("/:itemId", requireMenuPermission(MENU_URL, "write"), updateItem);
router.delete("/:itemId", requireMenuPermission(MENU_URL, "write"), deleteItem);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listItemByParams);

module.exports = router;
