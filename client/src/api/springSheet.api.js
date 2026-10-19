/**
 * Spring Data Entry sheet API Service — the same calls as rivetSheet.api.js,
 * against the Spring sheet's own endpoints and data.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine/operator/item are comma-joined id/name lists.
// Returns { data, meta: { page, totalPages, totalDays } }.
export const getSpringSheet = async ({ from, to, page, machine, operator, item }) =>
    api.get(ENDPOINTS.SPRING_SHEET.BASE, {
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
export const getSpringExtent = async () => api.get(ENDPOINTS.SPRING_SHEET.EXTENT);

// Distinct Machine/Operator/Item values present in a date range — what the Filters panel offers.
export const getSpringFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.SPRING_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots a machine already has on one "YYYY-MM-DD" date.
export const getSpringOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.SPRING_SHEET.OCCUPIED, { params: { date, machine } });

// Everything one operator already has on a date, on ANY Spring machine.
export const getSpringOperatorOccupied = async ({ date, operator }) =>
    api.get(ENDPOINTS.SPRING_SHEET.OCCUPIED, { params: { date, operator } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const saveSpringRow = async (row) => api.put(ENDPOINTS.SPRING_SHEET.ROW, row);

export const deleteSpringRow = async (id) => api.delete(`${ENDPOINTS.SPRING_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockSpringRow = async (id) => api.put(`${ENDPOINTS.SPRING_SHEET.ROW}/${id}/unlock`);
