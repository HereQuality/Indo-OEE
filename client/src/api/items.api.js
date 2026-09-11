/**
 * Item Master API Service
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

export const createItem = async (data) => api.post(ENDPOINTS.ITEMS.BASE, data);

export const getAllItems = async () => api.get(ENDPOINTS.ITEMS.BASE);

export const getItemById = async (id) => api.get(ENDPOINTS.ITEMS.BY_ID(id));

export const updateItem = async (id, data) => api.put(ENDPOINTS.ITEMS.BY_ID(id), data);

export const deleteItem = async (id) => api.delete(ENDPOINTS.ITEMS.BY_ID(id));

export const searchItems = async (params) => api.post(ENDPOINTS.ITEMS.SEARCH, params);

export default {
    createItem,
    getAllItems,
    getItemById,
    updateItem,
    deleteItem,
    searchItems,
};
