/**
 * Machine Operator Master API Service
 *
 * The shop-floor operator list behind Grinding Data Entry's "Operator"
 * dropdown. Deliberately separate from operators.api.js, which talks to the
 * platform's people/login records (employeeCode, departments, roles).
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createMachineOperator = async (data) => api.post(ENDPOINTS.MACHINE_OPERATORS.BASE, data);
export const getAllMachineOperators = async () => api.get(ENDPOINTS.MACHINE_OPERATORS.BASE);
export const getMachineOperatorById = async (id) => api.get(ENDPOINTS.MACHINE_OPERATORS.BY_ID(id));
export const updateMachineOperator = async (id, data) => api.put(ENDPOINTS.MACHINE_OPERATORS.BY_ID(id), data);
export const deleteMachineOperator = async (id) => api.delete(ENDPOINTS.MACHINE_OPERATORS.BY_ID(id));
export const searchMachineOperators = async (params) => api.post(ENDPOINTS.MACHINE_OPERATORS.SEARCH, params);

export default {
  createMachineOperator,
  getAllMachineOperators,
  getMachineOperatorById,
  updateMachineOperator,
  deleteMachineOperator,
  searchMachineOperators,
};
