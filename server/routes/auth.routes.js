const express = require('express');
const authController = require('../controllers/auth.controller');
const operatorController = require('../controllers/operator.controller');
const profileController = require('../controllers/profile.controller');
const { protect } = require('../middlewares/auth.middleware');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimit.middleware');
const { uploadProfilePic } = require('../middlewares/upload.middleware');
const { rewriteUploadPaths } = require('../utils/fileUrl');

const router = express.Router();

// General User Auth
router.post('/login', loginLimiter, authController.login);
router.post('/send-otp', otpLimiter, authController.sendOtp);
router.post('/verify-otp', otpLimiter, authController.verifyOtp);
router.post('/reset-password', loginLimiter, authController.resetPassword);
router.post('/login-status', authController.getLoginStatus);
router.get('/check-username', authController.checkUsername); // public — no auth needed

// Operator Auth
router.post('/employee/login', loginLimiter, operatorController.loginEmployee);
router.get('/me', protect, operatorController.getCurrentUser);
router.put('/me', protect, uploadProfilePic.single('profilePic'), rewriteUploadPaths, profileController.updateOwnProfile);
router.put('/me/preferences', protect, profileController.updateOwnPreferences);
router.put('/me/password', protect, profileController.changeOwnPassword);
router.post('/logout', operatorController.logoutUser);
router.get('/verify-session', protect, operatorController.verifySession);

module.exports = router;
