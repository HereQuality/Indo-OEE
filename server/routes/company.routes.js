const express = require("express");
const companyController = require("../controllers/company.controller");
const { uploadCompanyAssets } = require("../middlewares/upload.middleware");
const { rewriteUploadPaths } = require("../utils/fileUrl");
const { protect, authorize } = require("../middlewares/auth.middleware");

const router = express.Router();

// Get global company details
router.get("/getCompanyDetails", companyController.getCompanyDetails);

// Get all companies (fallback to getCompanyDetails for old client endpoints)
router.get("/", companyController.getCompanies);

const validateFaviconSize = (req, res, next) => {
  if (req.files && req.files.favicon && req.files.favicon[0]) {
    if (req.files.favicon[0].size > 2 * 1024 * 1024) {
      const AppError = require("../utils/AppError");
      return next(new AppError("Favicon too large. Max size: 2MB", 400));
    }
  }
  next();
};

// Update global company settings (creates it if doesn't exist)
// Supports both POST /updateCompany and PUT / (frontend uses PUT /)
const updateMiddlewares = [
  protect,
  authorize("SuperAdmin"),
  uploadCompanyAssets.fields([
    { name: "logo", maxCount: 1 },
    { name: "favicon", maxCount: 1 },
  ]),
  rewriteUploadPaths,
  validateFaviconSize,
  companyController.updateCompany,
];

router.post("/updateCompany", ...updateMiddlewares);
router.put("/", ...updateMiddlewares);

// Fallbacks for other routes — platform-level admin actions, SuperAdmin only.
router.delete("/deleteCompany/:id", protect, authorize("SuperAdmin"), companyController.deleteCompany);
router.post("/authorizeMenus", protect, authorize("SuperAdmin"), companyController.authorizeMenus);
router.get("/admin/stats", protect, authorize("SuperAdmin"), companyController.getAdminStats);

module.exports = router;