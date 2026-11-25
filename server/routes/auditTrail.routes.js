const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const { isAdminUser } = require("../utils/adminAccess");
const { list, filters, exportCsv } = require("../controllers/auditTrail.controller");

/**
 * routes/auditTrail.routes.js
 * ────────────────────────────
 * The Audit Trail page's API (controllers/auditTrail.controller.js). Read-only:
 * the log is append-only and has no write route anywhere.
 *
 * Who may read it: Super Admin (requireMenuPermission lets them through
 * itself), a Full access role (utils/adminAccess.js), or any role given the
 * "Audit Trail" menu's view tick in Manage Role (seed/seedMenus.js adds the
 * menu; the tick is given by hand).
 */
const router = express.Router();

// The page's menuUrl without its role slug, the way permission.middleware.js
// matches it (by suffix) — seed/seedMenus.js stores "/hqepl/production/audit-trail".
const MENU_URL = "/production/audit-trail";

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

router.get("/", canRead, list);
router.get("/filters", canRead, filters);
router.get("/export.csv", canRead, exportCsv);

module.exports = router;
