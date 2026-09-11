const User = require('../models/user.model');
const Operator = require('../models/Operator');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const OperatorRoles = require('../models/OperatorRoles');
const MenuGroupMaster = require('../models/MenuGroupMaster');
const MenuMaster = require('../models/MenuMaster');

// Helpers
const MAX_LOGIN_ATTEMPTS = 3;
const LOCK_TIME = 2 * 60 * 1000; // 2 minutes

const signToken = (id, roleType, remember) => {
  return jwt.sign({ id, roleType }, process.env.JWT_SECRET, {
    expiresIn: remember ? '30d' : '1d'
  });
};

// Works out where this account should land after login, based on role.
// - SuperAdmin -> the /hqepl admin section
// - Operator -> their own custom role slug (set in Operator Management > Manage Role)
// Strips the leading path segment (e.g. "/manager/dashboard" -> "/dashboard")
// so a stored menu URL can be re-prefixed with the operator's own roleSlug.
const stripFirstSegment = (path) => path.replace(/^\/[^/]+/, '');

// Works out where this account should land after login, based on role.
// - SuperAdmin -> the /hqepl admin section (always full access)
// - Operator -> only Dashboard if their role was granted it; otherwise the
//   first menu item their role actually has "read" access to; otherwise
//   a safe fallback with no accessible pages.
const getDefaultRedirectUrl = async (roleType, roleSlug, roleId) => {
  const slug = roleSlug || "operator";
  return `/${slug}/home`;
};

const sendToken = async (user, roleType, statusCode, res, remember) => {
  const token = signToken(user._id, roleType, remember);

  // Remove password from output
  user.password = undefined;

  let userData = user.toObject ? user.toObject() : user;
  userData.roleType = roleType;

  // Operators route under their role's slug (e.g. "manager" -> /manager/...).
  // Attach it here so the client can redirect straight to the right URL
  // after login without an extra round trip.
  if (roleType === 'Operator' && userData.roleId) {
    const RoleMaster = require('../models/RoleMaster');
    const role = await RoleMaster.findById(userData.roleId).select('roleSlug roleName').lean();
    if (role) {
      userData.roleSlug = role.roleSlug;
      userData.roleName = role.roleName;
    }
  }

  const redirectUrl = await getDefaultRedirectUrl(roleType, userData.roleSlug, userData.roleId);

  res.status(statusCode).json({
    status: 'success',
    token,
    redirectUrl,
    data: {
      user: userData
    }
  });
};

// ── Login ─────────────────────────────────────────────────────────────
// Single login endpoint used by both SuperAdmin and Operators.
// We look the email up in the User collection first (SuperAdmin);
// if no match exists there, we fall back to the Operator collection
// (matched against emailOffice). Whichever account is found is the one
// that gets the lock/attempt checks and password comparison applied.
exports.getDefaultRedirectUrl = getDefaultRedirectUrl;

