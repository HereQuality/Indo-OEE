/**
 * PRESS Data Entry sheet API Service — the same calls as vmcSheet.api.js,
 * against the PRESS sheet's own endpoints and data.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine/operator/item are comma-joined id/name lists.
// Returns { data, meta: { page, totalPages, totalDays } }.
export const getPressSheet = async ({ from, to, page, machine, operator, item }) =>
    api.get(ENDPOINTS.PRESS_SHEET.BASE, {
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
export const getPressExtent = async () => api.get(ENDPOINTS.PRESS_SHEET.EXTENT);

// Distinct Machine/Operator/Item values present in a date range — what the Filters panel offers.
export const getPressFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.PRESS_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots a machine already has on one "YYYY-MM-DD" date.
export const getPressOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.PRESS_SHEET.OCCUPIED, { params: { date, machine } });

// Everything one operator already has on a date, on ANY PRESS machine.
export const getPressOperatorOccupied = async ({ date, operator }) =>
    api.get(ENDPOINTS.PRESS_SHEET.OCCUPIED, { params: { date, operator } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const savePressRow = async (row) => api.put(ENDPOINTS.PRESS_SHEET.ROW, row);

export const deletePressRow = async (id) => api.delete(`${ENDPOINTS.PRESS_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockPressRow = async (id) => api.put(`${ENDPOINTS.PRESS_SHEET.ROW}/${id}/unlock`);
