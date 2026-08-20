/**
 * Roles API Service
 * Handles all role-related API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Create a new role
 * @param {Object} data - Role data
 * @returns {Promise}
 */
export const createRole = async (data) => {
    return api.post(ENDPOINTS.ROLES.BASE, data);
};

/**
 * Get all roles
 * @returns {Promise}
 */
export const getAllRoles = async () => {
    return api.get(ENDPOINTS.ROLES.BASE);
};

/**
 * Get role by ID
 * @param {string} id - Role ID
 * @returns {Promise}
 */
export const getRoleById = async (id) => {
    return api.get(ENDPOINTS.ROLES.BY_ID(id));
};

/**
 * Update role
 * @param {string} id - Role ID
 * @param {Object} data - Updated role data
 * @returns {Promise}
 */
export const updateRole = async (id, data) => {
    return api.put(ENDPOINTS.ROLES.BY_ID(id), data);
};

/**
 * Delete role
 * @param {string} id - Role ID
 * @returns {Promise}
 */
export const deleteRole = async (id) => {
    return api.delete(ENDPOINTS.ROLES.BY_ID(id));
};

/**
 * Search roles with filters
 * @param {Object} params - Search parameters
 * @returns {Promise}
 */
export const searchRoles = async (params) => {
    return api.post(ENDPOINTS.ROLES.SEARCH, params);
};

export default {
    createRole,
    getAllRoles,
    getRoleById,
    updateRole,
    deleteRole,
    searchRoles,
};
