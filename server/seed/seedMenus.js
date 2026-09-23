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
const OperatorRoles = require("../models/OperatorRoles");
const User = require("../models/user.model");
const Operator = require("../models/Operator");

// ── Sidebar order (top to bottom) ────────────────────────────────────────
//   1. Home                      (link)
//   2. Dashboard                  (link — the process dashboards)
//   3. Administration             (group: Menu Group, Menu Master, Company)
//   4. Operator Management        (group)
//   5. Production                 (group: Part Master, Machines, Processes, Operators)
//   6. CNC Data Entry             (link — its own top-level item)
//   7. Support                    (link)
const HOME_GROUP = { menuGroupName: "Home", sequence: 1, isLink: true, menuUrl: "/hqepl/home", portal: "Both", icon: "Home" };
// Dashboard sits right under Home as its own top-level link. It used to be
// the last item inside Production — see promoteMenuToLinkGroup below for how
// an existing database is moved across. The URL is unchanged on purpose: the
// React route ("/production/dashboard") and the API's permission checks
// (routes/process.routes.js) both keep working as they are. portal must be
// "Both" — anything else hides it from SuperAdmin or from every operator.
const DASHBOARD_GROUP = { menuGroupName: "Dashboard", sequence: 2, isLink: true, menuUrl: "/hqepl/production/dashboard", portal: "Both", icon: "LayoutDashboard" };
const ADMINISTRATION_GROUP = { menuGroupName: "Administration", sequence: 3, isLink: false, portal: "SuperAdmin", icon: "Settings" };
const EMPLOYEE_MANAGEMENT_GROUP = { menuGroupName: "Operator Management", sequence: 4, isLink: false, portal: "Both", icon: "Users" };
const PRODUCTION_GROUP = { menuGroupName: "Production", sequence: 5, isLink: false, portal: "Both", icon: "Factory" };
// Data Entry used to be the last item inside Production — promoted to its
// own top-level link for the same reason Dashboard was (it's opened far more
// often than the master lists it used to sit beside). Same promotion
// mechanism as Dashboard above; the URL is unchanged.
const DATA_ENTRY_GROUP = { menuGroupName: "CNC Data Entry", sequence: 6, isLink: true, menuUrl: "/hqepl/production/cnc-data-entry", portal: "Both", icon: "ClipboardList" };
const SUPPORT_GROUP = { menuGroupName: "Support", sequence: 7, isLink: true, menuUrl: "/hqepl/support", portal: "Both", icon: "Headphones" };

const ADMINISTRATION_MENUS = [
  { menuName: "Menu Group", menuUrl: "/x/menu-groups", sequence: 1, icon: "FolderTree" },
  { menuName: "Menu Master", menuUrl: "/x/menus", sequence: 2, icon: "List" },
  { menuName: "Company", menuUrl: "/x/company", sequence: 3, icon: "Building2" },
];

const PRODUCTION_MENUS = [
  { menuName: "Processes", menuUrl: "/hqepl/production/processes", sequence: 1, icon: "Workflow" },
  { menuName: "Machines", menuUrl: "/hqepl/production/machines", sequence: 2, icon: "Wrench" },
  { menuName: "Items", menuUrl: "/hqepl/production/items", sequence: 3, icon: "Package" },
  { menuName: "Operators", menuUrl: "/hqepl/production/operators", sequence: 4, icon: "UserRound" },
  // Dashboard and Data Entry are NOT listed here any more (they are
  // DASHBOARD_GROUP/DATA_ENTRY_GROUP above). Listing either again would
  // re-activate its retired row on every run.
];

