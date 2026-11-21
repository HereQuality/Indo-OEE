const express = require("express");
const { protect, authorize } = require("../middlewares/auth.middleware");
const { requireMenuPermission } = require("../middlewares/permission.middleware");
const {
  listObjectives,
  createObjective,
  updateObjective,
  deleteObjective,
  importObjectives,
  importCompanyHistory,
  saveCompanyMonthly,
  companySummary,
  createCompanyObjective,
  updateCompanyObjective,
  deleteCompanyObjective,
} = require("../controllers/kpi.controller");

const router = express.Router();

// The two Data Entry pages (seed/seedMenus.js).
const KPI_URL = "/production/kpi";
const COMPANY_URL = "/production/company-objective";

router.use(protect);
router.use(authorize("SuperAdmin", "Operator"));

router.get("/objectives", requireMenuPermission(KPI_URL, "read"), listObjectives);
router.post("/objectives", requireMenuPermission(KPI_URL, "write"), createObjective);
router.post("/objectives/import", requireMenuPermission(KPI_URL, "write"), importObjectives);
router.put("/objectives/:id", requireMenuPermission(KPI_URL, "write"), updateObjective);
router.delete("/objectives/:id", requireMenuPermission(KPI_URL, "write"), deleteObjective);

router.get("/company", requireMenuPermission(COMPANY_URL, "read"), companySummary);
router.post("/company", requireMenuPermission(COMPANY_URL, "write"), createCompanyObjective);
router.post("/company/import", requireMenuPermission(COMPANY_URL, "write"), importCompanyHistory);
router.put("/company/monthly", requireMenuPermission(COMPANY_URL, "write"), saveCompanyMonthly);
router.put("/company/:id", requireMenuPermission(COMPANY_URL, "write"), updateCompanyObjective);
router.delete("/company/:id", requireMenuPermission(COMPANY_URL, "write"), deleteCompanyObjective);

module.exports = router;
