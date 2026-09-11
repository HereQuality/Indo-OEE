const OperatorRoles = require("../models/OperatorRoles");

// Create Operator Role Permissions
exports.createOperatorRoles = async (req, res) => {
  try {
    const { roleId, roles, isActive } = req.body;

    // Check if role permissions already exist
    const existingRoles = await OperatorRoles.findOne({ roleId });
    if (existingRoles) {
      return res.status(400).json({ isOk: false, message: "Permissions already exist for this role. Use update instead." });
    }

    const operatorRoles = await OperatorRoles.create({
      roleId,
      roles,
      isActive
    });

    res.status(201).json({
      isOk: true,
      data: operatorRoles,
      message: "Operator roles created successfully"
    });
  } catch (error) {
    console.error("Error creating operator roles:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Operator Role Permissions by Role ID
exports.getOperatorRoles = async (req, res) => {
  try {
    const { roleId } = req.params;

    const operatorRoles = await OperatorRoles.find({ roleId });

    if (!operatorRoles || operatorRoles.length === 0) {
      return res.status(200).json({ isOk: true, data: [] });
    }

    res.status(200).json({
      isOk: true,
      data: operatorRoles
    });
  } catch (error) {
    console.error("Error fetching operator roles:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Operator Role Permissions
exports.updateOperatorRoles = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { roles, isActive } = req.body;

    const operatorRoles = await OperatorRoles.findOneAndUpdate(
      { roleId },
      { roles, isActive },
      { new: true }
    );

    if (!operatorRoles) {
      return res.status(404).json({ isOk: false, message: "Operator roles not found" });
    }

    res.status(200).json({
      isOk: true,
      data: operatorRoles,
      message: "Operator roles updated successfully"
    });
  } catch (error) {
    console.error("Error updating operator roles:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
