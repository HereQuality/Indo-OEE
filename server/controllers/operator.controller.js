const Operator = require("../models/Operator");
const Team = require("../models/Team");
const jwt = require("jsonwebtoken");
const { getDefaultRedirectUrl, _logLogin: logLogin, _logLoginFailed: logLoginFailed } = require("./auth.controller");
const { recordAudit, nameMap, plain } = require("../utils/auditTrail");
const User = require("../models/user.model");
const Department = require("../models/Department");
const RoleMaster = require("../models/RoleMaster");

// ── Audit trail ───────────────────────────────────────────────────────
// What of an employee record the audit trail shows (utils/auditTrail.js):
// the Employee form's fields, with departments / teams / role / managers by
// name. The password (and its hash), OTPs, reset tokens, sign-in attempts and
// lock are never part of it — stripped here explicitly as well as left out of
// the list, so a later field can't slip in by accident.
const SENSITIVE_FIELDS = ["password", "passwordHash", "otp", "resetPasswordOtp", "otpExpires", "resetToken", "loginAttempts", "lockUntil", "tokens", "preferences"];
const EMPLOYEE_AUDIT_FIELDS = {
  employeeCode: "Employee code", employeeName: "Employee name", firstName: "First name", lastName: "Last name", username: "Username",
  departmentIds: "Departments", roleId: "Role", teamIds: "Teams", reportingManagerIds: "Reporting managers", skills: "Skills",
  joiningDate: "Joining date", emailOffice: "Office email", mobileNumber: "Mobile", country: "Country", state: "State", city: "City",
  address: "Address", remark: "Remark", profilePic: "Profile picture", isActive: "Active", isBlocked: "Blocked",
};
const employeeView = async (e) => {
  if (!e) return {};
  const d = plain(e);
  for (const k of SENSITIVE_FIELDS) delete d[k];
  const idOf = (v) => String(v?._id || v);
  const [depts, teams, roles, managers] = await Promise.all([
    nameMap(Department, [d.departmentIds], "departmentName"),
    nameMap(Team, [d.teamIds], "teamName"),
    nameMap(RoleMaster, [d.roleId], "roleName"),
    nameMap(Operator, [d.reportingManagerIds], "employeeName"),
  ]);
  const names = (list, map) => (list || []).map((v) => map[idOf(v)] || idOf(v));
  const out = {};
  for (const k of Object.keys(EMPLOYEE_AUDIT_FIELDS)) if (d[k] !== undefined) out[k] = d[k];
  out.departmentIds = names(d.departmentIds, depts);
  out.teamIds = names(d.teamIds, teams);
  out.reportingManagerIds = names(d.reportingManagerIds, managers);
  out.roleId = d.roleId ? roles[idOf(d.roleId)] || idOf(d.roleId) : null;
  if (d.joiningDate) out.joiningDate = new Date(d.joiningDate).toISOString().slice(0, 10);
  if (out.profilePic !== undefined) out.profilePic = out.profilePic ? "Uploaded" : null;
  return out;
};
const employeeLabel = (e) => e?.employeeName || e?.username || "";
const auditEmployee = async (req, action, before, after, remark) =>
  recordAudit({ req, entityType: "operator", entity: (after || before)?._id, label: employeeLabel(after || before), action, before: await employeeView(before), after: await employeeView(after), fields: EMPLOYEE_AUDIT_FIELDS, remark });
exports._employeeView = employeeView;

const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_TIME = 2 * 60 * 1000; // 2 minutes

// ── Helpers ──────────────────────────────────────────────────────
/**
 * Every employee id that reports to `requesterId`, directly or through a
 * chain of managers (e.g. requester manages A, A manages B → B is included).
 * Replaces the old role-hierarchy-canvas-based getVisibleRoleIds() — that
 * canvas system was removed; visibility is now derived straight from each
 * employee's own Operator.reportingManagerIds instead of a separately
 * saved chart, so it can't drift out of sync with it.
 */
