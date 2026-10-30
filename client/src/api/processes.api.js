/**
 * Processes API Service (Production > Processes, and the dashboard's data)
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createProcess = async (data) => api.post(ENDPOINTS.PROCESSES.BASE, data);

// Active processes with their active machines, in display order.
export const getAllProcesses = async () => api.get(ENDPOINTS.PROCESSES.BASE);

export const getProcessById = async (id) => api.get(ENDPOINTS.PROCESSES.BY_ID(id));

export const updateProcess = async (id, data) => api.put(ENDPOINTS.PROCESSES.BY_ID(id), data);

export const deleteProcess = async (id) => api.delete(ENDPOINTS.PROCESSES.BY_ID(id));

export const searchProcesses = async (params) => api.post(ENDPOINTS.PROCESSES.SEARCH, params);

// { from, to, process? } — omit `process` for every machine.
export const getDashboardEntries = async (params) => api.get(ENDPOINTS.PROCESSES.ENTRIES, { params });

// Who may lock / unlock the Planned Shift. GET: { canChange, isSuperAdmin, and for the
// Super Admin: operators (everyone active), selected, configured }. PUT: { operatorIds }.
export const getShiftAccess = async () => api.get(ENDPOINTS.PROCESSES.SHIFT_ACCESS);
export const setShiftAccess = async (operatorIds, roleIds = []) => api.put(ENDPOINTS.PROCESSES.SHIFT_ACCESS, { operatorIds, roleIds });
