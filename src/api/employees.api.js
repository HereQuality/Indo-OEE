/**
 * Employees API Service
 * Handles all employee-related API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Create a new employee
 * @param {Object|FormData} data - Employee data
 * @returns {Promise}
 */
export const createEmployee = async (data) => {
    return api.post(ENDPOINTS.EMPLOYEES.BASE, data, {
        headers: data instanceof FormData ? { "Content-Type": "multipart/form-data" } : undefined
    });
};

/**
 * Get all employees (requires Employee Management read permission)
 * @returns {Promise}
 */
export const getAllEmployees = async () => {
    return api.get(ENDPOINTS.EMPLOYEES.BASE);
};

/**
 * Get all employees for Access Panel page (requires Access Panel read permission)
 * @returns {Promise}
 */
export const getTeamMembers = async () => {
    return api.get(ENDPOINTS.EMPLOYEES.TEAM_MEMBERS);
};

/**
 * Get employee by ID
 * @param {string} id - Employee ID
 * @returns {Promise}
 */
export const getEmployeeById = async (id) => {
    return api.get(ENDPOINTS.EMPLOYEES.BY_ID(id));
};

/**
 * Update employee
 * @param {string} id - Employee ID
 * @param {Object|FormData} data - Updated employee data
 * @returns {Promise}
 */
export const updateEmployee = async (id, data) => {
    return api.put(ENDPOINTS.EMPLOYEES.BY_ID(id), data, {
        headers: data instanceof FormData ? { "Content-Type": "multipart/form-data" } : undefined
    });
};

/**
 * Set (or clear) an employee's reporting manager(s). An employee can have
 * more than one manager (e.g. one per team hierarchy they belong to), so
 * this accepts either a single manager id or an array of them.
 * @param {string} employeeId
 * @param {string|string[]|null} managerIds
 * @returns {Promise}
 */
export const updateReportingManager = async (employeeId, managerIds) => {
    const ids = managerIds ? (Array.isArray(managerIds) ? managerIds : [managerIds]) : [];
    return api.put(ENDPOINTS.EMPLOYEES.BY_ID(employeeId), { reportingManagerIds: ids });
};

/**
 * Delete employee
 * @param {string} id - Employee ID
 * @returns {Promise}
 */
export const deleteEmployee = async (id) => {
    return api.delete(ENDPOINTS.EMPLOYEES.BY_ID(id));
};

/**
 * Search employees with filters
 * @param {Object} params - Search parameters
 * @returns {Promise}
 */
export const searchEmployees = async (params) => {
    return api.post(ENDPOINTS.EMPLOYEES.SEARCH, params);
};

/**
 * Reset employee password
 * @param {string} id - Employee ID
 * @param {Object} data - New password data
 * @returns {Promise}
 */
export const resetEmployeePassword = async (id, data) => {
    return api.post(ENDPOINTS.EMPLOYEES.RESET_PASSWORD(id), data);
};

/**
 * Impersonate / "Access Panel" — log in as this team member
 * @param {string} id - Employee ID
 * @returns {Promise}
 */
export const impersonateEmployee = async (id) => {
    return api.post(ENDPOINTS.EMPLOYEES.IMPERSONATE(id));
};

export default {
    createEmployee,
    getAllEmployees,
    getEmployeeById,
    updateEmployee,
    deleteEmployee,
    searchEmployees,
    resetEmployeePassword,
    impersonateEmployee,
};
