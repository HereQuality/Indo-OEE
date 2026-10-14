const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireAdmin } = require("../utils/adminAccess");
const { getAccess, listReviews, decide, listLogs } = require("../controllers/oeeReview.controller");

const router = express.Router();

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Anyone logged in may ask whether they can review; everything else is Admin / Super Admin only.
router.get("/access", getAccess);
router.get("/", requireAdmin, listReviews);
router.get("/logs", requireAdmin, listLogs);
router.put("/:sheet/:id", requireAdmin, decide);

module.exports = router;
