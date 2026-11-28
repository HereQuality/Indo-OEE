/**
 * Audit Trail API (server routes/auditTrail.routes.js) — every create / edit /
 * delete / unlock / mark / sign-in across the software, newest first.
 *
 * GET /audit-trail?from&to&module=a,b&action=x,y&actor&q&sheet&entity&machine&date&skip&limit
 *   → { isOk, data: Log[], total }
 * GET /audit-trail/filters → { isOk, data: { modules, actions, actors } }
 * GET /audit-trail/export.csv?<same filters> → a CSV file
 * GET /audit-trail/summary → the Logs page's tiles and 14-day chart
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";
import { buildAuditQuery, csvFileName } from "../utils/auditTrail";

// filters: see utils/auditTrail.js EMPTY_FILTERS; page: { skip, limit }.
export const getAuditTrail = async (filters = {}, page = {}) => api.get(ENDPOINTS.AUDIT_TRAIL.BASE, { params: buildAuditQuery(filters, page) });

export const getAuditTrailFilters = async () => api.get(ENDPOINTS.AUDIT_TRAIL.FILTERS);

// The Logs page's stat tiles and 14-day chart: { todayActions, activeUsersToday, failedLogins7d, deletes7d, changes7d, backups7d, days }.
export const getAuditTrailSummary = async () => api.get(ENDPOINTS.AUDIT_TRAIL.SUMMARY);

// "This person opened this page" / "this went wrong on their screen" — fire-and-forget
// (Components/Common/ActivityReporter.jsx). Every failure is ignored; a short timeout keeps
// a slow log write from holding a connection open.
export const reportPageView = (path, title) => api.post(ENDPOINTS.AUDIT_TRAIL.PAGE_VIEW, { path, title }, { timeout: 10000 }).catch(() => {});
export const reportClientError = ({ message, stack, path, source }) =>
  api.post(ENDPOINTS.AUDIT_TRAIL.CLIENT_ERROR, { message, stack, path, source }, { timeout: 10000 }).catch(() => {});

// Downloads the filtered rows as audit-trail-<from>_<to>.csv through the browser.
export const exportAuditTrailCsv = async (filters = {}) => {
  const { skip, limit, ...params } = buildAuditQuery(filters);
  const res = await api.get(ENDPOINTS.AUDIT_TRAIL.EXPORT, { params, responseType: "blob", timeout: 120000 });
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(filters);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return res;
};
