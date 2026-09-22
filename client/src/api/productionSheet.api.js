/**
 * Production Data Entry sheet API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// Saved rows between two "YYYY-MM-DD" dates (inclusive).
export const getProductionSheet = async ({ from, to, machine }) =>
    api.get(ENDPOINTS.PRODUCTION_SHEET.BASE, { params: { from, to, ...(machine ? { machine } : {}) } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const saveProductionRow = async (row) => api.put(ENDPOINTS.PRODUCTION_SHEET.ROW, row);

// Deletes one saved entry by its _id.
export const deleteProductionRow = async (id) => api.delete(`${ENDPOINTS.PRODUCTION_SHEET.ROW}/${id}`);

export const getOperatorNames = async () => api.get(ENDPOINTS.PRODUCTION_SHEET.OPERATORS);

// Active employees from the Employee master, for the Operator dropdown.
export const getOperatorMaster = async () => api.get(ENDPOINTS.PRODUCTION_SHEET.OPERATOR_MASTER);

export const getRejectReasons = async () => api.get(ENDPOINTS.PRODUCTION_SHEET.REJECT_REASONS);
