/**
 * "Not running" marks on the data entry sheets (server routes/machineDayStatus.routes.js):
 * a machine-day left empty on purpose, with its reason and remarks.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const getDayStatusReasons = () => api.get(ENDPOINTS.MACHINE_DAY_STATUS.REASONS);
// { sheet, from, to } → [{ sheet, date, machine, reason, reasonLabel, kind, remarks, markedBy }]
export const getDayStatuses = (params) => api.get(ENDPOINTS.MACHINE_DAY_STATUS.BASE, { params });
// { sheet, date, machine | machines: [], reason, remarks }
export const saveDayStatus = (data) => api.put(ENDPOINTS.MACHINE_DAY_STATUS.BASE, data);
export const removeDayStatus = (data) => api.delete(ENDPOINTS.MACHINE_DAY_STATUS.BASE, { data });
