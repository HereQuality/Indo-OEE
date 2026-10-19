/**
 * Vendor Master API Service
 *
 * The vendor list behind the entry forms' type-to-search "Vendor Name" box —
 * a name, the processes it is used in, and an active flag per vendor.
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createVendor = async (data) => api.post(ENDPOINTS.VENDORS.BASE, data);
export const getAllVendors = async () => api.get(ENDPOINTS.VENDORS.BASE);
export const getVendorById = async (id) => api.get(ENDPOINTS.VENDORS.BY_ID(id));
export const updateVendor = async (id, data) => api.put(ENDPOINTS.VENDORS.BY_ID(id), data);
export const deleteVendor = async (id) => api.delete(ENDPOINTS.VENDORS.BY_ID(id));
export const searchVendors = async (params) => api.post(ENDPOINTS.VENDORS.SEARCH, params);
