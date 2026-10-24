const RoleMaster = require("../models/RoleMaster");
const OperatorRoles = require("../models/OperatorRoles");
const Operator = require("../models/Operator");
const User = require("../models/user.model");

/**
 * utils/adminAccess.js
 * ──────────────────────
 * "Full access" — who may review entries whose OEE figures go over 100%,
 * unlock a locked entry for 24 hours and change a process's Operator Planned
 * Shift. Super Admin (a User with roleType SuperAdmin), or an Operator whose
 * role has "Full access" ticked in Manage Role. A role whose box was never
 * saved either way still counts when its code is "admin" (case-insensitive),
 * so accounts set up before the checkbox existed keep working; ticking or
 * unticking the box settles it from then on.
 */
const ADMIN_ROLE_CODE = "admin";

const isAdminCode = (role) => String(role?.roleCode || "").trim().toLowerCase() === ADMIN_ROLE_CODE;
// The box wins once it has been saved; before that, the legacy "admin" code.
const hasFullAccess = (role, perms) =>
  !!role && role.isActive !== false && (typeof perms?.fullAccess === "boolean" ? perms.fullAccess : isAdminCode(role));

// { isAdmin, role } for req.user, worked out once per request.
const accessOf = async (req) => {
  if (req._access) return req._access;
  const user = req.user;
  let access = { isAdmin: false, role: "" };
  if (user?.roleType === "SuperAdmin") access = { isAdmin: true, role: "Super Admin" };
  else if (user?.roleId) {
    const [role, perms] = await Promise.all([
      RoleMaster.findById(user.roleId).select("roleName roleCode isActive").lean(),
      OperatorRoles.findOne({ roleId: user.roleId }).select("fullAccess").lean(),
    ]);
    access = { isAdmin: hasFullAccess(role, perms), role: role?.roleName || "" };
  }
  req._access = access;
  return access;
};

const isAdminUser = async (req) => (await accessOf(req)).isAdmin;

// Route guard: 403 for anyone but Admin / Super Admin.
const requireAdmin = async (req, res, next) => {
  try {
    if (await isAdminUser(req)) return next();
    return res.status(403).json({ isOk: false, message: "Only a Full Access user or Super Admin can do this" });
  } catch (error) {
    return res.status(500).json({ isOk: false, message: error.message });
  }
};

// Who's acting, for audit logs.
const actorOf = async (req) => {
  const user = req.user || {};
  const { role } = await accessOf(req);
  return {
    id: user._id,
    model: user.constructor?.modelName === "User" ? "User" : "Operator",
    name: user.employeeName || user.name || user.username || "",
    role,
  };
};

// Every Super Admin and Full access account — the people a review notification goes to.
const adminRecipients = async () => {
  const [supers, roles, perms] = await Promise.all([
    User.find({ roleType: "SuperAdmin" }).select("_id").lean(),
    RoleMaster.find({ isActive: { $ne: false } }).select("_id roleCode isActive").lean(),
    OperatorRoles.find({}).select("roleId fullAccess").lean(),
  ]);
  const permsOf = Object.fromEntries(perms.map((p) => [String(p.roleId), p]));
  const adminRoleIds = roles.filter((r) => hasFullAccess(r, permsOf[String(r._id)])).map((r) => r._id);
  const admins = adminRoleIds.length ? await Operator.find({ roleId: { $in: adminRoleIds }, isActive: { $ne: false } }).select("_id").lean() : [];
  return [...supers.map((u) => ({ model: "User", id: String(u._id) })), ...admins.map((o) => ({ model: "Operator", id: String(o._id) }))];
};

module.exports = { accessOf, isAdminUser, requireAdmin, actorOf, adminRecipients };
