/**
 * KPI API (Data Entry › KPI and Company Level Objective)
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// { year, department? } → objectives with their 12 months of OK Qty, plus the
// departments this person may use.
export const getKpiObjectives = async (params) => api.get(ENDPOINTS.KPI.OBJECTIVES, { params });
export const createKpiObjective = async (data) => api.post(ENDPOINTS.KPI.OBJECTIVES, data);
export const updateKpiObjective = async (id, data) => api.put(ENDPOINTS.KPI.OBJECTIVE(id), data);
export const deleteKpiObjective = async (id) => api.delete(ENDPOINTS.KPI.OBJECTIVE(id));

export const getCompanySummary = async (year) => api.get(ENDPOINTS.KPI.COMPANY, { params: { year } });
export const createCompanyObjective = async (data) => api.post(ENDPOINTS.KPI.COMPANY, data);
export const updateCompanyObjective = async (id, data) => api.put(ENDPOINTS.KPI.COMPANY_ONE(id), data);
export const deleteCompanyObjective = async (id) => api.delete(ENDPOINTS.KPI.COMPANY_ONE(id));

// Old Excel figures: rows → { imported, created?, errors: [{ row, message }] }.
export const importKpiObjectives = async (rows) => api.post(ENDPOINTS.KPI.OBJECTIVES_IMPORT, { rows });
export const importCompanyHistory = async (rows) => api.post(ENDPOINTS.KPI.COMPANY_IMPORT, { rows });
// One month's business figures: { year, month, values: { sales, salary, … } }.
export const saveCompanyMonthly = async (data) => api.put(ENDPOINTS.KPI.COMPANY_MONTHLY, data);