const getVisibleEmployeeIds = async (requesterId) => {
  const all = await Operator.find({}, { reportingManagerIds: 1 }).lean();

  const directReportsOf = new Map(); // managerId -> [employeeId, ...]
  all.forEach((e) => {
    (e.reportingManagerIds || []).forEach((mgr) => {
      const mgrId = mgr.toString();
      if (!directReportsOf.has(mgrId)) directReportsOf.set(mgrId, []);
      directReportsOf.get(mgrId).push(e._id.toString());
    });
  });

  const visible = new Set();
  const queue = [requesterId.toString()];
  while (queue.length > 0) {
    const current = queue.shift();
    (directReportsOf.get(current) || []).forEach((id) => {
      if (!visible.has(id)) {
        visible.add(id);
        queue.push(id);
      }
    });
  }
  return visible;
};

// The fields an employee save may write: the Employee form's, the Teams
// board's manager change and the block toggle. Everything else on the record
// (password, login attempts, lock, last login, preferences) has its own route
// or is the server's to set, so a crafted request can't slip it in.
const EMPLOYEE_FIELDS = [
  "firstName", "lastName", "employeeCode", "employeeName", "username",
  "departmentIds", "roleId", "skills", "teamIds", "reportingManagerIds",
  "joiningDate", "emailOffice", "mobileNumber", "country", "state", "city",
  "address", "remark", "isActive", "isBlocked",
];

// Array fields come as JSON strings when the form is sent as FormData.
const parseList = (v) => {
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch (e) { return [v]; }
};

// Team.memberIds is what the Teams page and Org Chart read, so it has to follow
// the employee's own teamIds — the same sync team.controller.js does the other
// way round. Every team they're in now gets them (which also mends a team
// saved before this sync existed); the teams they left lose them.
const syncTeams = async (employeeId, beforeTeamIds = [], afterTeamIds = []) => {
  const after = afterTeamIds.map(String);
  const removed = beforeTeamIds.map(String).filter((id) => !after.includes(id));
  if (after.length) {
    await Team.updateMany({ _id: { $in: after } }, { $addToSet: { memberIds: employeeId } });
  }
  if (removed.length) {
    await Team.updateMany({ _id: { $in: removed } }, { $pull: { memberIds: employeeId } });
  }
};

// Sanitise a string for use as part of a username
const slugifyName = (str = '') =>
  str.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

const signToken = (id, remember) => {
  return jwt.sign({ id, roleType: 'Operator' }, process.env.JWT_SECRET, {
    expiresIn: remember ? '30d' : '1d'
  });
};

const sendToken = (user, statusCode, res, remember) => {
  const token = signToken(user._id, remember);
  user.password = undefined;
  res.status(statusCode).json({
    isOk: true,
    token,
    data: user
  });
};

