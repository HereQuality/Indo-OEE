const User = require("../models/user.model");
const Operator = require("../models/Operator");
const { addProfileTask } = require('../queues/profileQueue');

// Both User (SuperAdmin) and Operator documents are handled here, keyed off
// req.user.roleType — there's only one "Edit Profile" page on the client,
// shared by every role, same as everything else in this app.
const getModel = (roleType) => (roleType === "SuperAdmin" ? User : Operator);

// ── Update your own profile (name + contact details) ────────────────────
// Deliberately does NOT touch password, email/emailOffice, department, or
// role — those are either handled by a separate endpoint (password) or are
// not something a person should be able to silently change on themselves
// (their own login email, their own department/role).
exports.updateOwnProfile = async (req, res) => {
  try {
    const Model = getModel(req.user.roleType);
    const existingUser = await Model.findById(req.user._id).lean();
    if (!existingUser) {
      return res.status(404).json({ isOk: false, message: "Account not found" });
    }

    const updates = {};

    if (req.user.roleType === "SuperAdmin") {
      if (req.body.name     !== undefined) updates.name     = req.body.name;
      if (req.body.username !== undefined) {
        const u = req.body.username.toLowerCase().trim();
        if (u.length < 3) return res.status(400).json({ isOk: false, message: "Username must be at least 3 characters." });
        // Check uniqueness across both collections, excluding self
        const conflict = await Model.findOne({ username: u, _id: { $ne: req.user._id } }).lean();
        if (conflict) return res.status(400).json({ isOk: false, message: "Username already taken." });
        updates.username = u;
      }
    } else {
      // Operator
      if (req.body.firstName    !== undefined) updates.firstName    = req.body.firstName;
      if (req.body.lastName     !== undefined) updates.lastName     = req.body.lastName;
      // Auto-sync employeeName from first+last if both provided
      if (req.body.firstName !== undefined || req.body.lastName !== undefined) {
        const existing = await Model.findById(req.user._id).lean();
        const fn = req.body.firstName ?? existing?.firstName ?? '';
        const ln = req.body.lastName  ?? existing?.lastName  ?? '';
        if (fn || ln) updates.employeeName = [fn, ln].filter(Boolean).join(' ');
      }
      if (req.body.employeeName !== undefined && !updates.employeeName) updates.employeeName = req.body.employeeName;
      if (req.body.mobileNumber !== undefined) updates.mobileNumber = req.body.mobileNumber;
      if (req.body.address      !== undefined) updates.address      = req.body.address;
      if (req.body.city         !== undefined) updates.city         = req.body.city;
      if (req.body.state        !== undefined) updates.state        = req.body.state;
      if (req.body.country      !== undefined) updates.country      = req.body.country;
      if (req.body.emailOffice  !== undefined) updates.emailOffice  = req.body.emailOffice || undefined;
      if (req.body.username     !== undefined) {
        const u = req.body.username.toLowerCase().trim();
        if (u.length < 3) return res.status(400).json({ isOk: false, message: "Username must be at least 3 characters." });
        // Check uniqueness across both collections, excluding self
        const conflictEmp  = await Operator.findOne({ username: u, _id: { $ne: req.user._id } }).lean();
        const conflictUser = await User.findOne({ username: u }).lean();
        if (conflictEmp || conflictUser) return res.status(400).json({ isOk: false, message: "Username already taken." });
        updates.username = u;
      }
    }

    // Handle Profile Picture
    if (req.file) {
      updates.profilePic = req.file.path;
      // Delete old profile pic file if it exists, asynchronously via BullMQ
      if (existingUser.profilePic) {
        addProfileTask('delete-old-profile-pic', { url: existingUser.profilePic });
      }
    } else if (req.body.removeProfilePic === 'true' || req.body.removeProfilePic === true) {
      updates.profilePic = null;
      if (existingUser.profilePic) {
        addProfileTask('delete-old-profile-pic', { url: existingUser.profilePic });
      }
    }

    const updated = await Model.findByIdAndUpdate(req.user._id, updates, {
      new: true,
      runValidators: true,
    });

    if (!updated) {
      return res.status(404).json({ isOk: false, message: "Account not found" });
    }

    let updatedData = updated;
    if (req.user.roleType === "Operator") {
      updatedData = await Operator.findById(updated._id)
        .populate('departmentIds', 'departmentName')
        .select("-password")
        .lean();

      if (updatedData.roleId) {
        const RoleMaster = require("../models/RoleMaster");
        const role = await RoleMaster.findById(updatedData.roleId).select("roleSlug roleName roleCode");
        if (role) {
          updatedData.roleSlug = role.roleSlug;
          updatedData.roleName = role.roleName;
        }
      }
      updatedData.roleType = req.user.roleType;
    }

    res.status(200).json({
      isOk: true,
      data: updatedData,
      message: "Profile updated successfully",
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};


// ── Change your own password ─────────────────────────────────────────────
exports.changeOwnPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ isOk: false, message: "Current and new password are both required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ isOk: false, message: "New password must be at least 8 characters." });
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ isOk: false, message: "Password must contain at least one uppercase letter, one lowercase letter, and one number." });
    }

    const Model = getModel(req.user.roleType);
    const account = await Model.findById(req.user._id).select("+password");
    if (!account) {
      return res.status(404).json({ isOk: false, message: "Account not found" });
    }

    const isMatch = await account.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ isOk: false, message: "Current password is incorrect." });
    }

    account.password = newPassword; // pre-save hook re-hashes this
    await account.save();

    res.status(200).json({ isOk: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};

// ── Update your own preferences ──────────────────────────────────────────
exports.updateOwnPreferences = async (req, res) => {
  try {
    const Model = getModel(req.user.roleType);
    
    // We only want to update the fields inside preferences that were provided
    // Instead of completely overwriting preferences, we'll merge them.
    const account = await Model.findById(req.user._id);
    if (!account) {
      return res.status(404).json({ isOk: false, message: "Account not found" });
    }

    const currentPrefs = account.preferences || {};
    
    // Allow updating specific preference keys
    if (req.body.themeMode !== undefined) {
      currentPrefs.themeMode = req.body.themeMode;
    }
    if (req.body.showDashboardClock !== undefined) {
      currentPrefs.showDashboardClock = req.body.showDashboardClock;
    }
    if (req.body.shortcuts !== undefined) {
      currentPrefs.shortcuts = req.body.shortcuts;
    }

    account.preferences = currentPrefs;
    await account.save();

    res.status(200).json({
      isOk: true,
      data: account.preferences,
      message: "Preferences updated successfully",
    });
  } catch (error) {
    console.error("Error updating preferences:", error);
    res.status(500).json({ isOk: false, message: error.message });
  }
};
