/**
 * MODULAR FRAME ASSEMBLY sheet API Service (sheet key "mfa") — the same calls
 * as rawCastingSheet.api.js, against this sheet's own endpoints. The sheet has
 * no machine: the page keeps each block's worker in its `machine` slot (so the
 * shared table and day formulas group by worker), and this is where that
 * becomes the server's `worker`.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine (= worker ids) and item are lists.
// Returns { data, meta: { page, totalPages, totalDays }, machineNames (= worker names) }.
export const getMfaSheet = async ({ from, to, page, machine, item }) =>
    api.get(ENDPOINTS.MFA_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { worker: machine.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getMfaExtent = async () => api.get(ENDPOINTS.MFA_SHEET.EXTENT);

// Distinct Worker (as `machine`) / Item values in a date range — what the Filters panel offers.
export const getMfaFilterOptions = async ({ from, to }) => api.get(ENDPOINTS.MFA_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The entries (slots and times) a worker already has on one "YYYY-MM-DD" date.
export const getMfaOccupiedTimes = async ({ date, machine }) => api.get(ENDPOINTS.MFA_SHEET.OCCUPIED, { params: { date, worker: machine } });

// Upserts one (date, worker, slot) row; the server deletes it if every field is blank.
export const saveMfaRow = async ({ machine, ...row }) => api.put(ENDPOINTS.MFA_SHEET.ROW, { ...row, worker: machine });

export const deleteMfaRow = async (id) => api.delete(`${ENDPOINTS.MFA_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockMfaRow = async (id) => api.put(`${ENDPOINTS.MFA_SHEET.ROW}/${id}/unlock`);
