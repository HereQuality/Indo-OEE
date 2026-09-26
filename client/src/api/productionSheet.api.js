/**
 * Production Data Entry sheet API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows
// between two "YYYY-MM-DD" dates — machine/operator/item are comma-joined
// id/name lists. Returns { data, meta: { page, totalPages, totalDays } }.
export const getProductionSheet = async ({ from, to, page, machine, operator, item }) =>
    api.get(ENDPOINTS.PRODUCTION_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { machine: machine.join(",") } : {}),
            ...(operator?.length ? { operator: operator.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter — for the
// Filters panel's Year tab, since the sheet itself only ever holds one page.
export const getProductionExtent = async () => api.get(ENDPOINTS.PRODUCTION_SHEET.EXTENT);

// Distinct Machine/Operator/Item values present in a date range — what the
// Filters panel's pickers offer, independent of the sheet's current page.
export const getProductionFilterOptions = async ({ from, to }) =>
    api.get(ENDPOINTS.PRODUCTION_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots a machine already has on one "YYYY-MM-DD" date — [{ slot,
// machineOnTime, machineOffTime }] — so the form can show what is taken and
// refuse an overlap before Save (the server enforces it regardless).
export const getOccupiedTimes = async ({ date, machine }) =>
    api.get(ENDPOINTS.PRODUCTION_SHEET.OCCUPIED, { params: { date, machine } });

// Upserts one (date, machine, slot) row; the server deletes it if every field is blank.
export const saveProductionRow = async (row) => api.put(ENDPOINTS.PRODUCTION_SHEET.ROW, row);

// Deletes one saved entry by its _id.
export const deleteProductionRow = async (id) => api.delete(`${ENDPOINTS.PRODUCTION_SHEET.ROW}/${id}`);

// Super Admin only — grants 24 hours of edit/delete access on this one
// entry, overriding the normal 2-working-day lock.
export const unlockProductionRow = async (id) => api.put(`${ENDPOINTS.PRODUCTION_SHEET.ROW}/${id}/unlock`);

export const getOperatorNames = async () => api.get(ENDPOINTS.PRODUCTION_SHEET.OPERATORS);

export const getRejectReasons = async () => api.get(ENDPOINTS.PRODUCTION_SHEET.REJECT_REASONS);
