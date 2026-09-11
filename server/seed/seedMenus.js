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
//   3. Dashboard                  (link — the OEE analytics dashboard)
//   4. Operator Management        (group)
//   5. Management                 (group: Process/Machine masters)
//   6. Support                    (link)
const HOME_GROUP = { menuGroupName: "Home", sequence: 1, isLink: true, menuUrl: "/hqepl/home", portal: "Both", icon: "Home" };
const ADMINISTRATION_GROUP = { menuGroupName: "Administration", sequence: 2, isLink: false, portal: "SuperAdmin", icon: "Settings" };
const DASHBOARD_GROUP = { menuGroupName: "Dashboard", sequence: 3, isLink: true, menuUrl: "/hqepl/dashboard", portal: "Both", icon: "LayoutDashboard" };
const EMPLOYEE_MANAGEMENT_GROUP = { menuGroupName: "Operator Management", sequence: 4, isLink: false, portal: "Both", icon: "Users" };
const MANAGEMENT_GROUP = { menuGroupName: "Management", sequence: 5, isLink: false, portal: "Both", icon: "Factory" };
const SUPPORT_GROUP = { menuGroupName: "Support", sequence: 6, isLink: true, menuUrl: "/hqepl/support", portal: "Both", icon: "Headphones" };

// Retired groups — deactivated (not deleted) so any pre-existing
// group-level permission row pointing at their _id doesn't dangle on a
// missing document; they just stop rendering (getMenuByGroups filters
// isActive: true).
//   - "Production": its menus were moved to Setup/Data Entry when those
//     existed. Grinding Data Entry, Standard Time and Machine Operators
//     have since been rebuilt under the Management group at new
//     /hqepl/management/* URLs, so these old /hqepl/production/* rows stay
//     retired rather than being revived (a MenuMaster row is keyed by
//     menuUrl, and reusing the old URL would resurrect its stale group).
const RETIRED_GROUP_NAMES = ["Production", "hqepl-dashboard", "Setup", "Data Entry"];

const ADMINISTRATION_MENUS = [
  { menuName: "Menu Group", menuUrl: "/x/menu-groups", sequence: 1, icon: "FolderTree" },
  { menuName: "Menu Master", menuUrl: "/x/menus", sequence: 2, icon: "List" },
  { menuName: "Company", menuUrl: "/x/company", sequence: 3, icon: "Building2" },
  // SuperAdmin-only: renaming/hiding a field changes Grinding Data Entry for
  // everyone, so this lives here rather than under Management.
  { menuName: "Form Builder", menuUrl: "/x/form-builder", sequence: 4, icon: "LayoutList" },
];

const EMPLOYEE_MANAGEMENT_MENUS = [
  { menuName: "Company Holidays", menuUrl: "/hqepl/employee-management/company-holidays", sequence: 0, icon: "CalendarOff" },
  { menuName: "Department", menuUrl: "/hqepl/employee-management/department", sequence: 1, icon: "Building" },
  { menuName: "Teams", menuUrl: "/hqepl/teams", sequence: 2, icon: "UsersRound" },
  { menuName: "Role", menuUrl: "/hqepl/employee-management/role", sequence: 3, icon: "ShieldCheck" },
  { menuName: "Operator", menuUrl: "/hqepl/employee-management/employee", sequence: 5, icon: "User" },
  { menuName: "Manage Role", menuUrl: "/hqepl/employee-management/manage-role", sequence: 6, icon: "UserCog" },
];

const MANAGEMENT_MENUS = [
  { menuName: "List of Shifts", menuUrl: "/hqepl/management/shifts", sequence: 1, icon: "Clock" },
  { menuName: "List of Process", menuUrl: "/hqepl/management/processes", sequence: 2, icon: "Workflow" },
  { menuName: "List of Machines", menuUrl: "/hqepl/management/machines", sequence: 3, icon: "Wrench" },
  { menuName: "List of Items", menuUrl: "/hqepl/management/items", sequence: 4, icon: "Package" },
  { menuName: "Machine Operators", menuUrl: "/hqepl/management/machine-operators", sequence: 5, icon: "HardHat" },
  { menuName: "Standard Time", menuUrl: "/hqepl/management/standard-time", sequence: 6, icon: "Timer" },
  { menuName: "Grinding Data Entry", menuUrl: "/hqepl/management/data-entry", sequence: 7, icon: "ClipboardList" },
];

// Menu items whose page has been removed outright — deactivated below
// alongside any retired parent group, so no orphaned active MenuMaster row
// is left behind.
const RETIRED_MENU_URLS = [
  "/hqepl/production/processes",   // Process Master (Setup)
  "/hqepl/production/machines",    // Machine Master (Setup)
  "/hqepl/production/operators",   // Operator Master (Setup)
  "/hqepl/production/standard-time", // Standard Time Master (Setup)
  "/hqepl/production/shift-master", // Shift Master (Setup)
  "/hqepl/production/data-entry",  // Grinding Data Entry (Data Entry)
  "/hqepl/skills",                 // Skills (Operator Management)
  "/hqepl/employee-management/holidays", // Holidays (Operator Management) — replaced by Company Holidays
  "/x/company-holidays",            // Company Holidays (Administration) — moved to Operator Management instead
  "/hqepl/management/form-builder", // Form Builder — moved to Administration (/x/form-builder) as SuperAdmin-only
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

  await upsertGroup(DASHBOARD_GROUP);

  const empMgmtGroup = await upsertGroup(EMPLOYEE_MANAGEMENT_GROUP);
  await upsertMenus(EMPLOYEE_MANAGEMENT_MENUS, empMgmtGroup);

  const managementGroup = await upsertGroup(MANAGEMENT_GROUP);
  await upsertMenus(MANAGEMENT_MENUS, managementGroup);

  await upsertGroup(SUPPORT_GROUP);

  // Retire groups that no longer have a page behind them.
  await MenuGroupMaster.updateMany(
    { menuGroupName: { $in: RETIRED_GROUP_NAMES } },
    { isActive: false }
  );
  await MenuMaster.updateMany(
    { menuUrl: { $in: RETIRED_MENU_URLS } },
    { isActive: false }
  );

  console.log("Menus seeded (safe upsert, existing IDs preserved).");
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
