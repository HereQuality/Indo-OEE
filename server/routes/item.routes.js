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

const MENU_URL = "/production/items";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Plain list stays open to every logged-in role — the data entry sheet
// uses it for Item Name autofill.
router.get("/", listItems);
router.post("/", requireMenuPermission(MENU_URL, "write"), createItem);
router.post("/search", requireMenuPermission(MENU_URL, "read"), listItemByParams);
router.get("/:itemId", requireMenuPermission(MENU_URL, "read"), getItemById);
router.put("/:itemId", requireMenuPermission(MENU_URL, "write"), updateItem);
router.delete("/:itemId", requireMenuPermission(MENU_URL, "write"), deleteItem);

module.exports = router;
