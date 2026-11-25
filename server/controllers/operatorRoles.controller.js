const OperatorRoles = require("../models/OperatorRoles");
const { isAdminUser } = require("../utils/adminAccess");
const { sendError } = require("../utils/httpErrors");
const MenuMaster = require("../models/MenuMaster");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const RoleMaster = require("../models/RoleMaster");
const mongoose = require("mongoose");
const { recordAudit, nameMap, plain } = require("../utils/auditTrail");

// The audit trail's view of a role's permissions: one line per menu (by name)
// reading "view, add, edit, delete" — whichever are ticked — plus Full access
// and Active, so a change shows as "<menu>: view → view, add, edit".
const flagsText = (r) => ["view", "create", "edit", "delete"].filter((f) => r[f]).map((f) => (f === "create" ? "add" : f)).join(", ") || "none";
const permissionsView = async (doc) => {
  if (!doc) return {};
  const d = plain(doc);
  const rows = d.roles || [];
  const [menus, groups] = await Promise.all([nameMap(MenuMaster, rows.map((r) => r.menuId), "menuName"), nameMap(MenuGroupMaster, rows.map((r) => r.menuGroupId), "menuGroupName")]);
  const view = { fullAccess: d.fullAccess === true, isActive: d.isActive !== false };
  for (const r of rows) {
    const name = r.menuId ? menus[String(r.menuId)] || `Menu ${r.menuId}` : r.menuGroupId ? groups[String(r.menuGroupId)] || `Group ${r.menuGroupId}` : null;
    if (name) view[`menu.${name}`] = flagsText(r);
  }
  return view;
};
const auditPermissions = async (req, before, after) => {
  try {
    const [b, a] = await Promise.all([permissionsView(before), permissionsView(after)]);
    const roleId = (after || before)?.roleId;
    const role = roleId ? (await nameMap(RoleMaster, [roleId], "roleName"))[String(roleId?._id || roleId)] : "";
    const fields = { fullAccess: "Full access", isActive: "Active" };
    for (const k of [...new Set([...Object.keys(b), ...Object.keys(a)])]) if (k.startsWith("menu.")) fields[k] = k.slice(5);
    // A menu a role never had reads "none" on the old side, not blank.
    for (const k of Object.keys(fields)) if (k.startsWith("menu.")) { if (!(k in b) && Object.keys(b).length) b[k] = "none"; if (!(k in a)) a[k] = "none"; }
    await recordAudit({ req, entityType: "permissions", entity: (after || before)?._id, label: role || "Role", action: "update", before: b, after: a, fields });
  } catch (error) {
    console.error("Error logging Manage Role change:", error);
  }
};

// Every menuId in the permission rows has to be a real menu (400 otherwise); an empty or
// absent menuId, or one the schema itself rejects as malformed, behaves as it always did.
const checkMenusExist = async (roles) => {
  if (!Array.isArray(roles)) return;
  const ids = [...new Set(roles.map((r) => r?.menuId).filter((id) => id && mongoose.isValidObjectId(id)).map(String))];
  if (!ids.length) return;
  if ((await MenuMaster.countDocuments({ _id: { $in: ids } })) < ids.length) {
    throw Object.assign(new Error("Menu not found"), { status: 400 });
  }
};

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
    await checkMenusExist(roles);
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

    await auditPermissions(req, null, operatorRoles);
    res.status(201).json({
      isOk: true,
      data: operatorRoles,
      message: "Operator roles created successfully"
    });
  } catch (error) {
    console.error("Error creating operator roles:", error);
    sendError(res, error);
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
    sendError(res, error);
  }
};

// Update Operator Role Permissions
exports.updateOperatorRoles = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { roles, isActive } = req.body;
    await checkMenusExist(roles);

    const current = await OperatorRoles.findOne({ roleId }).select("roleId roles isActive fullAccess").lean();
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
    await auditPermissions(req, current, operatorRoles);

    res.status(200).json({
      isOk: true,
      data: operatorRoles,
      message: "Operator roles updated successfully"
    });
  } catch (error) {
    console.error("Error updating operator roles:", error);
    sendError(res, error);
  }
};
