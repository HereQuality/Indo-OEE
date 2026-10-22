'use strict';
/**
 * Seeds the THROWAWAY e2e database through the app's own Mongoose models.
 * Never reads server/.env. Refuses any non-local MONGO_URI.
 *   MONGO_URI=mongodb://127.0.0.1:<port>/indo_e2e node mobile/e2e/seed_e2e.js
 * Writes mobile/e2e/e2e_env.json (ids + credentials).
 */
const fs = require('fs');
const path = require('path');
const { assertSafeMongoUri } = require('./safety');

const SERVER = path.resolve(__dirname, '../../server');
const req = (p) => require(path.join(SERVER, p));
const uri = assertSafeMongoUri(process.env.MONGO_URI);
const PORT = process.env.E2E_PORT || '5099';

const mongoose = req('node_modules/mongoose');
const Company = req('models/Company');
const User = req('models/user.model');
const Operator = req('models/Operator');
const RoleMaster = req('models/RoleMaster');
const OperatorRoles = req('models/OperatorRoles');
const Department = req('models/Department');
const MenuGroupMaster = req('models/MenuGroupMaster');
const MenuMaster = req('models/MenuMaster');
const Process = req('models/Process');
const Machine = req('models/Machine');
const MachineOperator = req('models/MachineOperator');
const Item = req('models/Item');
const Vendor = req('models/Vendor');
const CompanyHoliday = req('models/CompanyHoliday');
const WeeklyOffSetting = req('models/WeeklyOffSetting');

const ADMIN_PW = 'E2e#Admin123';
const USER_PW = 'E2e#Pass123';
const P = '/hqepl/production';

// ── Menus: same groups/pages as server/seed/seedMenus.js ───────────────────
const GROUPS = {
  home: { menuGroupName: 'Home', sequence: 1, isLink: true, menuUrl: '/hqepl/home', portal: 'Both', icon: 'Home' },
  dashboard: { menuGroupName: 'Dashboard', sequence: 2, isLink: true, menuUrl: `${P}/dashboard`, portal: 'Both', icon: 'LayoutDashboard' },
  admin: { menuGroupName: 'Administration', sequence: 3, isLink: false, portal: 'SuperAdmin', icon: 'Settings' },
  empMgmt: { menuGroupName: 'Operator Management', sequence: 4, isLink: false, portal: 'Both', icon: 'Users' },
  production: { menuGroupName: 'Production', sequence: 5, isLink: false, portal: 'Both', icon: 'Factory' },
  dataEntry: { menuGroupName: 'Data Entry', sequence: 6, isLink: false, portal: 'Both', icon: 'FileBarChart' },
  support: { menuGroupName: 'Support', sequence: 8, isLink: true, menuUrl: '/hqepl/support', portal: 'Both', icon: 'Headphones' },
};
const m = (menuName, menuUrl, sequence, icon) => ({ menuName, menuUrl, sequence, icon });
const MENUS = {
  admin: [m('Menu Group', '/x/menu-groups', 1, 'FolderTree'), m('Menu Master', '/x/menus', 2, 'List'), m('Company', '/x/company', 3, 'Building2')],
  empMgmt: [
    m('Company Holidays', '/hqepl/employee-management/company-holidays', 1, 'CalendarOff'),
    m('Department', '/hqepl/employee-management/department', 2, 'Building'),
    m('Teams', '/hqepl/teams', 3, 'UsersRound'),
    m('Role', '/hqepl/employee-management/role', 4, 'ShieldCheck'),
    m('Employee', '/hqepl/employee-management/employee', 5, 'User'),
    m('Manage Role', '/hqepl/employee-management/manage-role', 6, 'UserCog'),
  ],
  production: [
    m('Processes', `${P}/processes`, 1, 'Workflow'), m('Machines', `${P}/machines`, 2, 'Wrench'),
    m('Parts', `${P}/parts`, 3, 'Package'), m('Operators', `${P}/operators`, 4, 'UserRound'),
    m('Vendors', `${P}/vendors`, 5, 'Truck'), m('Work Orders', `${P}/work-orders`, 6, 'ClipboardCheck'),
    m('OEE Review', `${P}/oee-review`, 7, 'ShieldAlert'),
  ],
  dataEntry: [
    m('CNC', `${P}/cnc-data-entry`, 1, 'ClipboardList'), m('VMC', `${P}/vmc-data-entry`, 2, 'ClipboardList'),
    m('SPM', `${P}/spm-data-entry`, 3, 'ClipboardList'), m('RIVET', `${P}/rivet-data-entry`, 4, 'ClipboardList'),
    m('PRESS', `${P}/press-data-entry`, 5, 'ClipboardList'), m('CONTACT', `${P}/contact-data-entry`, 6, 'ClipboardList'),
    m('TROBE', `${P}/trobe-data-entry`, 7, 'ClipboardList'), m('SPRING FOR PINS', `${P}/spring-data-entry`, 8, 'ClipboardList'),
    m('AFTER POWDER COATING', `${P}/powder-coating-data-entry`, 9, 'ClipboardList'),
  ],
};

