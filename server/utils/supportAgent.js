const MenuMaster = require("../models/MenuMaster");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const OperatorRoles = require("../models/OperatorRoles");
const Operator = require("../models/Operator");

const SUPPORT_MENU_URL = "/support";

/**
 * utils/supportAgent.js
 * ────────────────────────
 * "Support agent" isn't a separate flag anywhere — it's simply: does this
 * Operator's role have WRITE ("edit") permission on the Support menu
 * (Manage Role)? That's the exact same check requireMenuPermission does
 * for the route itself, so the person who can act on tickets and the
 * person the queue is routed to can never drift apart.
 */
const getSupportAgentRoleIds = async () => {
  const regex = new RegExp(`${SUPPORT_MENU_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`);

  const [menus, menuGroups] = await Promise.all([
    MenuMaster.find({ menuUrl: regex, isActive: true }).select("_id"),
    MenuGroupMaster.find({ menuUrl: regex, isLink: true, isActive: true }).select("_id"),
  ]);

  const menuIds = menus.map((m) => String(m._id));
  const menuGroupIds = menuGroups.map((mg) => String(mg._id));
  if (menuIds.length === 0 && menuGroupIds.length === 0) return [];

  const allRoles = await OperatorRoles.find({ isActive: true }).select("roleId roles");

  const agentRoleIds = allRoles
    .filter((er) =>
      (er.roles || []).some((r) => {
        const matches =
          (r.menuId && menuIds.includes(String(r.menuId))) ||
          (r.menuGroupId && menuGroupIds.includes(String(r.menuGroupId)));
        if (!matches) return false;
        return !!r.edit;
      })
    )
    .map((er) => String(er.roleId));

  return agentRoleIds;
};

/** True if this specific Operator's role grants write access to Support. */
const isSupportAgent = async (employee) => {
  if (!employee || !employee.roleId) return false;
  const agentRoleIds = await getSupportAgentRoleIds();
  const roleId = employee.roleId._id ? String(employee.roleId._id) : String(employee.roleId);
  return agentRoleIds.includes(roleId);
};

/** Every currently-active Operator who qualifies as a support agent. */
const getSupportAgentEmployees = async () => {
  const agentRoleIds = await getSupportAgentRoleIds();
  if (agentRoleIds.length === 0) return [];
  return Operator.find({ roleId: { $in: agentRoleIds }, isActive: true }).select("_id employeeName");
};

module.exports = { isSupportAgent, getSupportAgentEmployees, SUPPORT_MENU_URL };
