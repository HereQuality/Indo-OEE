"use strict";
// Safe, idempotent menu/sidebar structure seeder. Every write is an
// upsert-by-natural-key (menuGroupName+portal for groups, menuUrl for
// menus) — it NEVER deletes/recreates MenuGroupMaster or MenuMaster rows,
// unlike seed.js's one-shot fresh-install seeder. That matters because
// OperatorRoles (server/models/OperatorRoles.js) stores role permissions
// keyed by the exact menuId/menuGroupId ObjectId — wiping and recreating
// these collections would silently orphan every existing role's
// permissions. Re-running this script is always safe: existing groups/
// menus keep their _id and just get their sequence/menuGroup/icon fields
// updated in place; only genuinely new rows get created.
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

// ── Sidebar order (top to bottom) ────────────────────────────────────────
//   1. Home                      (link)
//   2. Administration             (group: Menu Group, Menu Master, Company)
//   3. Operator Management        (group)
//   4. Production                 (group: Data Entry, Machines, Items)
//   5. Support                    (link)
const HOME_GROUP = { menuGroupName: "Home", sequence: 1, isLink: true, menuUrl: "/hqepl/home", portal: "Both", icon: "Home" };
const ADMINISTRATION_GROUP = { menuGroupName: "Administration", sequence: 2, isLink: false, portal: "SuperAdmin", icon: "Settings" };
const PRODUCTION_GROUP = { menuGroupName: "Production", sequence: 4, isLink: false, portal: "Both", icon: "Factory" };
const EMPLOYEE_MANAGEMENT_GROUP = { menuGroupName: "Operator Management", sequence: 3, isLink: false, portal: "Both", icon: "Users" };
const SUPPORT_GROUP = { menuGroupName: "Support", sequence: 5, isLink: true, menuUrl: "/hqepl/support", portal: "Both", icon: "Headphones" };

const ADMINISTRATION_MENUS = [
  { menuName: "Menu Group", menuUrl: "/x/menu-groups", sequence: 1, icon: "FolderTree" },
  { menuName: "Menu Master", menuUrl: "/x/menus", sequence: 2, icon: "List" },
  { menuName: "Company", menuUrl: "/x/company", sequence: 3, icon: "Building2" },
];

const PRODUCTION_MENUS = [
  { menuName: "Data Entry", menuUrl: "/hqepl/production/data-entry", sequence: 1, icon: "ClipboardList" },
  { menuName: "Machines", menuUrl: "/hqepl/production/machines", sequence: 2, icon: "Wrench" },
  { menuName: "Items", menuUrl: "/hqepl/production/items", sequence: 3, icon: "Package" },
];

const EMPLOYEE_MANAGEMENT_MENUS = [
  { menuName: "Department", menuUrl: "/hqepl/employee-management/department", sequence: 1, icon: "Building" },
  { menuName: "Teams", menuUrl: "/hqepl/teams", sequence: 2, icon: "UsersRound" },
  { menuName: "Role", menuUrl: "/hqepl/employee-management/role", sequence: 3, icon: "ShieldCheck" },
  { menuName: "Operator", menuUrl: "/hqepl/employee-management/employee", sequence: 5, icon: "User" },
  { menuName: "Manage Role", menuUrl: "/hqepl/employee-management/manage-role", sequence: 6, icon: "UserCog" },
];

async function upsertGroup(def) {
  return MenuGroupMaster.findOneAndUpdate(
    { menuGroupName: def.menuGroupName, portal: def.portal },
    { ...def, isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function upsertMenus(menus, group) {
  for (const menu of menus) {
    await MenuMaster.findOneAndUpdate(
      { menuUrl: menu.menuUrl },
      {
        menuName: menu.menuName,
        menuGroup: group._id,
        menuUrl: menu.menuUrl,
        sequence: menu.sequence,
        icon: menu.icon,
        isActive: true,
        isParent: false,
        parentMenu: null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

async function run() {
  await connectDB();

  await upsertGroup(HOME_GROUP);

  const adminGroup = await upsertGroup(ADMINISTRATION_GROUP);
  await upsertMenus(ADMINISTRATION_MENUS, adminGroup);

  const productionGroup = await upsertGroup(PRODUCTION_GROUP);
  await upsertMenus(PRODUCTION_MENUS, productionGroup);

  const empMgmtGroup = await upsertGroup(EMPLOYEE_MANAGEMENT_GROUP);
  await upsertMenus(EMPLOYEE_MANAGEMENT_MENUS, empMgmtGroup);

  await upsertGroup(SUPPORT_GROUP);

  console.log("Menus seeded (safe upsert, existing IDs preserved).");
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
