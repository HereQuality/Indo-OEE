const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const c = require("../controllers/machineDayStatus.controller");

// "Not running" marks on the data entry sheets — anyone who can open a
// sheet can read and set them, like the sheet's own entries.
const router = express.Router();
router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));
router.get("/reasons", c.reasons);
router.get("/", c.list);
router.put("/", c.upsert);
router.delete("/", c.remove);
module.exports = router;
