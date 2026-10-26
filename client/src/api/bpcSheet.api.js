/**
 * BEFORE POWDER COATING sheet API Service (sheet key "bpc") — the same calls as
 * rubberSheet.api.js, against this sheet's own endpoints. The sheet has no
 * machine: the page keeps each block's operator in its `machine` slot (so the
 * shared table and day formulas group by operator), and this is where that
 * becomes the server's `worker`.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine (= operator ids) and item are lists.
// Returns { data, meta: { page, totalPages, totalDays }, machineNames (= operator names) }.
export const getBpcSheet = async ({ from, to, page, machine, item }) =>
    api.get(ENDPOINTS.BPC_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { worker: machine.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getBpcExtent = async () => api.get(ENDPOINTS.BPC_SHEET.EXTENT);

// Distinct Operator (as `machine`) / Item / Vendor values in a date range — what the Filters panel offers.
export const getBpcFilterOptions = async ({ from, to }) => api.get(ENDPOINTS.BPC_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots an operator already has on one "YYYY-MM-DD" date.
export const getBpcOccupiedTimes = async ({ date, machine }) => api.get(ENDPOINTS.BPC_SHEET.OCCUPIED, { params: { date, worker: machine } });

// Upserts one (date, operator, slot) row; the server deletes it if every field is blank.
export const saveBpcRow = async ({ machine, ...row }) => api.put(ENDPOINTS.BPC_SHEET.ROW, { ...row, worker: machine });

export const deleteBpcRow = async (id) => api.delete(`${ENDPOINTS.BPC_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockBpcRow = async (id) => api.put(`${ENDPOINTS.BPC_SHEET.ROW}/${id}/unlock`);
