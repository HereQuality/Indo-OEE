const Operator = require("../models/Operator");
const jwt = require("jsonwebtoken");
const { getDefaultRedirectUrl } = require("./auth.controller");

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
    if (typeof departmentIds === 'string') {
      try { departmentIds = JSON.parse(departmentIds); } catch (e) { departmentIds = [departmentIds]; }
    }
    if (typeof teamIds === 'string') {
      try { teamIds = JSON.parse(teamIds); } catch (e) { teamIds = [teamIds]; }
    }
    if (typeof skills === 'string') {
      try { skills = JSON.parse(skills); } catch (e) { skills = [skills]; }
    }

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

    res.status(201).json({
      isOk: true,
      data: newEmployee,
      message: "Operator created successfully"
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

    const updateData = { ...req.body };
    delete updateData.password;
    if (updateData.isBlocked !== undefined) {
      updateData.isBlocked = updateData.isBlocked;
    }

    // Parse array fields if they come as JSON strings from FormData
    if (typeof updateData.departmentIds === 'string') {
      try { updateData.departmentIds = JSON.parse(updateData.departmentIds); } catch (e) { updateData.departmentIds = [updateData.departmentIds]; }
    }
    if (typeof updateData.teamIds === 'string') {
      try { updateData.teamIds = JSON.parse(updateData.teamIds); } catch (e) { updateData.teamIds = [updateData.teamIds]; }
    }
    if (typeof updateData.skills === 'string') {
      try { updateData.skills = JSON.parse(updateData.skills); } catch (e) { updateData.skills = [updateData.skills]; }
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
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    res.status(200).json({
      isOk: true,
      data: employee,
      message: "Operator updated successfully"
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
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    if (employee.isActive) {
      // Soft Delete
      employee.isActive = false;
      await employee.save({ validateBeforeSave: false });
      return res.status(200).json({
        isOk: true,
        message: "Operator deactivated successfully"
      });
    } else {
      // Hard Delete
      await Operator.findByIdAndDelete(employeeId);
      return res.status(200).json({
        isOk: true,
        message: "Operator deleted successfully"
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
      return res.status(404).json({ isOk: false, message: "Operator not found" });
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
      // Build base text-match conditions
      const baseOr = [
        { employeeName: { $regex: match, $options: "i" } },
        { emailOffice:  { $regex: match, $options: "i" } },
        { username:     { $regex: match, $options: "i" } },
        { firstName:    { $regex: match, $options: "i" } },
        { lastName:     { $regex: match, $options: "i" } },
      ];

      // Also search by department name
      const matchingDepts = await Department.find(
        { departmentName: { $regex: match, $options: "i" } },
        { _id: 1 }
      ).lean();
      if (matchingDepts.length > 0) {
        baseOr.push({ departmentIds: { $in: matchingDepts.map(d => d._id) } });
      }

      // Also search by team name
      const matchingTeams = await Team.find(
        { teamName: { $regex: match, $options: "i" } },
        { _id: 1 }
      ).lean();
      if (matchingTeams.length > 0) {
        baseOr.push({ teamIds: { $in: matchingTeams.map(t => t._id) } });
      }

      // Also search by role name
      const matchingRoles = await RoleMaster.find(
        { roleName: { $regex: match, $options: "i" } },
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
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    employee.password = password; // Will be hashed by pre-save hook
    await employee.save();

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
    }).select('+password');

    if (!employee) {
      return res.status(401).json({ isOk: false, message: 'Incorrect username or password' });
    }

    if (employee.isBlocked) {
      return res.status(403).json({ isOk: false, message: 'Account blocked by admin', isBlocked: true });
    }

    if (employee.isLocked) {
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

      return res.status(401).json({ isOk: false, message: responseMessage });
    }

    // Success
    employee.loginAttempts = 0;
    employee.lockUntil = undefined;
    employee.lastLogin = Date.now();
    await employee.save({ validateBeforeSave: false });

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
exports.logoutUser = (req, res) => {
  // Since we use stateless JWT, logout is handled on client side by clearing token.
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
      return res.status(404).json({ isOk: false, message: "Operator not found" });
    }

    if (String(target._id) === String(req.user._id)) {
      return res.status(400).json({ isOk: false, message: "You're already viewing your own panel." });
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
