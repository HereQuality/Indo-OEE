const OperatorRoles = require("../models/OperatorRoles");
const { isAdminUser } = require("../utils/adminAccess");

// Granting or taking away Full access is itself a Full access power — the
// Manage Role write permission alone must not be a way to promote yourself.
// An absent flag means "leave it as it is".
const fullAccessChange = async (req, current) => {
  if (typeof req.body.fullAccess !== "boolean") return { value: undefined };
  if (req.body.fullAccess === (current?.fullAccess === true)) return { value: req.body.fullAccess };
  if (!(await isAdminUser(req))) return { denied: true };
  return { value: req.body.fullAccess };
};
const DENIED = { isOk: false, message: "Only a Full Access user or Super Admin can change Full access" };

// Create Operator Role Permissions
exports.createOperatorRoles = async (req, res) => {
  try {
    const { roleId, roles, isActive } = req.body;
    const fullAccess = await fullAccessChange(req, null);
    if (fullAccess.denied) return res.status(403).json(DENIED);

    // Check if role permissions already exist
    const existingRoles = await OperatorRoles.findOne({ roleId });
    if (existingRoles) {
      return res.status(400).json({ isOk: false, message: "Permissions already exist for this role. Use update instead." });
    }

    const operatorRoles = await OperatorRoles.create({
      roleId,
      roles,
      isActive,
      ...(fullAccess.value === undefined ? {} : { fullAccess: fullAccess.value }),
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

    const current = await OperatorRoles.findOne({ roleId }).select("fullAccess").lean();
    const fullAccess = await fullAccessChange(req, current);
    if (fullAccess.denied) return res.status(403).json(DENIED);

    const operatorRoles = await OperatorRoles.findOneAndUpdate(
      { roleId },
      { roles, isActive, ...(fullAccess.value === undefined ? {} : { fullAccess: fullAccess.value }) },
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
