const Department = require("../models/Department");

// Create Department
exports.createDepartment = async (req, res) => {
  try {
    const { departmentName, departmentCode, isActive, remark } = req.body;

    const newDepartment = await Department.create({
      departmentName,
      departmentCode,
      isActive,
      remark,
    });

    res.status(201).json({
      isOk: true,
      data: newDepartment,
      message: "Department created successfully",
    });
  } catch (error) {
    console.error("Error creating department:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Department
exports.updateDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    const department = await Department.findOneAndUpdate(
      { _id: departmentId },
      req.body,
      { new: true }
    );

    if (!department) {
      return res.status(404).json({ isOk: false, message: "Department not found" });
    }

    res.status(200).json({
      isOk: true,
      data: department,
      message: "Department updated successfully",
    });
  } catch (error) {
    console.error("Error updating department:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.deleteDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;

    const department = await Department.findById(departmentId);
    if (!department) {
      return res.status(404).json({ isOk: false, message: "Department not found" });
    }

    if (department.isActive) {
      // Soft Delete
      department.isActive = false;
      await department.save();
      return res.status(200).json({
        isOk: true,
        message: "Department deactivated successfully",
      });
    } else {
      // Hard Delete
      await Department.findByIdAndDelete(departmentId);
      return res.status(200).json({
        isOk: true,
        message: "Department deleted successfully",
      });
    }
  } catch (error) {
    console.error("Error deleting department:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Department By Id
exports.getDeparmentById = async (req, res) => {
  try {
    const { departmentId } = req.params;

    const department = await Department.findOne({ _id: departmentId });

    if (!department) {
      return res.status(404).json({ isOk: false, message: "Department not found" });
    }

    res.status(200).json({
      isOk: true,
      data: department,
    });
  } catch (error) {
    console.error("Error fetching department:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Departments (no pagination)
exports.listDepartments = async (req, res) => {
  try {
    const departments = await Department.find({});

    res.status(200).json({
      isOk: true,
      data: departments,
    });
  } catch (error) {
    console.error("Error listing departments:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Search / List Departments By Params (Pagination)
exports.listDepartmentByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

    let query = {};
    if (match) {
      const baseOr = [
        { departmentName: { $regex: match, $options: "i" } },
        { departmentCode: { $regex: match, $options: "i" } },
      ];

      query.$or = baseOr;
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) {
      sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };
    }

    const [totalCount, departments] = await Promise.all([
      Department.countDocuments(query),
      Department.find(query)
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
          data: departments,
        },
      ],
    });
  } catch (error) {
    console.error("Error searching departments:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

