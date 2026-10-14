const RoleMaster = require("../models/RoleMaster");
const Operator = require("../models/Operator");
const User = require("../models/user.model");

/**
 * utils/adminAccess.js
 * ──────────────────────
 * "Admin or Super Admin" — who may review entries whose OEE figures go over
 * 100% and change a process's Operator Planned Shift. Super Admin (a User
 * with roleType SuperAdmin), or an Operator whose role's code is "admin"
 * (case-insensitive) — every other role is refused, including any created
 * later, unless its code is "admin".
 */
const ADMIN_ROLE_CODE = "admin";

// { isAdmin, role } for req.user, worked out once per request.
const accessOf = async (req) => {
  if (req._access) return req._access;
  const user = req.user;
  let access = { isAdmin: false, role: "" };
  if (user?.roleType === "SuperAdmin") access = { isAdmin: true, role: "Super Admin" };
  else if (user?.roleId) {
    const role = await RoleMaster.findById(user.roleId).select("roleName roleCode isActive").lean();
    access = {
      isAdmin: !!role && role.isActive !== false && String(role.roleCode || "").trim().toLowerCase() === ADMIN_ROLE_CODE,
      role: role?.roleName || "",
    };
  }
  req._access = access;
  return access;
};

const isAdminUser = async (req) => (await accessOf(req)).isAdmin;

// Route guard: 403 for anyone but Admin / Super Admin.
const requireAdmin = async (req, res, next) => {
  try {
    if (await isAdminUser(req)) return next();
    return res.status(403).json({ isOk: false, message: "Only Admin or Super Admin can do this" });
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

// Every Admin / Super Admin account — the people a review notification goes to.
const adminRecipients = async () => {
  const [supers, roles] = await Promise.all([
    User.find({ roleType: "SuperAdmin" }).select("_id").lean(),
    RoleMaster.find({ isActive: { $ne: false } }).select("_id roleCode").lean(),
  ]);
  const adminRoleIds = roles.filter((r) => String(r.roleCode || "").trim().toLowerCase() === ADMIN_ROLE_CODE).map((r) => r._id);
  const admins = adminRoleIds.length ? await Operator.find({ roleId: { $in: adminRoleIds }, isActive: { $ne: false } }).select("_id").lean() : [];
  return [...supers.map((u) => ({ model: "User", id: String(u._id) })), ...admins.map((o) => ({ model: "Operator", id: String(o._id) }))];
};

module.exports = { accessOf, isAdminUser, requireAdmin, actorOf, adminRecipients };
