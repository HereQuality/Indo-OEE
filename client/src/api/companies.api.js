/**
 * Companies API Service
 * Handles company-related API calls
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

/**
 * Get the logged-in user's own company details
 * (used by the Company Portal header/sidebar)
 * @returns {Promise}
 */
export const getCompanyDetails = async () => {
    return api.get(ENDPOINTS.COMPANIES.ME);
};

export const updateCompany = async (formData) => {
    return api.put(ENDPOINTS.COMPANIES.BASE, formData, {
        headers: {
            "Content-Type": "multipart/form-data",
        }
    });
};

export default {
    getCompanyDetails,
    updateCompany,
};