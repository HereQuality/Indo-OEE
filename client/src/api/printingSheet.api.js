/**
 * PRINTING sheet API Service — the same calls as rubberSheet.api.js, against
 * this sheet's own endpoints. The sheet is kept per operator: the page keeps
 * each block's operator in its `machine` slot (so the shared table and day
 * formulas group by operator), and this is where that becomes the server's
 * `worker`. The optional MC No. travels as `mcMachine`.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine (= operator ids) and item are lists.
// Returns { data, meta: { page, totalPages, totalDays }, machineNames (= operator and MC No. names) }.
export const getPrintingSheet = async ({ from, to, page, machine, item }) =>
    api.get(ENDPOINTS.PRINTING_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { worker: machine.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getPrintingExtent = async () => api.get(ENDPOINTS.PRINTING_SHEET.EXTENT);

// Distinct Operator (as `machine`) / Item / Vendor values in a date range — what the Filters panel offers.
export const getPrintingFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.PRINTING_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The entries (slots and times) an operator already has on one "YYYY-MM-DD" date.
export const getPrintingOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.PRINTING_SHEET.OCCUPIED, { params: { date, worker: machine } });

// Upserts one (date, operator, slot) row; the server deletes it if every field is blank.
export const savePrintingRow = async ({ machine, ...row }) => api.put(ENDPOINTS.PRINTING_SHEET.ROW, { ...row, worker: machine });

export const deletePrintingRow = async (id) => api.delete(`${ENDPOINTS.PRINTING_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockPrintingRow = async (id) => api.put(`${ENDPOINTS.PRINTING_SHEET.ROW}/${id}/unlock`);
