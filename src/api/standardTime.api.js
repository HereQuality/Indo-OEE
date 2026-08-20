import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createStandardTime = (data) => api.post(ENDPOINTS.STANDARD_TIMES.BASE, data);
export const getStandardTimeById = (id) => api.get(ENDPOINTS.STANDARD_TIMES.BY_ID(id));
export const updateStandardTime = (id, data) => api.put(ENDPOINTS.STANDARD_TIMES.BY_ID(id), data);
export const deleteStandardTime = (id) => api.delete(ENDPOINTS.STANDARD_TIMES.BY_ID(id));
export const searchStandardTimes = (params) => api.post(ENDPOINTS.STANDARD_TIMES.SEARCH, params);

/**
 * List active standard times, optionally filtered by machine.
 * Used by the Production Data Entry form to populate dropdowns.
 * @param {Object} params - { machine: <id> }
 */
export const listStandardTimes = (params = {}) =>
  api.get(ENDPOINTS.STANDARD_TIMES.BASE, { params: { isActive: true, ...params } });

export default { createStandardTime, getStandardTimeById, updateStandardTime, deleteStandardTime, searchStandardTimes, listStandardTimes };
