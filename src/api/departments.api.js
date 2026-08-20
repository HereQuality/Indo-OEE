/**
 * Departments API Service
 * Handles all department-related API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Create a new department
 * @param {Object} data - Department data
 * @returns {Promise}
 */
export const createDepartment = async (data) => {
    return api.post(ENDPOINTS.DEPARTMENTS.BASE, data);
};

/**
 * Get all departments
 * @returns {Promise}
 */
export const getAllDepartments = async () => {
    return api.get(ENDPOINTS.DEPARTMENTS.BASE);
};

/**
 * Get department by ID
 * @param {string} id - Department ID
 * @returns {Promise}
 */
export const getDepartmentById = async (id) => {
    return api.get(ENDPOINTS.DEPARTMENTS.BY_ID(id));
};

/**
 * Update department
 * @param {string} id - Department ID
 * @param {Object} data - Updated department data
 * @returns {Promise}
 */
export const updateDepartment = async (id, data) => {
    return api.put(ENDPOINTS.DEPARTMENTS.BY_ID(id), data);
};

/**
 * Delete department
 * @param {string} id - Department ID
 * @returns {Promise}
 */
export const deleteDepartment = async (id) => {
    return api.delete(ENDPOINTS.DEPARTMENTS.BY_ID(id));
};

/**
 * Search departments with filters
 * @param {Object} params - Search parameters
 * @returns {Promise}
 */
export const searchDepartments = async (params) => {
    return api.post(ENDPOINTS.DEPARTMENTS.SEARCH, params);
};

export default {
    createDepartment,
    getAllDepartments,
    getDepartmentById,
    updateDepartment,
    deleteDepartment,
    searchDepartments,
};
