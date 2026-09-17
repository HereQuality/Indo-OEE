/**
 * Maintenance Mode API service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// Public — safe to call before/without a session.
export const getMaintenanceStatus = async () => {
    return api.get(ENDPOINTS.MAINTENANCE.STATUS);
};

// SuperAdmin only — { isActive, message, scheduledAt }
export const updateMaintenance = async (data) => {
    return api.put(ENDPOINTS.MAINTENANCE.BASE, data);
};

export default {
    getMaintenanceStatus,
    updateMaintenance,
};
