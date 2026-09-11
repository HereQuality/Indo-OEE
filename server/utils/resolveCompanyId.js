const Company = require("../models/Company");

const INTERNAL_COMPANY_NAME = "SuperAdmin Workspace";
const INTERNAL_COMPANY_EMAIL = "internal-workspace@system.local";

let cachedInternalCompanyId = null;

/**
 * Finds (or lazily creates) the single hidden Company document that
 * SuperAdmin's own directly-managed Operators/Departments/Roles are scoped
 * under. This lets SuperAdmin use the exact same Operator/Department/Role
 * data model and endpoints as a real tenant Company, without ever having to
 * go through Admin > Company Management to create one.
 *
 * This company is flagged isInternal: true so it's filtered out of
 * Admin > Company Management (see company.controller.js#getCompanies).
 */
const getOrCreateInternalCompany = async () => {
  if (cachedInternalCompanyId) return cachedInternalCompanyId;

  let company = await Company.findOne({ isInternal: true });
  if (!company) {
    company = await Company.create({
      name: INTERNAL_COMPANY_NAME,
      email: INTERNAL_COMPANY_EMAIL,
      status: "active",
      isInternal: true,
    });
  }

  cachedInternalCompanyId = company._id;
  return company._id;
};

/**
 * Resolves the companyId a request should be scoped to:
 *  - SuperAdmin  -> the hidden internal workspace company (auto-created)
 *  - CompanyAdmin -> req.user.companyId (their own tenant)
 *  - Operator     -> req.user.companyId (their employer)
 */
const resolveCompanyId = async (req) => {
  if (req.user.roleType === "SuperAdmin") {
    return getOrCreateInternalCompany();
  }
  return req.user.companyId || req.user._id;
};

module.exports = { resolveCompanyId, getOrCreateInternalCompany };