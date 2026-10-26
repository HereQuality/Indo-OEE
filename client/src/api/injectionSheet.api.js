/**
 * INJECTION MOULDING sheet API Service — the same calls as springSheet.api.js,
 * against the INJECTION MOULDING sheet's own endpoints and data.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine/operator/item are comma-joined id/name lists.
// Returns { data, meta: { page, totalPages, totalDays } }.
export const getInjectionSheet = async ({ from, to, page, machine, operator, item }) =>
    api.get(ENDPOINTS.INJECTION_SHEET.BASE, {
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
export const getInjectionExtent = async () => api.get(ENDPOINTS.INJECTION_SHEET.EXTENT);

// Distinct Machine/Operator/Item values present in a date range — what the Filters panel offers.
export const getInjectionFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.INJECTION_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots a machine already has on one "YYYY-MM-DD" date.
export const getInjectionOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.INJECTION_SHEET.OCCUPIED, { params: { date, machine } });

// Everything one operator already has on a date, on ANY INJECTION MOULDING machine.
export const getInjectionOperatorOccupied = async ({ date, operator }) =>
    api.get(ENDPOINTS.INJECTION_SHEET.OCCUPIED, { params: { date, operator } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const saveInjectionRow = async (row) => api.put(ENDPOINTS.INJECTION_SHEET.ROW, row);

export const deleteInjectionRow = async (id) => api.delete(`${ENDPOINTS.INJECTION_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockInjectionRow = async (id) => api.put(`${ENDPOINTS.INJECTION_SHEET.ROW}/${id}/unlock`);
