/**
 * Company Holidays API Service
 * Handles Company Holidays + Weekly Off calls (Operator Management > Company Holidays).
 * This calendar is what the production entry lock (2 working days) is checked against.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const getCompanyHolidays = async () => api.get(ENDPOINTS.COMPANY_HOLIDAYS.BASE);

export const createCompanyHoliday = async (data) => api.post(ENDPOINTS.COMPANY_HOLIDAYS.BASE, data);

export const updateCompanyHoliday = async (id, data) => api.put(ENDPOINTS.COMPANY_HOLIDAYS.BY_ID(id), data);

export const deleteCompanyHoliday = async (id) => api.delete(ENDPOINTS.COMPANY_HOLIDAYS.BY_ID(id));

export const getWeeklyOff = async () => api.get(ENDPOINTS.COMPANY_HOLIDAYS.WEEKLY_OFF);

export const updateWeeklyOff = async (weeklyOffDays) =>
  api.put(ENDPOINTS.COMPANY_HOLIDAYS.WEEKLY_OFF_UPDATE, { weeklyOffDays });