const EMPLOYEE_MANAGEMENT_MENUS = [
  { menuName: "Company Holidays", menuUrl: "/hqepl/employee-management/company-holidays", sequence: 1, icon: "CalendarOff" },
  { menuName: "Department", menuUrl: "/hqepl/employee-management/department", sequence: 2, icon: "Building" },
  { menuName: "Teams", menuUrl: "/hqepl/teams", sequence: 3, icon: "UsersRound" },
  { menuName: "Role", menuUrl: "/hqepl/employee-management/role", sequence: 4, icon: "ShieldCheck" },
  { menuName: "Employee", menuUrl: "/hqepl/employee-management/employee", sequence: 5, icon: "User" },
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

// Moves a page that used to be a menu ITEM (a MenuMaster row inside some
// group) to the top-level link GROUP that now owns its URL, on a database
// that already has the old row:
//
//   1. Every role that was granted the old item gets the same flags on the
//      new link group (OR-merged into an existing entry if an admin already
//      ticked the new one — a role must never end up with two entries for
//      one group, because the client reads only the first). Without this the
//      operators who could open the page would silently lose it: no sidebar
//      link, "/no-access" on the URL, and 403 from the API.
//   2. Anyone who pinned the old item as a shortcut keeps their tile.
//   3. Only then is the old row switched off. It is deactivated, not deleted:
//      inactive rows are ignored everywhere, and keeping its _id means a
//      re-run can carry over a permission that a stale Manage Role tab wrote
//      back after this ran.
//
// Order matters (carry first, deactivate second) and every step is safe to
// repeat, so a run that dies half-way is fixed by simply running it again.
async function promoteMenuToLinkGroup(menuUrlPattern, group) {
  const oldIds = (await MenuMaster.find({ menuUrl: menuUrlPattern }).select("_id")).map((m) => m._id);
  if (!oldIds.length) return;
  const isOld = (id) => !!id && oldIds.some((oldId) => oldId.equals(id));

  let migratedRoles = 0;
  for (const doc of await OperatorRoles.find({ "roles.menuId": { $in: oldIds } })) {
    const oldEntries = doc.roles.filter((r) => isOld(r.menuId));
    let target = doc.roles.find((r) => r.menuGroupId && r.menuGroupId.equals(group._id));
    if (!target) {
      doc.roles.push({ menuGroupId: group._id, menuId: null });
      target = doc.roles[doc.roles.length - 1];
    }
    for (const flag of ["view", "create", "edit", "delete"]) {
      target[flag] = target[flag] || oldEntries.some((r) => r[flag]);
    }
    for (const r of oldEntries) doc.roles.pull(r._id);
    await doc.save();
    migratedRoles += 1;
  }

  let migratedPins = 0;
  for (const oldId of oldIds) {
    const from = `m_${oldId}`;
    const to = `g_${group._id}`;
    for (const Model of [User, Operator]) {
      // Already pinned both? Just drop the old one so it isn't listed twice.
      await Model.updateMany({ "preferences.shortcuts": { $all: [from, to] } }, { $pull: { "preferences.shortcuts": from } });
      const res = await Model.updateMany({ "preferences.shortcuts": from }, { $set: { "preferences.shortcuts.$": to } });
      migratedPins += res.modifiedCount;
    }
  }

  const retired = await MenuMaster.updateMany({ _id: { $in: oldIds }, isActive: true }, { $set: { isActive: false } });
  console.log(`"${group.menuGroupName}" promoted to a top-level link: ${migratedRoles} role(s) carried over, ${migratedPins} shortcut(s) re-pinned, ${retired.modifiedCount} old menu row(s) retired.`);
}

async function run() {
  await connectDB();

  await upsertGroup(HOME_GROUP);

  const dashboardGroup = await upsertGroup(DASHBOARD_GROUP);
  await promoteMenuToLinkGroup(/\/production\/dashboard\/?$/, dashboardGroup);

  const adminGroup = await upsertGroup(ADMINISTRATION_GROUP);
  await upsertMenus(ADMINISTRATION_MENUS, adminGroup);

  const productionGroup = await upsertGroup(PRODUCTION_GROUP);
  await upsertMenus(PRODUCTION_MENUS, productionGroup);

  const dataEntryGroup = await upsertGroup(DATA_ENTRY_GROUP);
  await promoteMenuToLinkGroup(/\/production\/data-entry\/?$/, dataEntryGroup);

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
