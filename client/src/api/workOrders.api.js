/**
 * Work Orders API Service (Production > Work Orders)
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createWorkOrder = async (data) => api.post(ENDPOINTS.WORK_ORDERS.BASE, data);

// Active work orders, for the data entry sheet's Work Order No. picker.
export const getAllWorkOrders = async () => api.get(ENDPOINTS.WORK_ORDERS.BASE);

export const getWorkOrderById = async (id) => api.get(ENDPOINTS.WORK_ORDERS.BY_ID(id));

export const updateWorkOrder = async (id, data) => api.put(ENDPOINTS.WORK_ORDERS.BY_ID(id), data);

export const deleteWorkOrder = async (id) => api.delete(ENDPOINTS.WORK_ORDERS.BY_ID(id));

export const searchWorkOrders = async (params) => api.post(ENDPOINTS.WORK_ORDERS.SEARCH, params);
