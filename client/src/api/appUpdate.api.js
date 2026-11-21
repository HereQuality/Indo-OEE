/**
 * App Update (mobile force-update) API service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// Public — safe to call before/without a session.
export const getAppUpdateStatus = async () => {
    return api.get(ENDPOINTS.APP_UPDATE.STATUS);
};

// SuperAdmin only — { isActive, minVersion, latestVersion, message, softMessage }
export const updateAppUpdate = async (data) => {
    return api.put(ENDPOINTS.APP_UPDATE.BASE, data);
};

export default {
    getAppUpdateStatus,
    updateAppUpdate,
};