// ── Processes, machines, operators, parts ─────────────────────────────────
// page: slug of the data-entry page (null = unsupported, e.g. RUBBER)
const PROCESSES = [
  { name: 'CNC', page: 'cnc', label: 'CNC Data Entry', machines: ['CNC-1', 'CNC-2', 'CNC-3'] },
  { name: 'VMC', page: 'vmc', label: 'VMC Data Entry', machines: ['VMC-1', 'VMC-2', 'VMC-3'] },
  { name: 'SPM', page: 'spm', label: 'SPM Data Entry', machines: ['SPM-1', 'SPM-2', 'SPM-3'] },
  { name: 'RIVET', page: 'rivet', label: 'RIVET Data Entry', machines: ['RIV-1', 'RIV-2', 'RIV-3'] },
  { name: 'PRESS', page: 'press', label: 'PRESS Data Entry', machines: ['PRS-1', 'PRS-2', 'PRS-3'] },
  { name: 'CONTACT', page: 'contact', label: 'CONTACT Data Entry', machines: ['CON-1', 'CON-2', 'CON-3'] },
  { name: 'TROBE', page: 'trobe', label: 'TROBE Data Entry', machines: ['TRB-1', 'TRB-2', 'TRB-3'] },
  { name: 'SPRING FOR PINS', page: 'spring', label: 'SPRING FOR PINS Data Entry', machines: ['SPG-1', 'SPG-2', 'SPG-3'] },
  { name: 'AFTER POWDER COATING', page: 'powder-coating', label: 'AFTER POWDER COATING Data Entry', machines: ['APC-1'] },
  { name: 'RUBBER', page: null, label: null, machines: ['RUB-1', 'RUB-2'] },
];
const OPERATOR_NAMES = {
  CNC: ['Ramesh Kumar', 'Suresh Patil', 'Mahesh Yadav'],
  VMC: ['Dinesh Shah', 'Anil Verma', 'Kiran Joshi'],
  SPM: ['Vijay Singh', 'Rajesh Nair', 'Sanjay More'],
  RIVET: ['Prakash Rao', 'Manoj Gupta', 'Deepak Jain'],
  PRESS: ['Ashok Pawar', 'Nitin Desai', 'Sachin Kale'],
  CONTACT: ['Ganesh Iyer', 'Ravi Mishra', 'Umesh Shinde'],
  TROBE: ['Harish Reddy', 'Pankaj Das', 'Vikas Thakur'],
  'SPRING FOR PINS': ['Amit Bhat', 'Rohit Sawant', 'Yogesh Kulkarni'],
  'AFTER POWDER COATING': ['Sunita Devi', 'Meena Kumari', 'Lata Bai'],
  RUBBER: ['Babu Lal', 'Chandu Rao'],
};
// Parts: the cycle-time fields each process needs (see models/Item.js).
const PARTS = {
  CNC: [
    { itemName: 'CNC Shaft 25', drawingNo: 'DRG-C101', setupNo: 'S-11', drillingSec: 20, boringSec: 15, threadingSec: 10, tappingSec: 5, clampDeclampSec: 10, totalCycleSec: 60 },
    { itemName: 'CNC Bush 18', drawingNo: 'DRG-C102', setupNo: 'S-12', drillingSec: 12, chamferingSec: 8, clampDeclampSec: 10, totalCycleSec: 30 },
  ],
  VMC: [
    { itemName: 'VMC Bracket VB-10', drawingNo: 'DRG-V101', setupNo: 'S-21', programTimeMin: 6, pcsPerProgram: 2, totalCycleSec: 180 },
    { itemName: 'VMC Flange VF-24', drawingNo: 'DRG-V224', setupNo: 'S-22', programTimeMin: 4, pcsPerProgram: 4, totalCycleSec: 60 },
  ],
  SPM: [
    { itemName: 'SPM Plate SP-5', drawingNo: 'DRG-S501', noOfHoles: 4, piecesPerCycle: 2, strokeRequired: 4, loadingSec: 6, processSec: 10, unloadingCleaningSec: 4, otherOperationsSec: 0, totalCycleSec: 20 },
    { itemName: 'SPM Clip SC-9', drawingNo: 'DRG-S902', noOfHoles: 2, piecesPerCycle: 1, strokeRequired: 2, loadingSec: 4, processSec: 8, unloadingCleaningSec: 3, otherOperationsSec: 0, totalCycleSec: 15 },
  ],
  RIVET: [
    { itemName: 'RIVET Hinge RH-3', drawingNo: 'DRG-R301', noOfHoles: 2, rivetProcessType: 'Rivet', rivetLoadingSec: 5, rivetProcessSec: 8, rivetUnloadingCleaningSec: 3, rivetOtherOperationsSec: 0, totalCycleSec: 16 },
    { itemName: 'RIVET Clamp RC-7', drawingNo: 'DRG-R702', noOfHoles: 1, rivetProcessType: 'Clamp', rivetLoadingSec: 4, rivetProcessSec: 6, rivetUnloadingCleaningSec: 2, rivetOtherOperationsSec: 0, totalCycleSec: 12 },
  ],
  PRESS: [
    { itemName: 'PRESS Blank PB-2', drawingNo: 'DRG-P201', setupNo: 'S-51', pressOperation: 'Blank', standardTimeMin: 2, pcsPerStandardTime: 60 },
    { itemName: 'PRESS Bend PB-8', drawingNo: 'DRG-P802', setupNo: 'S-52', pressOperation: 'Bending', standardTimeMin: 3, pcsPerStandardTime: 90 },
  ],
  CONTACT: [{ itemName: 'CONTACT Tip CT-1', drawingNo: 'DRG-K101', totalCycleSec: 12 }, { itemName: 'CONTACT Tip CT-2', drawingNo: 'DRG-K102', totalCycleSec: 18 }],
  TROBE: [{ itemName: 'TROBE Pin TP-1', drawingNo: 'DRG-T101', totalCycleSec: 25 }, { itemName: 'TROBE Pin TP-2', drawingNo: 'DRG-T102', totalCycleSec: 35 }],
  'SPRING FOR PINS': [{ itemName: 'SPRING Coil SG-1', drawingNo: 'DRG-G101', totalCycleSec: 8 }, { itemName: 'SPRING Coil SG-2', drawingNo: 'DRG-G102', totalCycleSec: 10 }],
  'AFTER POWDER COATING': [{ itemName: 'APC Cover AC-1', drawingNo: 'DRG-A101', totalCycleSec: 30 }, { itemName: 'APC Cover AC-2', drawingNo: 'DRG-A102', totalCycleSec: 45 }],
  RUBBER: [{ itemName: 'RUBBER Seal RS-1', drawingNo: 'DRG-B101', totalCycleSec: 40 }],
};
const VENDORS = [
  { name: 'Bharat Tooling Co', processes: ['CNC', 'VMC', 'PRESS'] },
  { name: 'Alpha Platers', processes: ['RIVET', 'AFTER POWDER COATING', 'SPM'] },
  { name: 'Shree Coaters', processes: ['CONTACT', 'TROBE', 'SPRING FOR PINS'] },
];

