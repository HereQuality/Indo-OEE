/**
 * RUBBER sheet API Service — the same calls as
 * powderCoatingSheet.api.js, against this sheet's own endpoints. The sheet has no
 * machine: the page keeps each block's worker in its `machine` slot (so the
 * shared table and day formulas group by worker), and this is where that
 * becomes the server's `worker`.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine (= worker ids) and item are lists.
// Returns { data, meta: { page, totalPages, totalDays }, machineNames (= worker names) }.
export const getRubberSheet = async ({ from, to, page, machine, item }) =>
    api.get(ENDPOINTS.RUBBER_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { worker: machine.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getRubberExtent = async () => api.get(ENDPOINTS.RUBBER_SHEET.EXTENT);

// Distinct Worker (as `machine`) / Item / Vendor values in a date range — what the Filters panel offers.
export const getRubberFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.RUBBER_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots a worker already has on one "YYYY-MM-DD" date.
export const getRubberOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.RUBBER_SHEET.OCCUPIED, { params: { date, worker: machine } });

// Upserts one (date, worker, slot) row; the server deletes it if every field is blank.
export const saveRubberRow = async ({ machine, ...row }) => api.put(ENDPOINTS.RUBBER_SHEET.ROW, { ...row, worker: machine });

export const deleteRubberRow = async (id) => api.delete(`${ENDPOINTS.RUBBER_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockRubberRow = async (id) => api.put(`${ENDPOINTS.RUBBER_SHEET.ROW}/${id}/unlock`);
