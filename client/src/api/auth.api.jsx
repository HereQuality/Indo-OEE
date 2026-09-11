/**
 * Auth API Service
 * Handles all authentication-related API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// ── Cookie helpers ────────────────────────────────────────────────────────────

export const setCookie = (name, value, days = 7) => {
    const maxAge = days * 24 * 60 * 60;
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Strict`;
};

export const getCookie = (name) => {
    const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=')[1]) : null;
};

export const removeCookie = (name) => {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Strict`;
};

/**
 * Login — send username (or email for backwards-compat) + password
 * @param {Object} credentials - { username, password }
 * @returns {Promise}
 */
export const login = async (credentials, customHeaders = {}) => {
    return api.post(ENDPOINTS.AUTH.LOGIN, credentials, {
        headers: { ...customHeaders },
        validateStatus: (status) =>
            (status >= 200 && status < 300) || (status >= 400 && status < 500),
    });
};

/**
 * Check whether a username is available (public — no auth needed)
 * @param {string} username
 * @returns {Promise<boolean>} true = available
 */
export const checkUsernameAvailability = async (username) => {
    try {
        const res = await api.get(ENDPOINTS.AUTH.CHECK_USERNAME, {
            params: { username },
            validateStatus: (s) => s >= 200 && s < 500,
        });
        return res.data?.available ?? false;
    } catch {
        return false;
    }
};

/**
 * Send OTP for password reset
 * @param {Object} data - { email }
 */
export const sendOtp = async (data) => {
    return api.post(ENDPOINTS.AUTH.OTP_SEND, data, {
        validateStatus: (status) => status >= 200 && status <= 500,
    });
};

/**
 * Verify OTP
 * @param {Object} data - { email, otp }
 */
export const verifyOtp = async (data) => {
    return api.post(ENDPOINTS.AUTH.OTP_VERIFY, data, {
        validateStatus: (status) => status >= 200 && status <= 500,
    });
};

/**
 * Reset password with OTP
 * @param {Object} data - { email, otp, newPassword }
 */
export const resetPassword = async (data) => {
    return api.post(ENDPOINTS.AUTH.PASSWORD_RESET, data, {
        validateStatus: (status) => status >= 200 && status <= 500,
    });
};

/**
 * Full logout — clears token cookie, localStorage, sessionStorage, then redirects
 */
export const logout = async () => {
    try {
        await api.post(ENDPOINTS.AUTH.LOGOUT);
    } catch (error) {
        console.error("Logout API error:", error);
    } finally {
        // Clear token cookie
        removeCookie('token');
        removeCookie('role');
        // Clear storage
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = "/";
    }
};

export const getLoginStatusByEmail = async (identifier) => {
    return api.post(ENDPOINTS.AUTH.LOGIN_STATUS_BY_EMAIL, { username: identifier }, {
        validateStatus: (status) => status >= 200 && status <= 500,
    });
};

/**
 * Update your own profile
 */
export const updateProfile = async (updates) => {
    let headers = {};
    if (updates instanceof FormData) {
        headers['Content-Type'] = 'multipart/form-data';
    }
    return api.put(ENDPOINTS.AUTH.UPDATE_PROFILE, updates, { headers });
};

/**
 * Update your own preferences
 */
export const updatePreferences = async (preferences) => {
    return api.put(ENDPOINTS.AUTH.UPDATE_PREFERENCES, preferences);
};

/**
 * Change your own password
 */
export const changePassword = async (payload) => {
    return api.put(ENDPOINTS.AUTH.CHANGE_PASSWORD, payload);
};

/**
 * Get current user
 */
export const getCurrentUser = async () => {
    return api.get(ENDPOINTS.AUTH.ME);
};

export default {
    login,
    sendOtp,
    verifyOtp,
    resetPassword,
    updateProfile,
    updatePreferences,
    changePassword,
    logout,
    getLoginStatusByEmail,
    getCurrentUser,
    checkUsernameAvailability,
    setCookie,
    getCookie,
    removeCookie,
};
