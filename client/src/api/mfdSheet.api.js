/**
 * MODULAR FRAME DRILLING sheet API Service — the same calls as injectionSheet.api.js,
 * against the MODULAR FRAME DRILLING sheet's own endpoints and data.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine/operator/item are comma-joined id/name lists.
// Returns { data, meta: { page, totalPages, totalDays } }.
export const getMfdSheet = async ({ from, to, page, machine, operator, item }) =>
    api.get(ENDPOINTS.MFD_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { machine: machine.join(",") } : {}),
            ...(operator?.length ? { operator: operator.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getMfdExtent = async () => api.get(ENDPOINTS.MFD_SHEET.EXTENT);

// Distinct Machine/Operator/Part values present in a date range — what the Filters panel offers.
export const getMfdFilterOptions = async ({ from, to }) => api.get(ENDPOINTS.MFD_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The entries a machine already has on one "YYYY-MM-DD" date (they may overlap on this sheet).
export const getMfdOccupiedTimes = async ({ date, machine }) => api.get(ENDPOINTS.MFD_SHEET.OCCUPIED, { params: { date, machine } });

// Everything one operator already has on a date, on ANY MODULAR FRAME DRILLING machine.
export const getMfdOperatorOccupied = async ({ date, operator }) => api.get(ENDPOINTS.MFD_SHEET.OCCUPIED, { params: { date, operator } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const saveMfdRow = async (row) => api.put(ENDPOINTS.MFD_SHEET.ROW, row);

export const deleteMfdRow = async (id) => api.delete(`${ENDPOINTS.MFD_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockMfdRow = async (id) => api.put(`${ENDPOINTS.MFD_SHEET.ROW}/${id}/unlock`);
