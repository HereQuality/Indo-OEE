const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const { slugify, RESERVED_SLUGS } = require("../utils/slugify");

// Create Role
exports.createRole = async (req, res) => {
  try {
    const { roleName, roleCode, isActive, remark } = req.body;

    const roleSlug = slugify(roleCode);

    if (!roleSlug) {
      return res.status(400).json({
        isOk: false,
        message: "Role code must contain at least one letter or number.",
      });
    }

    if (RESERVED_SLUGS.has(roleSlug)) {
      return res.status(400).json({
        isOk: false,
        message: `"${roleCode}" is a reserved word and can't be used as a role code. Please choose a different one.`,
      });
    }

    const existing = await RoleMaster.findOne({ roleSlug });
    if (existing) {
      return res.status(409).json({
        isOk: false,
        message: `A role with code "${roleCode}" already exists (URL /${roleSlug} is taken). Please choose a different code.`,
      });
    }

    const newRole = await RoleMaster.create({
      roleName,
      roleCode,
      isActive,
      remark,
    });

    res.status(201).json({
      isOk: true,
      data: newRole,
      message: "Role created successfully",
    });
  } catch (error) {
    console.error("Error creating role:", error);
    if (error.code === 11000) {
      return res.status(409).json({ isOk: false, message: "That role code is already taken. Please choose a different one." });
    }
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Role
exports.updateRole = async (req, res) => {
  try {
    const { roleId } = req.params;

    if (req.body.roleCode !== undefined) {
      const roleSlug = slugify(req.body.roleCode);

      if (!roleSlug) {
        return res.status(400).json({
          isOk: false,
          message: "Role code must contain at least one letter or number.",
        });
      }

      if (RESERVED_SLUGS.has(roleSlug)) {
        return res.status(400).json({
          isOk: false,
          message: `"${req.body.roleCode}" is a reserved word and can't be used as a role code. Please choose a different one.`,
        });
      }

      const existing = await RoleMaster.findOne({ roleSlug, _id: { $ne: roleId } });
      if (existing) {
        return res.status(409).json({
          isOk: false,
          message: `A role with code "${req.body.roleCode}" already exists (URL /${roleSlug} is taken). Please choose a different code.`,
        });
      }
      req.body.roleSlug = roleSlug;
    }

    const role = await RoleMaster.findOneAndUpdate(
      { _id: roleId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!role) {
      return res.status(404).json({ isOk: false, message: "Role not found" });
    }

    res.status(200).json({
      isOk: true,
      data: role,
      message: "Role updated successfully",
    });
  } catch (error) {
    console.error("Error updating role:", error);
    if (error.code === 11000) {
      return res.status(409).json({ isOk: false, message: "That role code is already taken. Please choose a different one." });
    }
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const { roleId } = req.params;

    const role = await RoleMaster.findById(roleId);
    if (!role) {
      return res.status(404).json({ isOk: false, message: "Role not found" });
    }

    if (role.isActive) {
      // Soft Delete
      role.isActive = false;
      await role.save();
      return res.status(200).json({
        isOk: true,
        message: "Role deactivated successfully",
      });
    } else {
      // Hard Delete
      await RoleMaster.findByIdAndDelete(roleId);
      // Also delete associated permissions
      await OperatorRoles.findOneAndDelete({ roleId });
      return res.status(200).json({
        isOk: true,
        message: "Role deleted successfully",
      });
    }
  } catch (error) {
    console.error("Error deleting role:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Role By Id
exports.getRoleById = async (req, res) => {
  try {
    const { roleId } = req.params;

    const role = await RoleMaster.findOne({ _id: roleId }).lean();

    if (!role) {
      return res.status(404).json({ isOk: false, message: "Role not found" });
    }

    res.status(200).json({
      isOk: true,
      data: role,
    });
  } catch (error) {
    console.error("Error fetching role:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Roles (no pagination)
exports.listAllRoles = async (req, res) => {
  try {
    const roles = await RoleMaster.find({}).lean();

    res.status(200).json({
      isOk: true,
      data: roles,
    });
  } catch (error) {
    console.error("Error listing roles:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Search / List Roles By Params (Pagination)
exports.listRoleByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    let query = {};
    if (match) {
      query.$or = [
        { roleName: { $regex: match, $options: "i" } },
        { roleCode: { $regex: match, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) {
      sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };
    }

    const [totalCount, roles] = await Promise.all([
      RoleMaster.countDocuments(query),
      RoleMaster.find(query)
        .sort(sortQuery)
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({
      isOk: true,
      data: [
        {
          count: totalCount,
          data: roles,
        },
      ],
    });
  } catch (error) {
    console.error("Error searching roles:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
