/**
 * Company Holidays API Service
 * Handles all company-holiday-related API calls (Administration > Company Holidays)
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const getCompanyHolidays = async () => {
    return api.get(ENDPOINTS.COMPANY_HOLIDAYS.BASE);
};

export const createCompanyHoliday = async (data) => {
    return api.post(ENDPOINTS.COMPANY_HOLIDAYS.BASE, data);
};

export const updateCompanyHoliday = async (id, data) => {
    return api.put(ENDPOINTS.COMPANY_HOLIDAYS.BY_ID(id), data);
};

export const deleteCompanyHoliday = async (id) => {
    return api.delete(ENDPOINTS.COMPANY_HOLIDAYS.BY_ID(id));
};

export const getWeeklyOff = async () => {
    return api.get(ENDPOINTS.COMPANY_HOLIDAYS.WEEKLY_OFF);
};

export const updateWeeklyOff = async (weeklyOffDays) => {
    return api.put(ENDPOINTS.COMPANY_HOLIDAYS.WEEKLY_OFF, { weeklyOffDays });
};

export default {
    getCompanyHolidays,
    createCompanyHoliday,
    updateCompanyHoliday,
    deleteCompanyHoliday,
    getWeeklyOff,
    updateWeeklyOff,
};
