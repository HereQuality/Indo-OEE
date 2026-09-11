/**
 * Machines API Service (Production > Machines)
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createMachine = async (data) => api.post(ENDPOINTS.MACHINES.BASE, data);

// Active machines in sheet order.
export const getAllMachines = async () => api.get(ENDPOINTS.MACHINES.BASE);

export const getMachineById = async (id) => api.get(ENDPOINTS.MACHINES.BY_ID(id));

export const updateMachine = async (id, data) => api.put(ENDPOINTS.MACHINES.BY_ID(id), data);

export const deleteMachine = async (id) => api.delete(ENDPOINTS.MACHINES.BY_ID(id));

export const searchMachines = async (params) => api.post(ENDPOINTS.MACHINES.SEARCH, params);
