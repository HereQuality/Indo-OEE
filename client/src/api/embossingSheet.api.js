/**
 * EMBOSSING sheet API Service — the same calls as springSheet.api.js,
 * against the EMBOSSING sheet's own endpoints and data.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine/operator/item are comma-joined id/name lists.
// Returns { data, meta: { page, totalPages, totalDays } }.
export const getEmbossingSheet = async ({ from, to, page, machine, operator, item }) =>
    api.get(ENDPOINTS.EMBOSSING_SHEET.BASE, {
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
export const getEmbossingExtent = async () => api.get(ENDPOINTS.EMBOSSING_SHEET.EXTENT);

// Distinct Machine/Operator/Item values present in a date range — what the Filters panel offers.
export const getEmbossingFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.EMBOSSING_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots a machine already has on one "YYYY-MM-DD" date.
export const getEmbossingOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.EMBOSSING_SHEET.OCCUPIED, { params: { date, machine } });

// Everything one operator already has on a date, on ANY EMBOSSING machine.
export const getEmbossingOperatorOccupied = async ({ date, operator }) =>
    api.get(ENDPOINTS.EMBOSSING_SHEET.OCCUPIED, { params: { date, operator } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const saveEmbossingRow = async (row) => api.put(ENDPOINTS.EMBOSSING_SHEET.ROW, row);

export const deleteEmbossingRow = async (id) => api.delete(`${ENDPOINTS.EMBOSSING_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockEmbossingRow = async (id) => api.put(`${ENDPOINTS.EMBOSSING_SHEET.ROW}/${id}/unlock`);
