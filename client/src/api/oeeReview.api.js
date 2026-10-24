/**
 * OEE review API — entries whose Availability, Performance or Quality went
 * above 100%, the Admin decision on each, and the audit log.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// { canReview, role } for whoever is logged in.
export const getReviewAccess = async () => api.get(ENDPOINTS.OEE_REVIEW.ACCESS);

// status: "pending" | "approved" | "rejected" | "all"
export const getReviews = async ({ status = "pending", from, to } = {}) =>
    api.get(ENDPOINTS.OEE_REVIEW.BASE, { params: { status, ...(from ? { from } : {}), ...(to ? { to } : {}) } });

// decision: "approved" | "rejected"; flaggedAt is the flag the reviewer saw.
export const decideReview = async (sheet, id, { decision, remark, flaggedAt }) =>
    api.put(ENDPOINTS.OEE_REVIEW.DECIDE(sheet, id), { decision, remark, flaggedAt });

// A rejected entry, unlocked for another 24 hours — what opening its notification does.
export const reopenReview = async (sheet, id) => api.put(ENDPOINTS.OEE_REVIEW.REOPEN(sheet, id));

// Full access: one earlier entry brought onto its process's CURRENT Operator Planned Shift
// (a change to the process only reaches entries made after it).
export const applyEntryShift = async (sheet, id) => api.put(ENDPOINTS.OEE_REVIEW.SHIFT(sheet, id));

// The audit log, newest first — one entry's/process's history when `entity` is given.
export const getAuditLogs = async ({ entity, entityType, action, skip = 0, limit = 50 } = {}) =>
    api.get(ENDPOINTS.OEE_REVIEW.LOGS, {
        params: { skip, limit, ...(entity ? { entity } : {}), ...(entityType ? { entityType } : {}), ...(action ? { action } : {}) },
    });
