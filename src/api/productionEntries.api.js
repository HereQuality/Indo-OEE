/**
 * Production Data Entry API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * List entries for the Dashboard's OEE calculations.
 * @param {Object} params - { machine, from, to, skip, per_page }
 */
export const listProductionEntries = async (params = {}) =>
    api.get(ENDPOINTS.PRODUCTION_ENTRIES.BASE, { params });

export default {
    listProductionEntries,
};