exports.login = async (req, res) => {
  try {
    const { username, email, password, remember } = req.body;
    const loginId = username || email; // accept either for migration

    // 1. Check if identifier and password exist
    if (!loginId || !password) {
      return res.status(400).json({ status: 'fail', message: 'Please provide username and password' });
    }

    // 2. Look up the account: User first (by username OR email), then Operator (by username OR emailOffice)
    let account = await User.findOne({
      $or: [{ username: loginId.toLowerCase() }, { email: loginId.toLowerCase() }]
    }).select('+password');
    let roleType = account ? account.roleType : null;

    if (!account) {
      account = await Operator.findOne({
        $or: [{ username: loginId.toLowerCase() }, { emailOffice: loginId.toLowerCase() }]
      })
      .populate('departmentIds', 'departmentName')
      .populate('roleId', 'roleName')
      .select('+password');
      roleType = 'Operator';
    }

    if (!account) {
      return res.status(401).json({ status: 'fail', message: 'Incorrect username or password' });
    }

    // 3. Check if account is blocked
    if (account.isBlocked) {
      return res.status(403).json({
        status: 'fail',
        message: 'Your account has been blocked.'
      });
    }

    // 4. Check if account is locked
    if (account.isLocked) {
      const remainingMs = account.lockUntil - Date.now();
      const remainingTime = Math.ceil(remainingMs / 60000);
      return res.status(423).json({ 
        status: 'fail', 
        message: `Account is locked. Try again in ${remainingTime} minute(s).`,
        remainingTime,
        remainingTimeMs: remainingMs,
      });
    }

    // 4. Verify password
    const isMatch = await account.comparePassword(password);

    if (!isMatch) {
      // Increment login attempts
      account.loginAttempts += 1;
      let responseMessage = 'Incorrect username or password';
      let remainingAttempts = MAX_LOGIN_ATTEMPTS - account.loginAttempts;

      if (account.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
        account.lockUntil = Date.now() + LOCK_TIME;
        account.loginAttempts = 0; // Reset for next time after lock expires
        responseMessage = 'Account locked due to too many failed attempts.';
        remainingAttempts = 0;
      }

      await account.save({ validateBeforeSave: false });

      return res.status(401).json({ 
        status: 'fail', 
        message: responseMessage,
        attemptsRemaining: remainingAttempts
      });
    }

    // 5. Success! Reset attempts and send token
    account.loginAttempts = 0;
    account.lockUntil = undefined;
    account.lastLogin = Date.now();
    await account.save({ validateBeforeSave: false });

    await sendToken(account, roleType, 200, res, remember);

  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// ── Check username availability ───────────────────────────────────────
exports.checkUsername = async (req, res) => {
  try {
    const { username } = req.query;
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ status: 'fail', message: 'Username too short' });
    }
    const normalised = username.toLowerCase().trim();
    const userTaken   = await User.findOne({ username: normalised }).lean();
    const empTaken    = await Operator.findOne({ username: normalised }).lean();
    return res.status(200).json({ status: 'success', available: !userTaken && !empTaken });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

// ── OTP Functions (Mocked for now) ────────────────────────────────────
exports.sendOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      // Return 200 anyway for security (don't leak registered emails)
      return res.status(200).json({ status: 'success', message: 'If email exists, OTP sent.' });
    }

    // Generate random 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Hash it for DB
    user.resetPasswordOtp = crypto.createHash('sha256').update(otp).digest('hex');
    user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save({ validateBeforeSave: false });

    // TODO: Send Email via Nodemailer
    console.log(`[MOCK EMAIL] OTP for ${email} is ${otp}`);

    res.status(200).json({ status: 'success', message: 'OTP sent successfully (check server logs for mock OTP).' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ status: 'fail', message: 'User not found' });

    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    if (user.resetPasswordOtp !== hashedOtp || user.otpExpires < Date.now()) {
      return res.status(400).json({ status: 'fail', message: 'OTP is invalid or has expired' });
    }

    // OTP verified, return temporary token for password reset step
    res.status(200).json({ status: 'success', message: 'OTP verified.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (!user) return res.status(400).json({ status: 'fail', message: 'User not found' });

    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

    if (user.resetPasswordOtp !== hashedOtp || user.otpExpires < Date.now()) {
      return res.status(400).json({ status: 'fail', message: 'OTP is invalid or has expired' });
    }

    user.password = newPassword;
    user.resetPasswordOtp = undefined;
    user.otpExpires = undefined;
    user.loginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();

    res.status(200).json({ status: 'success', message: 'Password reset successfully.' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};

exports.getLoginStatus = async (req, res) => {
  try {
    const { email, username } = req.body;
    const loginId = username || email;
    if (!loginId) return res.status(400).json({ status: 'fail', message: 'Username or email required' });

    const normalised = loginId.toLowerCase().trim();
    let account = await User.findOne({ $or: [{ username: normalised }, { email: normalised }] });
    if (!account) {
      account = await Operator.findOne({ $or: [{ username: normalised }, { emailOffice: normalised }] });
    }

    if (!account) {
      // Return default values so we don't leak account existence
      return res.status(200).json({
        status: 'success',
        data: { attemptsRemaining: MAX_LOGIN_ATTEMPTS, lockedUntil: null, remainingTimeMs: 0 }
      });
    }

    const isLocked = account.lockUntil && account.lockUntil > Date.now();
    const remainingTimeMs = isLocked ? account.lockUntil - Date.now() : 0;
    const attemptsRemaining = MAX_LOGIN_ATTEMPTS - (account.loginAttempts || 0);

    res.status(200).json({
      status: 'success',
      data: {
        attemptsRemaining: attemptsRemaining > 0 ? attemptsRemaining : 0,
        lockedUntil: account.lockUntil || null,
        remainingTimeMs: remainingTimeMs > 0 ? remainingTimeMs : 0
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
};