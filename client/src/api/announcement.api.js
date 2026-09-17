/**
 * Announcement Mode API service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// Public — safe to call before/without a session.
export const getAnnouncementStatus = async () => {
    return api.get(ENDPOINTS.ANNOUNCEMENT.STATUS);
};

// SuperAdmin only — { isActive, message, startDate, endDate }
export const updateAnnouncement = async (data) => {
    return api.put(ENDPOINTS.ANNOUNCEMENT.BASE, data);
};

export default {
    getAnnouncementStatus,
    updateAnnouncement,
};