const upsertGroup = (def) =>
  MenuGroupMaster.findOneAndUpdate({ menuGroupName: def.menuGroupName, portal: def.portal }, { ...def, isActive: true }, { upsert: true, new: true, setDefaultsOnInsert: true });
const upsertMenu = (def, groupId) =>
  MenuMaster.findOneAndUpdate({ menuUrl: def.menuUrl }, { ...def, menuGroup: groupId, isActive: true, isParent: false, parentMenu: null }, { upsert: true, new: true, setDefaultsOnInsert: true });

async function main() {
  await mongoose.connect(uri);
  if (!/^indo_e2e/.test(mongoose.connection.name)) throw new Error('E2E SAFETY: database name must be indo_e2e*');
  await mongoose.connection.dropDatabase(); // throwaway DB only (guarded above)
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init()));

  const company = await Company.create({ name: 'HQEPL E2E Test Company', status: 'active', plan: 'Basic' });

  // Menus
  const groups = {};
  for (const [k, def] of Object.entries(GROUPS)) groups[k] = await upsertGroup(def);
  const menus = {};
  for (const [k, list] of Object.entries(MENUS)) for (const def of list) menus[def.menuUrl] = await upsertMenu(def, groups[k]._id);
  company.menus = Object.values(menus).map((x) => x._id);
  await company.save();

  // Holidays + weekly off
  await WeeklyOffSetting.create({ weeklyOffDays: [0] });
  await CompanyHoliday.create([
    { name: 'Republic Day', date: new Date('2026-01-26T00:00:00Z'), isRecurringYearly: true },
    { name: 'Independence Day', date: new Date('2026-08-15T00:00:00Z'), isRecurringYearly: true },
    { name: 'Gandhi Jayanti', date: new Date('2026-10-02T00:00:00Z'), isRecurringYearly: true },
  ]);

  // Processes / machines / operators / parts
  const out = { processes: {}, machines: {}, machineOperators: {}, items: {}, vendors: {} };
  const procDocs = {};
  for (const p of PROCESSES) {
    const doc = await Process.create({
      processName: p.name,
      description: `${p.name} (e2e)`,
      dataEntryMenu: p.page ? `${P}/${p.page}-data-entry` : null,
      dataEntryMenuLabel: p.label,
    });
    procDocs[p.name] = doc;
    out.processes[p.name] = { id: String(doc._id), page: p.page ? `${P}/${p.page}-data-entry` : null };
    out.machines[p.name] = [];
    for (const [i, machineName] of p.machines.entries()) {
      const mc = await Machine.create({ machineName, process: doc._id, sequence: i + 1, isActive: true });
      out.machines[p.name].push({ id: String(mc._id), name: machineName });
    }
    out.machineOperators[p.name] = [];
    for (const name of OPERATOR_NAMES[p.name]) {
      const mo = await MachineOperator.create({ name, processes: [doc._id], isActive: true });
      out.machineOperators[p.name].push({ id: String(mo._id), name });
    }
    out.items[p.name] = [];
    for (const part of PARTS[p.name]) {
      const it = await Item.create({ ...part, process: doc._id, isActive: true });
      out.items[p.name].push({ id: String(it._id), name: it.itemName });
    }
  }
  for (const v of VENDORS) {
    const doc = await Vendor.create({ name: v.name, processes: v.processes.map((n) => procDocs[n]._id), isActive: true });
    out.vendors[v.name] = { id: String(doc._id), processes: v.processes };
  }

  // Users
  const admin = await User.create({ name: 'E2E Super Admin', username: 'e2e_admin', email: 'e2e_admin@example.test', password: ADMIN_PW, roleType: 'SuperAdmin', isEmailVerified: true });
  const dept = await Department.create({ departmentName: 'Production', departmentCode: 'PRD' });

  const mk = (url) => ({ menuId: menus[url]._id, view: true, create: true, edit: true, delete: true });
  const mkView = (url) => ({ menuId: menus[url]._id, view: true, create: false, edit: false, delete: false });
  const dashGroup = (full) => ({ menuGroupId: groups.dashboard._id, view: true, create: full, edit: full, delete: full });
  const allDataEntry = MENUS.dataEntry.map((x) => x.menuUrl);
  const ROLES = [
    { roleName: 'Admin', roleCode: 'admin', perms: [dashGroup(true), { menuGroupId: groups.home._id, view: true }, ...[...MENUS.dataEntry, ...MENUS.production].map((x) => mk(x.menuUrl))] },
    { roleName: 'VMC Operator', roleCode: 'VMC Operator', perms: [dashGroup(false), mk(`${P}/vmc-data-entry`)] },
    { roleName: 'Multi Operator', roleCode: 'Multi Operator', perms: [dashGroup(false), ...['vmc', 'press', 'cnc'].map((s) => mk(`${P}/${s}-data-entry`))] },
    { roleName: 'View Only', roleCode: 'View Only', perms: [dashGroup(false), mkView(`${P}/vmc-data-entry`)] },
  ];
  const roleDocs = {};
  for (const r of ROLES) {
    const role = await RoleMaster.create({ roleName: r.roleName, roleCode: r.roleCode, isActive: true });
    await OperatorRoles.create({ roleId: role._id, roles: r.perms, isActive: true });
    roleDocs[r.roleName] = role;
  }

  const USERS = [
    { username: 'e2e_vmc', name: 'E2E VMC Operator', role: 'VMC Operator' },
    { username: 'e2e_multi', name: 'E2E Multi Operator', role: 'Multi Operator' },
    { username: 'e2e_viewonly', name: 'E2E View Only', role: 'View Only' },
    { username: 'e2e_roleadmin', name: 'E2E Role Admin', role: 'Admin' },
  ];
  const users = {
    e2e_admin: { id: String(admin._id), username: 'e2e_admin', password: ADMIN_PW, roleType: 'SuperAdmin', role: 'SuperAdmin' },
  };
  for (const u of USERS) {
    const op = await Operator.create({
      employeeName: u.name, employeeCode: u.username.toUpperCase(), username: u.username, emailOffice: `${u.username}@example.test`,
      roleId: roleDocs[u.role]._id, departmentIds: [dept._id], password: USER_PW, isActive: true, joiningDate: new Date('2026-01-01'),
    });
    users[u.username] = { id: String(op._id), username: u.username, password: USER_PW, roleType: 'Operator', role: u.role };
  }

  const env = {
    generatedAt: new Date().toISOString(),
    warning: 'Throwaway e2e database only. These credentials exist nowhere else.',
    baseUrl: `http://127.0.0.1:${PORT}`,
    androidEmulatorBaseUrl: `http://10.0.2.2:${PORT}`,
    mongoUri: uri,
    company: { id: String(company._id), name: company.name },
    users,
    roles: Object.fromEntries(Object.entries(roleDocs).map(([k, v]) => [k, String(v._id)])),
    menuGroups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, String(v._id)])),
    dataEntryPages: allDataEntry,
    ...out,
  };
  fs.writeFileSync(path.join(__dirname, 'e2e_env.json'), JSON.stringify(env, null, 2));
  console.log(`[e2e] seeded ${Object.keys(out.processes).length} processes, ${Object.keys(users).length} users -> mobile/e2e/e2e_env.json`);
  await mongoose.disconnect();
}
main().catch((e) => { console.error('[e2e] seed failed:', e); process.exit(1); });
