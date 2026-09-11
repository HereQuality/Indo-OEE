import api from "./index";

const BASE = "/api/v1/notifications";

export const getNotifications = () => api.get(BASE);
export const getUnreadNotificationCount = () => api.get(`${BASE}/unread-count`);
export const markNotificationRead = (id) => api.patch(`${BASE}/${id}/read`);
export const markAllNotificationsRead = () => api.patch(`${BASE}/read-all`);
