/**
 * Operators API Service
 * Handles all operator-related API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Create a new operator
 * @param {Object|FormData} data - Operator data
 * @returns {Promise}
 */
export const createOperator = async (data) => {
    return api.post(ENDPOINTS.OPERATORS.BASE, data, {
        headers: data instanceof FormData ? { "Content-Type": "multipart/form-data" } : undefined
    });
};

/**
 * Get all operators (requires Operator Management read permission)
 * @returns {Promise}
 */
export const getAllOperators = async () => {
    return api.get(ENDPOINTS.OPERATORS.BASE);
};

/**
 * Get all operators for Access Panel page (requires Access Panel read permission)
 * @returns {Promise}
 */
export const getTeamMembers = async () => {
    return api.get(ENDPOINTS.OPERATORS.TEAM_MEMBERS);
};

/**
 * Get operator by ID
 * @param {string} id - Operator ID
 * @returns {Promise}
 */
export const getOperatorById = async (id) => {
    return api.get(ENDPOINTS.OPERATORS.BY_ID(id));
};

/**
 * Update operator
 * @param {string} id - Operator ID
 * @param {Object|FormData} data - Updated operator data
 * @returns {Promise}
 */
export const updateOperator = async (id, data) => {
    return api.put(ENDPOINTS.OPERATORS.BY_ID(id), data, {
        headers: data instanceof FormData ? { "Content-Type": "multipart/form-data" } : undefined
    });
};

/**
 * Set (or clear) an operator's reporting manager(s). An operator can have
 * more than one manager (e.g. one per team hierarchy they belong to), so
 * this accepts either a single manager id or an array of them.
 * @param {string} operatorId
 * @param {string|string[]|null} managerIds
 * @returns {Promise}
 */
export const updateReportingManager = async (operatorId, managerIds) => {
    const ids = managerIds ? (Array.isArray(managerIds) ? managerIds : [managerIds]) : [];
    return api.put(ENDPOINTS.OPERATORS.BY_ID(operatorId), { reportingManagerIds: ids });
};

/**
 * Delete operator
 * @param {string} id - Operator ID
 * @returns {Promise}
 */
export const deleteOperator = async (id) => {
    return api.delete(ENDPOINTS.OPERATORS.BY_ID(id));
};

/**
 * Search operators with filters
 * @param {Object} params - Search parameters
 * @returns {Promise}
 */
export const searchOperators = async (params) => {
    return api.post(ENDPOINTS.OPERATORS.SEARCH, params);
};

/**
 * Reset operator password
 * @param {string} id - Operator ID
 * @param {Object} data - New password data
 * @returns {Promise}
 */
export const resetOperatorPassword = async (id, data) => {
    return api.post(ENDPOINTS.OPERATORS.RESET_PASSWORD(id), data);
};

/**
 * Impersonate / "Access Panel" — log in as this team member
 * @param {string} id - Operator ID
 * @returns {Promise}
 */
export const impersonateOperator = async (id) => {
    return api.post(ENDPOINTS.OPERATORS.IMPERSONATE(id));
};

export default {
    createOperator,
    getAllOperators,
    getOperatorById,
    updateOperator,
    deleteOperator,
    searchOperators,
    resetOperatorPassword,
    impersonateOperator,
};
