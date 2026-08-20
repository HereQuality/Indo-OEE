import api from "./index";

const BASE = "/api/v1/tickets";

const toFormData = (fields, files) => {
    const fd = new FormData();
    Object.entries(fields || {}).forEach(([k, v]) => {
        if (v !== undefined && v !== null) fd.append(k, v);
    });
    (files || []).forEach((f) => fd.append("attachments", f));
    return fd;
};

export const getTickets = () => api.get(BASE);
export const getTicketDetails = (id) => api.get(`${BASE}/${id}`);

export const createTicket = (payload, files) => {
    if (files && files.length > 0) {
        return api.post(BASE, toFormData(payload, files), { headers: { "Content-Type": "multipart/form-data" } });
    }
    return api.post(BASE, payload);
};

export const replyToTicket = (id, message, files) => {
    if (files && files.length > 0) {
        return api.post(`${BASE}/${id}/reply`, toFormData({ message }, files), { headers: { "Content-Type": "multipart/form-data" } });
    }
    return api.post(`${BASE}/${id}/reply`, { message });
};

export const forwardTicket = (id) => api.post(`${BASE}/${id}/forward`);
export const startProgress = (id) => api.post(`${BASE}/${id}/start-progress`);
export const askForConfirmation = (id) => api.post(`${BASE}/${id}/ask-confirmation`);
export const verifyTicket = (id, action, reason) => api.post(`${BASE}/${id}/verify`, { action, reason });
export const deleteTicket = (id) => api.delete(`${BASE}/${id}`);
export const markTicketMessagesRead = (id) => api.patch(`${BASE}/${id}/read`);
export const getUnreadTicketCount = () => api.get(`${BASE}/unread-count`);
