/**
 * Employee Roles API Service
 * Handles all employee role permissions API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Create employee roles (permissions for a role)
 * @param {Object} data - Employee roles data
 * @returns {Promise}
 */
export const createEmployeeRoles = async (data) => {
    return api.post(ENDPOINTS.EMPLOYEE_ROLES.BASE, data);
};

/**
 * Get employee roles by role ID
 * @param {string} roleId - Role ID
 * @returns {Promise}
 */
export const getEmployeeRolesByRoleId = async (roleId) => {
    return api.get(ENDPOINTS.EMPLOYEE_ROLES.BY_ID(roleId));
};

/**
 * Update employee roles
 * @param {string} roleId - Role ID
 * @param {Object} data - Updated employee roles data
 * @returns {Promise}
 */
export const updateEmployeeRoles = async (roleId, data) => {
    return api.put(ENDPOINTS.EMPLOYEE_ROLES.BY_ID(roleId), data);
};

export default {
    createEmployeeRoles,
    getEmployeeRolesByRoleId,
    updateEmployeeRoles,
};
