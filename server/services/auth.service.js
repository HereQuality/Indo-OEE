/**
 * services/auth.service.js — Auth Business Logic (Placeholder)
 *
 * Separates JWT token generation and cookie-setting from controllers.
 * Will be fully implemented with the auth flow.
 */

const jwt = require("jsonwebtoken");

/**
 * Generate access + refresh tokens for a user
 */
const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { id: userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN}
  );

  const refreshToken = jwt.sign(
    { id: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN}
  );

  return { accessToken, refreshToken };
};

/**
 * Set JWT tokens as secure HTTP-only cookies
 */
const setTokenCookies = (res, accessToken, refreshToken) => {
  const isProd = process.env.NODE_ENV === "production";
  const expiresInDays = parseInt(process.env.JWT_COOKIE_EXPIRES_IN) || 7;

  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "strict" : "lax",
  };

  res.cookie("accessToken", accessToken, {
    ...cookieOptions,
    expires: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
  });

  res.cookie("refreshToken", refreshToken, {
    ...cookieOptions,
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    path: "/api/v1/auth/refresh-token", // Only sent to refresh endpoint
  });
};

/**
 * Clear auth cookies on logout
 */
const clearTokenCookies = (res) => {
  res.cookie("accessToken", "", { httpOnly: true, expires: new Date(0) });
  res.cookie("refreshToken", "", { httpOnly: true, expires: new Date(0) });
};

module.exports = { generateTokens, setTokenCookies, clearTokenCookies };
