/**
 * FINAL ASSEMBLY sheet API Service (sheet key "finalAssembly") — the same calls as
 * rubberSheet.api.js, against this sheet's own endpoints. The sheet has no
 * machine: the page keeps each block's worker in its `machine` slot (so the
 * shared table and day formulas group by worker), and this is where that
 * becomes the server's `worker`.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// One page (PAGE_SIZE_DAYS distinct dates, newest first) of saved rows between two
// "YYYY-MM-DD" dates — machine (= worker ids) and item are lists.
// Returns { data, meta: { page, totalPages, totalDays }, machineNames (= worker names) }.
export const getFinalAssemblySheet = async ({ from, to, page, machine, item }) =>
    api.get(ENDPOINTS.FINAL_ASSEMBLY_SHEET.BASE, {
        params: {
            from,
            to,
            page,
            ...(machine?.length ? { worker: machine.join(",") } : {}),
            ...(item?.length ? { item: item.join(",") } : {}),
        },
    });

// { from, to } across every saved entry, regardless of any filter.
export const getFinalAssemblyExtent = async () => api.get(ENDPOINTS.FINAL_ASSEMBLY_SHEET.EXTENT);

// Distinct Worker (as `machine`) / Item / Vendor values in a date range — what the Filters panel offers.
export const getFinalAssemblyFilterOptions = async ({ from, to }) => api.get(ENDPOINTS.FINAL_ASSEMBLY_SHEET.FILTER_OPTIONS, { params: { from, to } });

// The time slots an worker already has on one "YYYY-MM-DD" date.
export const getFinalAssemblyOccupiedTimes = async ({ date, machine }) => api.get(ENDPOINTS.FINAL_ASSEMBLY_SHEET.OCCUPIED, { params: { date, worker: machine } });

// Upserts one (date, worker, slot) row; the server deletes it if every field is blank.
export const saveFinalAssemblyRow = async ({ machine, ...row }) => api.put(ENDPOINTS.FINAL_ASSEMBLY_SHEET.ROW, { ...row, worker: machine });

export const deleteFinalAssemblyRow = async (id) => api.delete(`${ENDPOINTS.FINAL_ASSEMBLY_SHEET.ROW}/${id}`);

// Super Admin only — 24 hours of edit/delete access on this one entry.
export const unlockFinalAssemblyRow = async (id) => api.put(`${ENDPOINTS.FINAL_ASSEMBLY_SHEET.ROW}/${id}/unlock`);
