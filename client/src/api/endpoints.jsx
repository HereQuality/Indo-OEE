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
    // Maintenance mode endpoints
    MAINTENANCE: {
        STATUS: `${V1}/maintenance/status`,
        BASE: `${V1}/maintenance`,
    },

    // Announcement mode endpoints
    ANNOUNCEMENT: {
        STATUS: `${V1}/announcement/status`,
        BASE: `${V1}/announcement`,
    },

    // Department endpoints
    DEPARTMENTS: {
        BASE: `${V1}/departments`,
        BY_ID: (id) => `${V1}/departments/${id}`,
        SEARCH: `${V1}/departments/search`,
    },

    // Company Holidays + Weekly Off (Operator Management > Company Holidays)
    COMPANY_HOLIDAYS: {
        BASE: `${V1}/company-holidays`,
        BY_ID: (id) => `${V1}/company-holidays/${id}`,
        WEEKLY_OFF: `${V1}/company-holidays/weekly-off`,
        WEEKLY_OFF_UPDATE: `${V1}/company-holidays/weekly-off/update`,
    },

    // Machine master endpoints (Production > Machines)
    MACHINES: {
        BASE: `${V1}/machines`,
        BY_ID: (id) => `${V1}/machines/${id}`,
        SEARCH: `${V1}/machines/search`,
    },

    // Process master endpoints (Production > Processes) + dashboard data
    PROCESSES: {
        BASE: `${V1}/processes`,
        BY_ID: (id) => `${V1}/processes/${id}`,
        SEARCH: `${V1}/processes/search`,
        ENTRIES: `${V1}/processes/entries`,
        SHIFT_ACCESS: `${V1}/processes/shift-access`,
    },

    // Item master endpoints (Production > Items)
    ITEMS: {
        BASE: `${V1}/items`,
        BY_ID: (id) => `${V1}/items/${id}`,
        SEARCH: `${V1}/items/search`,
        // Edit history: every part's, or one part's
        LOGS: `${V1}/items/logs`,
        LOGS_BY_ID: (id) => `${V1}/items/${id}/logs`,
    },

    // Work Order master endpoints (Production > Work Orders)
    WORK_ORDERS: {
        BASE: `${V1}/work-orders`,
        BY_ID: (id) => `${V1}/work-orders/${id}`,
        SEARCH: `${V1}/work-orders/search`,
        PROGRESS: `${V1}/work-orders/progress`,
    },

    MACHINE_OPERATORS: {
        BASE: `${V1}/machine-operators`,
        BY_ID: (id) => `${V1}/machine-operators/${id}`,
        SEARCH: `${V1}/machine-operators/search`,
    },

    // Vendor master (Production > Vendors) — the After Powder Coating sheet's Vendor box
    VENDORS: {
        BASE: `${V1}/vendors`,
        BY_ID: (id) => `${V1}/vendors/${id}`,
        SEARCH: `${V1}/vendors/search`,
    },

    // Production Data Entry sheet endpoints
    PRODUCTION_SHEET: {
        BASE: `${V1}/production-sheet`,
        ROW: `${V1}/production-sheet/row`,
        EXTENT: `${V1}/production-sheet/extent`,
        FILTER_OPTIONS: `${V1}/production-sheet/filter-options`,
        OCCUPIED: `${V1}/production-sheet/occupied`,
        OPERATORS: `${V1}/production-sheet/operators`,
        REJECT_REASONS: `${V1}/production-sheet/reject-reasons`,
    },

    // VMC Data Entry sheet endpoints
    VMC_SHEET: {
        BASE: `${V1}/vmc-sheet`,
        ROW: `${V1}/vmc-sheet/row`,
        EXTENT: `${V1}/vmc-sheet/extent`,
        FILTER_OPTIONS: `${V1}/vmc-sheet/filter-options`,
        OCCUPIED: `${V1}/vmc-sheet/occupied`,
    },
    SPM_SHEET: {
        BASE: `${V1}/spm-sheet`,
        ROW: `${V1}/spm-sheet/row`,
        EXTENT: `${V1}/spm-sheet/extent`,
        FILTER_OPTIONS: `${V1}/spm-sheet/filter-options`,
        OCCUPIED: `${V1}/spm-sheet/occupied`,
    },
    RIVET_SHEET: {
        BASE: `${V1}/rivet-sheet`,
        ROW: `${V1}/rivet-sheet/row`,
        EXTENT: `${V1}/rivet-sheet/extent`,
        FILTER_OPTIONS: `${V1}/rivet-sheet/filter-options`,
        OCCUPIED: `${V1}/rivet-sheet/occupied`,
    },
    PRESS_SHEET: {
        BASE: `${V1}/press-sheet`,
        ROW: `${V1}/press-sheet/row`,
        EXTENT: `${V1}/press-sheet/extent`,
        FILTER_OPTIONS: `${V1}/press-sheet/filter-options`,
        OCCUPIED: `${V1}/press-sheet/occupied`,
    },
    // OEE review (entries over 100%) and the audit log — Admin / Super Admin
    OEE_REVIEW: {
        BASE: `${V1}/oee-review`,
        ACCESS: `${V1}/oee-review/access`,
        LOGS: `${V1}/oee-review/logs`,
        DECIDE: (sheet, id) => `${V1}/oee-review/${sheet}/${id}`,
        REOPEN: (sheet, id) => `${V1}/oee-review/${sheet}/${id}/reopen`,
        SHIFT: (sheet, id) => `${V1}/oee-review/${sheet}/${id}/shift`,
    },
    POWDER_SHEET: {
        BASE: `${V1}/powder-coating-sheet`,
        ROW: `${V1}/powder-coating-sheet/row`,
        EXTENT: `${V1}/powder-coating-sheet/extent`,
        FILTER_OPTIONS: `${V1}/powder-coating-sheet/filter-options`,
        OCCUPIED: `${V1}/powder-coating-sheet/occupied`,
    },
    // BEFORE POWDER COATING — not AFTER POWDER COATING's POWDER_SHEET.
    BPC_SHEET: {
        BASE: `${V1}/bpc-sheet`,
        ROW: `${V1}/bpc-sheet/row`,
        EXTENT: `${V1}/bpc-sheet/extent`,
        FILTER_OPTIONS: `${V1}/bpc-sheet/filter-options`,
        OCCUPIED: `${V1}/bpc-sheet/occupied`,
    },
    // FINAL ASSEMBLY (sheet key "finalAssembly").
    FINAL_ASSEMBLY_SHEET: {
        BASE: `${V1}/final-assembly-sheet`,
        ROW: `${V1}/final-assembly-sheet/row`,
        EXTENT: `${V1}/final-assembly-sheet/extent`,
        FILTER_OPTIONS: `${V1}/final-assembly-sheet/filter-options`,
        OCCUPIED: `${V1}/final-assembly-sheet/occupied`,
    },
    // RAW CASTING — its own sheet, on AFTER POWDER COATING's template.
    RAW_CASTING_SHEET: {
        BASE: `${V1}/raw-casting-sheet`,
        ROW: `${V1}/raw-casting-sheet/row`,
        EXTENT: `${V1}/raw-casting-sheet/extent`,
        FILTER_OPTIONS: `${V1}/raw-casting-sheet/filter-options`,
        OCCUPIED: `${V1}/raw-casting-sheet/occupied`,
    },
    // MODULAR FRAME DRILLING — a machine sheet like INJECTION MOULDING.
    MFD_SHEET: {
        BASE: `${V1}/mfd-sheet`,
        ROW: `${V1}/mfd-sheet/row`,
        EXTENT: `${V1}/mfd-sheet/extent`,
        FILTER_OPTIONS: `${V1}/mfd-sheet/filter-options`,
        OCCUPIED: `${V1}/mfd-sheet/occupied`,
    },
    // MODULAR FRAME ASSEMBLY — a worker sheet on RAW CASTING's template.
    MFA_SHEET: {
        BASE: `${V1}/mfa-sheet`,
        ROW: `${V1}/mfa-sheet/row`,
        EXTENT: `${V1}/mfa-sheet/extent`,
        FILTER_OPTIONS: `${V1}/mfa-sheet/filter-options`,
        OCCUPIED: `${V1}/mfa-sheet/occupied`,
    },
    RUBBER_SHEET: {
        BASE: `${V1}/rubber-sheet`,
        ROW: `${V1}/rubber-sheet/row`,
        EXTENT: `${V1}/rubber-sheet/extent`,
        FILTER_OPTIONS: `${V1}/rubber-sheet/filter-options`,
        OCCUPIED: `${V1}/rubber-sheet/occupied`,
    },
    PRINTING_SHEET: {
        BASE: `${V1}/printing-sheet`,
        ROW: `${V1}/printing-sheet/row`,
        EXTENT: `${V1}/printing-sheet/extent`,
        FILTER_OPTIONS: `${V1}/printing-sheet/filter-options`,
        OCCUPIED: `${V1}/printing-sheet/occupied`,
    },
    INJECTION_SHEET: {
        BASE: `${V1}/injection-sheet`,
        ROW: `${V1}/injection-sheet/row`,
        EXTENT: `${V1}/injection-sheet/extent`,
        FILTER_OPTIONS: `${V1}/injection-sheet/filter-options`,
        OCCUPIED: `${V1}/injection-sheet/occupied`,
    },
    EMBOSSING_SHEET: {
        BASE: `${V1}/embossing-sheet`,
        ROW: `${V1}/embossing-sheet/row`,
        EXTENT: `${V1}/embossing-sheet/extent`,
        FILTER_OPTIONS: `${V1}/embossing-sheet/filter-options`,
        OCCUPIED: `${V1}/embossing-sheet/occupied`,
    },
    SPRING_SHEET: {
        BASE: `${V1}/spring-sheet`,
        ROW: `${V1}/spring-sheet/row`,
        EXTENT: `${V1}/spring-sheet/extent`,
        FILTER_OPTIONS: `${V1}/spring-sheet/filter-options`,
        OCCUPIED: `${V1}/spring-sheet/occupied`,
    },
    TROBE_SHEET: {
        BASE: `${V1}/trobe-sheet`,
        ROW: `${V1}/trobe-sheet/row`,
        EXTENT: `${V1}/trobe-sheet/extent`,
        FILTER_OPTIONS: `${V1}/trobe-sheet/filter-options`,
        OCCUPIED: `${V1}/trobe-sheet/occupied`,
    },
    CONTACT_SHEET: {
        BASE: `${V1}/contact-sheet`,
        ROW: `${V1}/contact-sheet/row`,
        EXTENT: `${V1}/contact-sheet/extent`,
        FILTER_OPTIONS: `${V1}/contact-sheet/filter-options`,
        OCCUPIED: `${V1}/contact-sheet/occupied`,
    },

    // Operator endpoints
    OPERATORS: {
        BASE: `${V1}/operators`,
        BY_ID: (id) => `${V1}/operators/${id}`,
        SEARCH: `${V1}/operators/search`,
        TEAM_MEMBERS: `${V1}/operators/team-members/list`,
        RESET_PASSWORD: (id) => `${V1}/operators/${id}/reset-password`,
        IMPERSONATE: (id) => `${V1}/operators/${id}/impersonate`,
    },

    // Role endpoints
    ROLES: {
        BASE: `${V1}/roles`,
        BY_ID: (id) => `${V1}/roles/${id}`,
        SEARCH: `${V1}/roles/search`,
    },

    // Operator Role endpoints
    OPERATOR_ROLES: {
        BASE: `${V1}/operator-roles`,
        BY_ID: (id) => `${V1}/operator-roles/${id}`,
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
