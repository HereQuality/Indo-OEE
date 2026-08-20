/**
 * OEE Reports API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const downloadOeeReport = async (params) =>
  api.get(ENDPOINTS.REPORTS.OEE, { params, responseType: "blob" });

// Dashboard's quick download — always all machines, no process/machine filter.
export const downloadDashboardOeeReport = async (params) =>
  api.get(ENDPOINTS.REPORTS.OEE_DASHBOARD, { params, responseType: "blob" });

// Daily OEE Trend chart download — POSTs the already-computed { date, OEE }
// series (whatever process/machine filter is active on screen) so the PDF
// chart always matches what's currently shown.
export const downloadDailyOeeTrendReport = async (body) =>
  api.post(ENDPOINTS.REPORTS.OEE_TREND, body, { responseType: "blob" });

// Efficiency Report card's quick download — same single on-screen stat card
// (not the per-entry row table), for the current From/To + Process/Machine filter.
export const downloadEfficiencyCardReport = async (params) =>
  api.get(ENDPOINTS.REPORTS.OEE_CARD, { params, responseType: "blob" });

export default { downloadOeeReport, downloadDashboardOeeReport, downloadDailyOeeTrendReport, downloadEfficiencyCardReport };
