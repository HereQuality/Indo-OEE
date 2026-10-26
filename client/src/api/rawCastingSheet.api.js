/**
 * RAW CASTING sheet API Service (sheet key "rawCasting") — the same calls as
 * powderCoatingSheet.api.js, against this sheet's own endpoints. The sheet has
 * no machine: the page keeps each block's worker in its `machine` slot (so the
 * shared table and day formulas group by worker), and this is where that
 * becomes the server's `worker`.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine (= worker ids) and item are lists.
// Returns { data, meta: { page, totalPages, totalDays }, machineNames (= worker names) }.
export const getRawCastingSheet = async ({ from, to, page, machine, item }) =>
    api.get(ENDPOINTS.RAW_CASTING_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { worker: machine.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getRawCastingExtent = async () => api.get(ENDPOINTS.RAW_CASTING_SHEET.EXTENT);

// Distinct Worker (as `machine`) / Item / Vendor values in a date range — what the Filters panel offers.
export const getRawCastingFilterOptions = async ({ from, to }) => api.get(ENDPOINTS.RAW_CASTING_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The entries (slots and times) a worker already has on one "YYYY-MM-DD" date.
export const getRawCastingOccupiedTimes = async ({ date, machine }) => api.get(ENDPOINTS.RAW_CASTING_SHEET.OCCUPIED, { params: { date, worker: machine } });

// Upserts one (date, worker, slot) row; the server deletes it if every field is blank.
export const saveRawCastingRow = async ({ machine, ...row }) => api.put(ENDPOINTS.RAW_CASTING_SHEET.ROW, { ...row, worker: machine });

export const deleteRawCastingRow = async (id) => api.delete(`${ENDPOINTS.RAW_CASTING_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockRawCastingRow = async (id) => api.put(`${ENDPOINTS.RAW_CASTING_SHEET.ROW}/${id}/unlock`);
