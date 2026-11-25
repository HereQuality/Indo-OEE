const Company = require("../models/Company");
const mongoose = require("mongoose");
const { deleteLocalFile } = require("../utils/fileUrl");
const { recordAudit, plain } = require("../utils/auditTrail");

// The audit trail's view of the company: the logo / favicon as "set" or blank, not a path.
const COMPANY_FIELDS = { name: "Company name", logo: "Logo", favicon: "Favicon" };
const companyView = (c) => (c ? { name: c.name, logo: c.logo ? "Uploaded" : null, favicon: c.favicon ? "Uploaded" : null } : {});

// Get the single global company configuration
exports.getCompanyDetails = async (req, res) => {
  try {
    let company = await Company.findOne();
    
    // If no company exists yet, return a default empty object
    if (!company) {
      return res.status(200).json({ isOk: true, data: { name: "", logo: "", favicon: "" } });
    }

    res.status(200).json({ isOk: true, data: company });
  } catch (error) {
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update or create the single global company configuration
exports.updateCompany = async (req, res) => {
  try {
    const { name, removeLogo, removeFavicon } = req.body;
    let updateData = { name };

    let company = await Company.findOne();

    // Handle logo
    if (req.files && req.files.logo && req.files.logo[0]) {
      // New file uploaded — delete old, use new local file's public URL
      if (company && company.logo) deleteLocalFile(company.logo);
      updateData.logo = req.files.logo[0].path;
    } else if (removeLogo === 'true') {
      // Remove requested — delete local file and clear field
      if (company && company.logo) deleteLocalFile(company.logo);
      updateData.logo = '';
    }

    // Handle favicon
    if (req.files && req.files.favicon && req.files.favicon[0]) {
      if (company && company.favicon) deleteLocalFile(company.favicon);
      updateData.favicon = req.files.favicon[0].path;
    } else if (removeFavicon === 'true') {
      if (company && company.favicon) deleteLocalFile(company.favicon);
      updateData.favicon = '';
    }

    const before = plain(company);
    if (!company) {
      company = new Company(updateData);
      await company.save();
    } else {
      company = await Company.findByIdAndUpdate(company._id, updateData, { new: true });
    }
    // A re-uploaded logo keeps reading "Uploaded", so say so in the remark.
    const uploaded = [req.files?.logo?.[0] && "logo", req.files?.favicon?.[0] && "favicon"].filter(Boolean);
    await recordAudit({ req, entityType: "company", entity: company?._id, label: company?.name || "Company", action: "update", before: companyView(before), after: companyView(plain(company)), fields: COMPANY_FIELDS, remark: uploaded.length ? `New ${uploaded.join(" and ")} uploaded` : "" });

    res.status(200).json({
      status: 'success',
      isOk: true,
      data: { company },
    });
  } catch (error) {
    console.error('Error updating company settings:', error);
    res.status(400).json({
      status: 'fail',
      isOk: false,
      message: error.message || 'Failed to update company settings',
    });
  }
};

// Ensure other imported routes don't crash if they were expecting getCompanies etc.
exports.getCompanies = async (req, res) => {
    exports.getCompanyDetails(req, res);
};

exports.deleteCompany = async (req, res) => {
    res.status(400).json({ status: "fail", message: "Cannot delete global settings" });
};

exports.authorizeMenus = async (req, res) => {
    res.status(400).json({ status: "fail", message: "Not applicable for single-tenant" });
};

exports.getAdminStats = async (req, res) => {
    res.status(200).json({ status: "success", data: {} });
};
