/**
 * API Endpoint Constants
 * All API endpoints defined in one place for easy maintenance
 */

// API Version prefix
const V1 = "/api/v1";

export const ENDPOINTS = {
    // Auth endpoints
    AUTH: {
        LOGIN: `${V1}/auth/login`,
        EMPLOYEE_LOGIN: `${V1}/auth/employee-login`,
        ME: `${V1}/auth/me`,
        UPDATE_PROFILE: `${V1}/auth/me`,
        UPDATE_PREFERENCES: `${V1}/auth/me/preferences`,
        CHANGE_PASSWORD: `${V1}/auth/me/password`,
        LOGOUT: `${V1}/auth/logout`,
        OTP_SEND: `${V1}/auth/send-otp`,
        OTP_VERIFY: `${V1}/auth/verify-otp`,
        PASSWORD_RESET: `${V1}/auth/reset-password`,
        LOGIN_STATUS_BY_EMAIL: `${V1}/auth/login-status`,
        LOGIN_STATUS: (userId) => `${V1}/auth/login-status/${userId}`,
        VERIFY_SESSION: `${V1}/auth/verify-session`,
        CHECK_USERNAME: `${V1}/auth/check-username`,
    },

    // Companies endpoints
    COMPANIES: {
        ME: `${V1}/companies/getCompanyDetails`,
        BASE: `${V1}/companies`,
        BY_ID: (id) => `${V1}/companies/${id}`,
        SEARCH: `${V1}/companies/search`,
    },
    // Department endpoints
    DEPARTMENTS: {
        BASE: `${V1}/departments`,
        BY_ID: (id) => `${V1}/departments/${id}`,
        SEARCH: `${V1}/departments/search`,
    },

    // Machine (M/C) master endpoints
    MACHINES: {
        BASE: `${V1}/machines`,
        BY_ID: (id) => `${V1}/machines/${id}`,
        SEARCH: `${V1}/machines/search`,
    },

    // Process master endpoints
    PROCESSES: {
        BASE: `${V1}/processes`,
        BY_ID: (id) => `${V1}/processes/${id}`,
        SEARCH: `${V1}/processes/search`,
    },

    // OEE report endpoints
    REPORTS: {
        OEE: `${V1}/reports/oee`,
        OEE_DASHBOARD: `${V1}/reports/oee/dashboard`,
        OEE_TREND: `${V1}/reports/oee/trend`,
        OEE_CARD: `${V1}/reports/oee/card`,
    },

    // Production Data Entry endpoints
    PRODUCTION_ENTRIES: {
        BASE: `${V1}/production-entries`,
        BY_ID: (id) => `${V1}/production-entries/${id}`,
        EFFICIENCY: `${V1}/production-entries/efficiency`,
        EFFICIENCY_PDF: `${V1}/production-entries/efficiency/pdf`,
        SHIFT_TIME_REPORT: `${V1}/production-entries/shift-time-report`,
    },

    // Shift Master endpoints
    SHIFTS: {
        BASE: `${V1}/shifts`,
        BY_ID: (id) => `${V1}/shifts/${id}`,
        SEARCH: `${V1}/shifts/search`,
    },

    // Operator Master endpoints
    OPERATORS: {
        BASE: `${V1}/operators`,
        BY_ID: (id) => `${V1}/operators/${id}`,
        SEARCH: `${V1}/operators/search`,
    },

    // Standard Time Master endpoints
    STANDARD_TIMES: {
        BASE: `${V1}/standard-times`,
        BY_ID: (id) => `${V1}/standard-times/${id}`,
        SEARCH: `${V1}/standard-times/search`,
    },

    // Employee endpoints
    EMPLOYEES: {
        BASE: `${V1}/employees`,
        BY_ID: (id) => `${V1}/employees/${id}`,
        SEARCH: `${V1}/employees/search`,
        TEAM_MEMBERS: `${V1}/employees/team-members/list`,
        RESET_PASSWORD: (id) => `${V1}/employees/${id}/reset-password`,
        IMPERSONATE: (id) => `${V1}/employees/${id}/impersonate`,
    },

    // Role endpoints
    ROLES: {
        BASE: `${V1}/roles`,
        BY_ID: (id) => `${V1}/roles/${id}`,
        SEARCH: `${V1}/roles/search`,
    },

    // Employee Role endpoints
    EMPLOYEE_ROLES: {
        BASE: `${V1}/employee-roles`,
        BY_ID: (id) => `${V1}/employee-roles/${id}`,
    },

    // Menus
    MENUS: {
        BASE: `${V1}/menus`,
        BY_ID: (id) => `${V1}/menus/${id}`,
        SEARCH: `${V1}/menus/search`,
        BY_GROUPS: `${V1}/menus/by-groups`,
    },

    // Menu Groups
    MENU_GROUPS: {
        BASE: `${V1}/menu-groups`,
        BY_ID: (id) => `${V1}/menu-groups/${id}`,
        SEARCH: `${V1}/menu-groups/search`,
    },
};

export default ENDPOINTS;
