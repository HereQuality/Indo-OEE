/**
 * Operator Roles API Service
 * Handles all operator role permissions API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Create operator roles (permissions for a role)
 * @param {Object} data - Operator roles data
 * @returns {Promise}
 */
export const createOperatorRoles = async (data) => {
    return api.post(ENDPOINTS.OPERATOR_ROLES.BASE, data);
};

/**
 * Get operator roles by role ID
 * @param {string} roleId - Role ID
 * @returns {Promise}
 */
export const getOperatorRolesByRoleId = async (roleId) => {
    return api.get(ENDPOINTS.OPERATOR_ROLES.BY_ID(roleId));
};

/**
 * Update operator roles
 * @param {string} roleId - Role ID
 * @param {Object} data - Updated operator roles data
 * @returns {Promise}
 */
export const updateOperatorRoles = async (roleId, data) => {
    return api.put(ENDPOINTS.OPERATOR_ROLES.BY_ID(roleId), data);
};

export default {
    createOperatorRoles,
    getOperatorRolesByRoleId,
    updateOperatorRoles,
};
