"use strict";
/**
 * scripts/seed.js
 *
 * One-shot seeder for a fresh database:
 *   1. The platform-owner SuperAdmin account (email/username/password below).
 *   2. Menu Groups + Menus for the HQEPL (SuperAdmin) portal:
 *      Administration (Menu Group, Menu Master, Company), Production
 *      (Data Entry, Machines, Items), Operator Management
 *      (Department/Teams/Role/Operator/Manage Role), Support.
 *   3. A Menu Group + Menu for the normal Operator portal's Home.
 *
 * Safe to re-run: every insert is upsert-by-natural-key.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/user.model");
const MenuGroupMaster = require("../models/MenuGroupMaster");
const MenuMaster = require("../models/MenuMaster");

const SUPERADMIN = {
  name: "HQEPL Admin",
  username: "hqepl",
  email: "csc@herequality.com",
  password: process.env.SEED_ADMIN_PASSWORD,
  roleType: "SuperAdmin",
};

// ── Menu groups & menus ──────────────────────────────────────────────
const EMPLOYEE_DASHBOARD_GROUP = {
  menuGroupName: "Home",
  sequence: 1,
  isLink: true,
  menuUrl: "/hqepl/home", // prefix is rewritten per-role at render time
  portal: "Both",
  icon: "Home",
};

const ADMINISTRATION_GROUP = {
  menuGroupName: "Administration",
  sequence: 2,
  isLink: false,
  portal: "SuperAdmin",
  icon: "Settings",
};

const ADMINISTRATION_MENUS = [
  { menuName: "Menu Group", menuUrl: "/x/menu-groups", sequence: 1, icon: "FolderTree" },
  { menuName: "Menu Master", menuUrl: "/x/menus", sequence: 2, icon: "List" },
  { menuName: "Company", menuUrl: "/x/company", sequence: 3, icon: "Building2" },
];

const PRODUCTION_GROUP = {
  menuGroupName: "Production",
  sequence: 4,
  isLink: false,
  portal: "Both",
  icon: "Factory",
};

const PRODUCTION_MENUS = [
  { menuName: "Data Entry", menuUrl: "/hqepl/production/data-entry", sequence: 1, icon: "ClipboardList" },
  { menuName: "Machines", menuUrl: "/hqepl/production/machines", sequence: 2, icon: "Wrench" },
  { menuName: "Items", menuUrl: "/hqepl/production/items", sequence: 3, icon: "Package" },
];

const EMPLOYEE_MANAGEMENT_GROUP = {
  menuGroupName: "Operator Management",
  sequence: 3,
  isLink: false,
  portal: "Both",
  icon: "Users",
};

const EMPLOYEE_MANAGEMENT_MENUS = [
  { menuName: "Department", menuUrl: "/hqepl/employee-management/department", sequence: 1, icon: "Building" },
  { menuName: "Teams", menuUrl: "/hqepl/teams", sequence: 2, icon: "UsersRound" },
  { menuName: "Role", menuUrl: "/hqepl/employee-management/role", sequence: 3, icon: "ShieldCheck" },
  { menuName: "Operator", menuUrl: "/hqepl/employee-management/employee", sequence: 5, icon: "User" },
  { menuName: "Manage Role", menuUrl: "/hqepl/employee-management/manage-role", sequence: 6, icon: "UserCog" },
];

// Support ticketing. Every role sees it (isLink: true, direct page — no
// submenu), but what happens on it depends on their Manage Role permission:
//   - SuperAdmin: always full access (built-in bypass, no permission row needed).
//   - Operator with "write"/edit on this menu: becomes a support AGENT —
//     everyone else's tickets land in their queue instead of going straight
//     to SuperAdmin (see server/utils/supportAgent.js).
//   - Operator with only "read": can raise their own tickets, nothing else.
const SUPPORT_GROUP = {
  menuGroupName: "Support",
  sequence: 5,
  isLink: true,
  menuUrl: "/hqepl/support",
  portal: "Both",
  icon: "Headphones",
};

async function upsertGroup(def) {
  const group = await MenuGroupMaster.findOneAndUpdate(
    { menuGroupName: def.menuGroupName, portal: def.portal },
    { ...def, isActive: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return group;
}

async function run() {
  await connectDB();

  // ── 1. SuperAdmin user ────────────────────────────────────────────
  let admin = await User.findOne({ email: SUPERADMIN.email });
  if (!admin) {
    if (!SUPERADMIN.password) throw new Error("SEED_ADMIN_PASSWORD is not set in server/.env");
    admin = await User.create(SUPERADMIN); // pre-save hook hashes the password
    console.log(`Created SuperAdmin: ${SUPERADMIN.email} / ${SUPERADMIN.username}`);
  } else {
    console.log(`SuperAdmin already exists: ${SUPERADMIN.email} (left untouched)`);
  }

  // ── 2. HQEPL (SuperAdmin) portal menus ───────────────────────────
  // Clear old menus to prevent duplicates due to URL changes
  await MenuGroupMaster.deleteMany({});
  await MenuMaster.deleteMany({});

  const adminGroup = await upsertGroup(ADMINISTRATION_GROUP);
  for (const menu of ADMINISTRATION_MENUS) {
    await MenuMaster.findOneAndUpdate(
      { menuUrl: menu.menuUrl },
      {
        menuName: menu.menuName,
        menuGroup: adminGroup._id,
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
  
  const productionGroup = await upsertGroup(PRODUCTION_GROUP);
  for (const menu of PRODUCTION_MENUS) {
    await MenuMaster.findOneAndUpdate(
      { menuUrl: menu.menuUrl },
      {
        menuName: menu.menuName,
        menuGroup: productionGroup._id,
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

  const empMgmtGroup = await upsertGroup(EMPLOYEE_MANAGEMENT_GROUP);

  for (const menu of EMPLOYEE_MANAGEMENT_MENUS) {
    await MenuMaster.findOneAndUpdate(
      { menuUrl: menu.menuUrl },
      {
        menuName: menu.menuName,
        menuGroup: empMgmtGroup._id,
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

  // Add Support as a direct link group
  await upsertGroup(SUPPORT_GROUP);

  console.log("Seeded HQEPL menu groups + Operator Management menus.");

  // ── 3. Normal Operator portal dashboard ──────────────────────────
  await upsertGroup(EMPLOYEE_DASHBOARD_GROUP);
  console.log("Seeded Operator portal dashboard menu group.");

  console.log("\nDone. Login with:");
  console.log(`  username: ${SUPERADMIN.username}`);
  console.log(`  email:    ${SUPERADMIN.email}`);
  console.log(`  password: ${SUPERADMIN.password}`);

  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
