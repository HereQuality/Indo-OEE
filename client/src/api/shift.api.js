/**
 * Shift Master API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createShift = async (data) => api.post(ENDPOINTS.SHIFTS.BASE, data);

export const getAllShifts = async () => api.get(ENDPOINTS.SHIFTS.BASE);

export const getShiftById = async (id) => api.get(ENDPOINTS.SHIFTS.BY_ID(id));

export const updateShift = async (id, data) => api.put(ENDPOINTS.SHIFTS.BY_ID(id), data);

export const deleteShift = async (id) => api.delete(ENDPOINTS.SHIFTS.BY_ID(id));

export const searchShifts = async (params) => api.post(ENDPOINTS.SHIFTS.SEARCH, params);

export default {
    createShift,
    getAllShifts,
    getShiftById,
    updateShift,
    deleteShift,
    searchShifts,
};
