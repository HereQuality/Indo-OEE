/**
 * Operator Master API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createOperator = async (data) => api.post(ENDPOINTS.OPERATORS.BASE, data);
export const getAllOperators = async () => api.get(ENDPOINTS.OPERATORS.BASE);
export const getOperatorById = async (id) => api.get(ENDPOINTS.OPERATORS.BY_ID(id));
export const updateOperator = async (id, data) => api.put(ENDPOINTS.OPERATORS.BY_ID(id), data);
export const deleteOperator = async (id) => api.delete(ENDPOINTS.OPERATORS.BY_ID(id));
export const searchOperators = async (params) => api.post(ENDPOINTS.OPERATORS.SEARCH, params);

export default {
  createOperator,
  getAllOperators,
  getOperatorById,
  updateOperator,
  deleteOperator,
  searchOperators,
};
