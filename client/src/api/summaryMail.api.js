/**
 * Summary email API — who gets the daily / weekly OEE + OK Qty summary
 * (server routes/summaryMail.routes.js; Super Admin / Full access only).
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const getSummaryMail = () => api.get(ENDPOINTS.SUMMARY_MAIL.BASE);
// { recipients: string[] | string, dailyEnabled, weeklyEnabled, dailySendAt: "HH:mm", weeklySendAt: "HH:mm", weeklyDay: 0–6 }
export const updateSummaryMail = (data) => api.put(ENDPOINTS.SUMMARY_MAIL.BASE, data);
// { kind: "daily" | "weekly", to?: "a@b.com" } — sends that summary right now
export const sendSummaryMailNow = (data) => api.post(ENDPOINTS.SUMMARY_MAIL.SEND, data);
