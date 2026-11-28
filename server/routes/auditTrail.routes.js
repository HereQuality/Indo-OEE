const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const { isAdminUser } = require("../utils/adminAccess");
const { list, filters, summary, exportCsv, pageView, clientError } = require("../controllers/auditTrail.controller");

/**
 * routes/auditTrail.routes.js
 * ────────────────────────────
 * The Audit Trail page's API (controllers/auditTrail.controller.js). Read-only:
 * the log is append-only and has no write route anywhere.
 *
 * Who may read it: Super Admin (requireMenuPermission lets them through
 * itself), a Full access role (utils/adminAccess.js), or any role given the
 * "Logs" menu's view tick in Manage Role (seed/seedMenus.js adds the menu, in
 * Administration; the tick is given by hand).
 */
const router = express.Router();

// The page's menuUrl without its role slug, the way permission.middleware.js
// matches it (by suffix) — seed/seedMenus.js stores "/hqepl/logs" (the page
// was "Audit Trail" at /hqepl/production/audit-trail; a database the seed
// hasn't moved yet still has that URL, so both are accepted).
const MENU_URL = ["/logs", "/production/audit-trail"];

const canRead = async (req, res, next) => {
  try {
    if (await isAdminUser(req)) return next();
  } catch (error) {
    return next(error);
  }
  return requireMenuPermission(MENU_URL, "read")(req, res, next);
};

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

// Any signed-in person reports their own page views and screen errors (written about the caller only).
router.post("/page-view", pageView);
router.post("/client-error", clientError);

router.get("/", canRead, list);
router.get("/filters", canRead, filters);
router.get("/summary", canRead, summary);
router.get("/export.csv", canRead, exportCsv);

module.exports = router;
