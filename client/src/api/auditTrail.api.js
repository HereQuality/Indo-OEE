/**
 * Audit Trail API (server routes/auditTrail.routes.js) — every create / edit /
 * delete / unlock / mark / sign-in across the software, newest first.
 *
 * GET /audit-trail?from&to&module=a,b&action=x,y&actor&q&sheet&entity&machine&date&skip&limit
 *   → { isOk, data: Log[], total }
 * GET /audit-trail/filters → { isOk, data: { modules, actions, actors } }
 * GET /audit-trail/export.csv?<same filters> → a CSV file
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";
import { buildAuditQuery, csvFileName } from "../utils/auditTrail";

// filters: see utils/auditTrail.js EMPTY_FILTERS; page: { skip, limit }.
export const getAuditTrail = async (filters = {}, page = {}) => api.get(ENDPOINTS.AUDIT_TRAIL.BASE, { params: buildAuditQuery(filters, page) });

export const getAuditTrailFilters = async () => api.get(ENDPOINTS.AUDIT_TRAIL.FILTERS);

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
