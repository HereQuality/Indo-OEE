"use strict";
/**
 * middlewares/permission.middleware.js
 *
 * Server-side enforcement of Manage Role's read/write permissions.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Before this, every Operator-management API route only checked
 * `authorize("SuperAdmin", "Operator")` — i.e. "are you logged in as
 * SOME role at all". It never checked whether that role's specific
 * permissions (set in Manage Role) actually grant access to the menu
 * this endpoint belongs to. That meant:
 *   - An Operator whose role has NO menus assigned could still call
 *     every Department/Operator/Role/etc. API directly (Postman, curl,
 *     or a modified frontend), even though the sidebar/UI hid it.
 *   - The frontend hiding a button was the ONLY thing stopping a
 *     write, which is not real protection.
 *
 * HOW TO USE
 * ----------
 *   const { requireMenuPermission } = require("../middlewares/permission.middleware");
 *   router.get("/", protect, requireMenuPermission("/employee-management/employee", "read"), listAllEmployees);
 *   router.post("/", protect, requireMenuPermission("/employee-management/employee", "write"), createEmployee);
 *
 * `menuUrl` is the page path WITHOUT the leading role slug, e.g.
 * "/employee-management/employee" — same convention the frontend uses
 * (see client/src/utils/roleUrl.js). MenuMaster actually stores the
 * full path including whatever slug it was created under (typically
 * "/hqepl/employee-management/employee"), so this middleware matches
 * by suffix, exactly like MenuContext.findMenuIdByUrl does on the
 * client. Don't pass a leading role slug here.
 *
 * PERMISSION MODEL (2 flags only, on purpose — see OperatorRoles.js)
 *   read  -> can view/list/GET this page's data.
 *   write -> full access: create, update, delete, print, email —
 *            same as the page owner. There is no separate delete/edit/
 *            print/mail flag anymore. Use "write" for every mutating
 *            route (POST/PUT/PATCH/DELETE).
 *
 * SuperAdmin always passes (full platform access by definition).
 */

const MenuMaster = require("../models/MenuMaster");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const OperatorRoles = require("../models/OperatorRoles");
const AppError = require("../utils/AppError");

/**
 * @param {string} menuUrl - the menu's menuUrl exactly as stored in MenuMaster (no role slug prefix).
 * @param {"read"|"write"} level - minimum permission required.
 */
const requireMenuPermission = (menuUrls, level = "read") => {
  if (!["read", "write"].includes(level)) {
    throw new Error(`requireMenuPermission: invalid level "${level}"`);
  }
  
  const urls = Array.isArray(menuUrls) ? menuUrls : [menuUrls];

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AppError("You are not logged in. Please log in to get access.", 401));
      }

      // SuperAdmin: full access everywhere, no per-menu check needed.
      if (req.user.roleType === "SuperAdmin") {
        return next();
      }

      if (!req.user.roleId) {
        return next(new AppError("Your account has no role assigned. Contact your administrator.", 403));
      }

      const escapedUrls = urls.map(u => u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const regexes = escapedUrls.map(u => new RegExp(`${u}/?$`));

      const menus = await MenuMaster.find({
        menuUrl: { $in: regexes },
        isActive: true,
      }).select("_id");

      const menuGroups = await MenuGroupMaster.find({
        menuUrl: { $in: regexes },
        isLink: true,
        isActive: true,
      }).select("_id");

      if ((!menus || menus.length === 0) && (!menuGroups || menuGroups.length === 0)) {
        return next(new AppError("This page is not available.", 403));
      }

      const employeeRoles = await OperatorRoles.findOne({
        roleId: req.user.roleId,
        isActive: true,
      }).select("roles");

      if (!employeeRoles) {
        return next(new AppError("Your role has no permissions configured. Contact your administrator.", 403));
      }

      const menuIds = menus.map(m => String(m._id));
      const menuGroupIds = menuGroups.map(mg => String(mg._id));
      
      const hasAccess = employeeRoles.roles.some((r) => {
        const matchesMenu = r.menuId && menuIds.includes(String(r.menuId));
        const matchesGroup = r.menuGroupId && menuGroupIds.includes(String(r.menuGroupId));
        
        if (matchesMenu || matchesGroup) {
          const hasRead = !!r.view;
          const hasWrite = !!r.create || !!r.edit || !!r.delete;
          return level === "read" ? hasRead || hasWrite : hasWrite;
        }
        return false;
      });

      if (!hasAccess) {
        return next(
          new AppError(
            `You do not have "${level}" permission for this page.`,
            403
          )
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { requireMenuPermission };
