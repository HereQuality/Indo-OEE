const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireAdmin } = require("../utils/adminAccess");
const { getAccess, listReviews, decide, reopen, applyShift, listLogs } = require("../controllers/oeeReview.controller");

const router = express.Router();

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Anyone logged in may ask whether they can review; everything else is Admin / Super Admin only.
router.get("/access", getAccess);
router.get("/", requireAdmin, listReviews);
router.get("/logs", requireAdmin, listLogs);
router.put("/:sheet/:id", requireAdmin, decide);
// Whoever saved a rejected entry (checked in the handler), or a Full access user.
router.put("/:sheet/:id/reopen", reopen);
// Bring one earlier entry onto the process's current Planned Operator Shift.
router.put("/:sheet/:id/shift", requireAdmin, applyShift);

module.exports = router;