// Create Employee
exports.createEmployee = async (req, res) => {
  try {
    let {
      employeeCode, employeeName, departmentIds, teamIds, roleId,
      emailOffice, mobileNumber, address, password, isActive, remark,
      username: rawUsername, skills, joiningDate
    } = req.body;

    // Parse array fields if they come as JSON strings from FormData
    departmentIds = parseList(departmentIds);
    teamIds = parseList(teamIds);
    skills = parseList(skills);

    const displayName = employeeName || 'Operator';

    let username = rawUsername ? rawUsername.toLowerCase().trim() : null;
    if (!username) {
      return res.status(400).json({ isOk: false, message: "Username is required." });
    }

    const taken = await Operator.findOne({ username });
    if (taken) {
      return res.status(400).json({ isOk: false, message: "Username already taken. Please choose another." });
    }

    let profilePic = undefined;
    if (req.file && req.file.path) {
      profilePic = req.file.path;
    }

    const newEmployee = await Operator.create({
      employeeCode,
      employeeName: displayName,
      username,
      departmentIds,
      teamIds,
      roleId,
      skills,
      joiningDate,
      profilePic,
      emailOffice: emailOffice || undefined,
      mobileNumber,
      address,
      remark,
      password,
      isActive,
    });

    newEmployee.password = undefined;

    await syncTeams(newEmployee._id, [], newEmployee.teamIds || []);
    await auditEmployee(req, "create", null, newEmployee);

    res.status(201).json({
      isOk: true,
      data: newEmployee,
      message: "Employee created successfully"
    });
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Update Employee
exports.updateEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const updateData = {};
    EMPLOYEE_FIELDS.forEach((key) => {
      if (req.body[key] !== undefined) updateData[key] = req.body[key];
    });

    // Parse array fields if they come as JSON strings from FormData
    ["departmentIds", "teamIds", "skills", "reportingManagerIds"].forEach((key) => {
      if (updateData[key] !== undefined) updateData[key] = parseList(updateData[key]);
    });

    const existing = await Operator.findById(employeeId).lean();
    if (!existing) {
      return res.status(404).json({ isOk: false, message: "Employee not found" });
    }

    // Only Super Admin may move someone onto another role when it's their own
    // record — otherwise anyone who can edit employees could promote themselves.
    const isSelf = String(employeeId) === String(req.user?._id);
    if (
      isSelf &&
      req.user.roleType !== "SuperAdmin" &&
      updateData.roleId !== undefined &&
      String(updateData.roleId) !== String(existing.roleId)
    ) {
      return res.status(403).json({ isOk: false, message: "You can't change your own role." });
    }

    if (req.file && req.file.path) {
      updateData.profilePic = req.file.path;
    }

    if (updateData.username) {
      updateData.username = updateData.username.toLowerCase().trim();
      const conflict = await Operator.findOne({
        username: updateData.username,
        _id: { $ne: employeeId },
      });
      if (conflict) {
        return res.status(400).json({ isOk: false, message: "Username already taken." });
      }
    }

    const employee = await Operator.findOneAndUpdate(
      { _id: employeeId },
      updateData,
      { new: true }
    );

    if (!employee) {
      return res.status(404).json({ isOk: false, message: "Employee not found" });
    }

    if (updateData.teamIds !== undefined) {
      await syncTeams(employee._id, existing.teamIds || [], employee.teamIds || []);
    }

    // Blocking / unblocking (or deactivating / reactivating) is its own action
    // in the audit trail, so it stands out from an ordinary edit.
    const was = (v) => v === true || v === "true";
    const blockedNow = was(employee.isBlocked), blockedBefore = was(existing.isBlocked);
    const activeNow = employee.isActive !== false && employee.isActive !== "false", activeBefore = existing.isActive !== false;
    const action = blockedNow !== blockedBefore ? (blockedNow ? "blocked" : "unblocked") : activeNow !== activeBefore ? (activeNow ? "unblocked" : "blocked") : "update";
    await auditEmployee(req, action, existing, employee, action === "update" ? "" : activeNow !== activeBefore && blockedNow === blockedBefore ? (activeNow ? "Reactivated" : "Deactivated") : "");

    res.status(200).json({
      isOk: true,
      data: employee,
      message: "Employee updated successfully"
    });
  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await Operator.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ isOk: false, message: "Employee not found" });
    }

    const before = plain(employee);
    if (employee.isActive) {
      // Soft Delete
      employee.isActive = false;
      await employee.save({ validateBeforeSave: false });
      await auditEmployee(req, "delete", before, employee, "Deactivated — the employee is kept and can't sign in; a second delete removes them");
      return res.status(200).json({
        isOk: true,
        message: "Employee deactivated successfully"
      });
    } else {
      // Hard Delete — and off every team, so the Teams page doesn't list
      // someone who no longer exists.
      await Operator.findByIdAndDelete(employeeId);
      await syncTeams(employee._id, employee.teamIds || [], []);
      await auditEmployee(req, "delete", before, null, "Removed");
      return res.status(200).json({
        isOk: true,
        message: "Employee deleted successfully"
      });
    }
  } catch (error) {
    console.error("Error deleting employee:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Get Employee By Id
exports.getEmployeeById = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await Operator.findOne({ _id: employeeId })
      .populate('departmentIds', 'departmentName departmentCode')
      .populate('teamIds', 'teamName')
      .populate('roleId', 'roleName roleCode')
      .populate('reportingManagerIds', 'employeeName employeeCode');

    if (!employee) {
      return res.status(404).json({ isOk: false, message: "Employee not found" });
    }

    res.status(200).json({
      isOk: true,
      data: employee
    });
  } catch (error) {
    console.error("Error fetching employee:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Employees (no pagination) — for Employee Management page
exports.listAllEmployees = async (req, res) => {
  try {
    const employees = await Operator.find({})
      .populate('departmentIds', 'departmentName')
      .populate('teamIds', 'teamName')
      .populate('roleId', 'roleName')
      .populate('reportingManagerIds', 'employeeName employeeCode')
      .lean();

    res.status(200).json({
      isOk: true,
      data: employees
    });
  } catch (error) {
    console.error("Error listing employees:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List all Employees — for Access Panel and Team Members page
exports.listTeamMembers = async (req, res) => {
  try {
    const isAdmin = req.user.roleType === "SuperAdmin";
    let query = {};

    if (!isAdmin) {
      const visibleIds = await getVisibleEmployeeIds(req.user.id);

      query = {
        $or: [
          { _id: { $in: [...visibleIds] } },
          { _id: req.user.id }
        ]
      };
    }

    const employees = await Operator.find(query)
      .populate('departmentIds', 'departmentName')
      .populate('roleId', 'roleName')
      .populate('reportingManagerIds', 'employeeName employeeCode')
      .select('-password -preferences')
      .lean();

    res.status(200).json({
      isOk: true,
      data: employees
    });
  } catch (error) {
    console.error("Error listing access panel members:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Search / List Employees By Params (Pagination)
exports.listEmployeesByParams = async (req, res) => {
  try {
    const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;
    const Department = require("../models/Department");
    const Team = require("../models/Team");
    const RoleMaster = require("../models/RoleMaster");

    let query = {};
    if (match) {
      // Matched as plain text, so a "(" or "*" typed in can't break the search.
      const escaped = String(match).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Build base text-match conditions
      const baseOr = [
        { employeeName: { $regex: escaped, $options: "i" } },
        { emailOffice:  { $regex: escaped, $options: "i" } },
        { username:     { $regex: escaped, $options: "i" } },
        { firstName:    { $regex: escaped, $options: "i" } },
        { lastName:     { $regex: escaped, $options: "i" } },
      ];

      // Also search by department name
      const matchingDepts = await Department.find(
        { departmentName: { $regex: escaped, $options: "i" } },
        { _id: 1 }
      ).lean();
      if (matchingDepts.length > 0) {
        baseOr.push({ departmentIds: { $in: matchingDepts.map(d => d._id) } });
      }

      // Also search by team name
      const matchingTeams = await Team.find(
        { teamName: { $regex: escaped, $options: "i" } },
        { _id: 1 }
      ).lean();
      if (matchingTeams.length > 0) {
        baseOr.push({ teamIds: { $in: matchingTeams.map(t => t._id) } });
      }

      // Also search by role name
      const matchingRoles = await RoleMaster.find(
        { roleName: { $regex: escaped, $options: "i" } },
        { _id: 1 }
      ).lean();
      if (matchingRoles.length > 0) {
        baseOr.push({ roleId: { $in: matchingRoles.map(r => r._id) } });
      }

      query.$or = baseOr;
    }
    
    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    let sortQuery = { createdAt: -1 };
    if (sorton && sortdir) {
      sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };
    }

    const [totalCount, employees] = await Promise.all([
      Operator.countDocuments(query),
      Operator.find(query)
        .populate('departmentIds', 'departmentName')
        .populate('teamIds', 'teamName')
          .populate('roleId', 'roleName')
        .populate('reportingManagerIds', 'employeeName employeeCode')
        .select('-password -preferences')
        .sort(sortQuery)
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({
      isOk: true,
      data: [
        {
          count: totalCount,
          data: employees,
        },
      ],
    });
  } catch (error) {
    console.error("Error searching employees:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// List Employees by Department
exports.listAllEmployeesByDepartment = async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { skip = 0, per_page = 10 } = req.body || req.query; // Support both

    const query = { departmentId };
    
    const [totalCount, employees] = await Promise.all([
      Operator.countDocuments(query),
      Operator.find(query)
        .select('-password -preferences')
        .skip(parseInt(skip))
        .limit(parseInt(per_page))
        .lean(),
    ]);

    res.status(200).json({
      isOk: true,
      data: [
        {
          count: totalCount,
          data: employees
        }
      ]
    });
  } catch (error) {
    console.error("Error fetching employees by department:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ isOk: false, message: "New password is required" });
    }

    const employee = await Operator.findOne({ _id: employeeId });
    if (!employee) {
      return res.status(404).json({ isOk: false, message: "Employee not found" });
    }

    employee.password = password; // Will be hashed by pre-save hook
    await employee.save();
    await recordAudit({ req, entityType: "operator", entity: employee._id, label: employeeLabel(employee), action: "passwordReset", remark: "Password set by an administrator" });

    res.status(200).json({
      isOk: true,
      message: "Password reset successfully"
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Login Employee
exports.loginEmployee = async (req, res) => {
  try {
    const { username, emailOffice, password, remember } = req.body;
    const loginId = username || emailOffice;

    if (!loginId || !password) {
      return res.status(400).json({ isOk: false, message: 'Please provide username and password' });
    }

    const employee = await Operator.findOne({
      $or: [
        { username: loginId.toLowerCase() },
        { emailOffice: loginId.toLowerCase() },
      ]
    }).populate('roleId', 'roleName').select('+password');

    if (!employee) {
      await logLoginFailed(req, loginId, null, null, 'Unknown username');
      return res.status(401).json({ isOk: false, message: 'Incorrect username or password' });
    }

    if (employee.isBlocked) {
      await logLoginFailed(req, loginId, employee, 'Operator', 'Blocked');
      return res.status(403).json({ isOk: false, message: 'Account blocked by admin', isBlocked: true });
    }

    // Deleting an employee only deactivates them, so the record and its
    // password are still here and have to be refused.
    if (employee.isActive === false) {
      await logLoginFailed(req, loginId, employee, 'Operator', 'Inactive');
      return res.status(403).json({ isOk: false, message: 'Your account is inactive. Please contact your administrator.' });
    }

    if (employee.isLocked) {
      await logLoginFailed(req, loginId, employee, 'Operator', 'Account locked');
      const remainingMs = employee.lockUntil - Date.now();
      const remainingTime = Math.ceil(remainingMs / 60000);
      return res.status(423).json({ 
        isOk: false, 
        message: `Account locked. Try again in ${remainingTime} minute(s).`,
        remainingTimeMs: remainingMs,
      });
    }

    const isMatch = await employee.comparePassword(password);

    if (!isMatch) {
      employee.loginAttempts += 1;
      let responseMessage = 'Incorrect username or password';


      if (employee.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        employee.lockUntil = Date.now() + LOCK_TIME;
        employee.loginAttempts = 0;
        responseMessage = 'Account locked due to too many failed attempts.';
      }
      await employee.save({ validateBeforeSave: false });
      await logLoginFailed(req, loginId, employee, 'Operator', employee.lockUntil && employee.lockUntil > Date.now() ? 'Wrong password — account locked' : 'Wrong password');

      return res.status(401).json({ isOk: false, message: responseMessage });
    }

    // Success
    employee.loginAttempts = 0;
    employee.lockUntil = undefined;
    employee.lastLogin = Date.now();
    await employee.save({ validateBeforeSave: false });
    await logLogin(req, employee, 'Operator', { remember, client: req.body.client });

    sendToken(employee, 200, res, remember);
  } catch (err) {
    console.error("Error logging in:", err);
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Get Current User (Employee/Admin)
exports.getCurrentUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(404).json({ isOk: false, message: "User not found" });
    }

    let userData = req.user.toObject ? req.user.toObject() : req.user;
    userData.roleType = req.user.roleType;

    // Attach the role's URL slug (e.g. "manager") so the client knows which
    // path prefix to route this user under, without a second API call.
    if (userData.roleType === "Operator" && userData.roleId) {
      const RoleMaster = require("../models/RoleMaster");
      const role = await RoleMaster.findById(userData.roleId).select("roleSlug roleName roleCode");
      if (role) {
        userData.roleSlug = role.roleSlug;
        userData.roleName = role.roleName;
      }
    }

    res.status(200).json({
      isOk: true,
      data: userData
    });
  } catch (err) {
    res.status(500).json({ isOk: false, message: err.message });
  }
};

// Logout User
// Stateless JWT: the client forgets its token; this route only records who
// signed out (when the request still carries a token) in the audit trail.
exports.logoutUser = async (req, res) => {
  try {
    const header = req.headers?.authorization || "";
    const token = header.startsWith("Bearer") ? header.split(" ")[1] : req.cookies?.accessToken;
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const account = (await User.findById(decoded.id).select("name username roleType").lean()) || (await Operator.findById(decoded.id).select("employeeName username roleId").populate("roleId", "roleName").lean());
      if (account) {
        const isUser = !!account.roleType;
        await recordAudit({
          req,
          entityType: "auth",
          entity: account._id,
          label: account.username || "",
          action: "logout",
          actor: { id: account._id, model: isUser ? "User" : "Operator", name: account.employeeName || account.name || account.username || "", role: isUser ? "Super Admin" : account.roleId?.roleName || "" },
        });
      }
    }
  } catch (e) {
    // An expired or bad token still signs out — there is just nobody to name.
  }
  res.status(200).json({ isOk: true, message: 'Logged out successfully' });
};

// ── Impersonate / "Access Panel" ─────────────────────────────────────────
// Lets a SuperAdmin, or an Operator who sits ABOVE the target
// in the hierarchy canvas, log in as that team member without a password —
// used by the "Access Panel" button on the Access Panel page.
exports.impersonateEmployee = async (req, res) => {
  try {
    const { employeeId } = req.params;

    const target = await Operator.findOne({ _id: employeeId }).populate(
      "roleId",
      "roleName roleSlug"
    );
    if (!target) {
      return res.status(404).json({ isOk: false, message: "Employee not found" });
    }

    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ isOk: false, message: "You're already viewing your own panel." });
    }

    // A deleted (deactivated) employee can't log in, so their panel can't be
    // opened either — the token would only be turned away on the next request.
    if (target.isActive === false) {
      return res.status(400).json({ isOk: false, message: `${target.employeeName} has been deleted, so their panel can't be opened.` });
    }

    const isAdmin = req.user.roleType === "SuperAdmin";

    if (!isAdmin) {
      // Requester is an Operator — only allowed if the target reports to
      // them, directly or through a chain of managers.
      const visibleIds = await getVisibleEmployeeIds(req.user.id);
      const isVisible = visibleIds.has(target._id.toString());
      if (!isVisible) {
        return res.status(403).json({ isOk: false, message: "Not authorized to access this panel." });
      }
    }

    const token = signToken(target._id);
    const roleSlug = target.roleId?.roleSlug || null;
    await recordAudit({ req, entityType: "operator", entity: target._id, label: target.employeeName || "", action: "impersonate", remark: `Opened ${target.employeeName}'s panel (Access Panel)` });
    // Without this, the frontend had no redirectUrl to send the browser
    // to, and fell back to "/" (the public marketing page) — which is
    // why "Access Panel" looked like it silently did nothing / bounced
    // back to the admin's own dashboard.
    const redirectUrl = await getDefaultRedirectUrl("Operator", roleSlug, target.roleId?._id);

    res.status(200).json({
      isOk: true,
      token,
      redirectUrl,
      data: {
        _id: target._id,
        employeeName: target.employeeName,
        emailOffice: target.emailOffice,
        roleType: "Operator",
        roleId: target.roleId,
        roleSlug,
      },
      message: `Now viewing ${target.employeeName}'s panel`,
    });
  } catch (error) {
    console.error("Error impersonating employee:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// Verify Session
exports.verifySession = (req, res) => {
  if (req.user) {
    res.status(200).json({
      isOk: true,
      data: { role: req.user.roleType || 'Operator' }
    });
  } else {
    res.status(401).json({ isOk: false, message: 'Invalid session' });
  }
};
