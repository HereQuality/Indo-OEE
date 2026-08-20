/**
 * Menus API Service
 * Handles all menu-related API calls (Menu Groups and Menu Master)
 */
import api from "./index";
import { ENDPOINTS } from "./endpoints";

// ============ MENU GROUP OPERATIONS ============

/**
 * Create a new menu group
 * @param {Object} data - Menu group data
 * @returns {Promise}
 */
export const createMenuGroup = async (data) => {
    return api.post(ENDPOINTS.MENU_GROUPS.BASE, data);
};

/**
 * Get all menu groups
 * @returns {Promise}
 */
export const getAllMenuGroups = async () => {
    return api.get(ENDPOINTS.MENU_GROUPS.BASE);
};

/**
 * Get menu group by ID
 * @param {string} id - Menu group ID
 * @returns {Promise}
 */
export const getMenuGroupById = async (id) => {
    return api.get(ENDPOINTS.MENU_GROUPS.BY_ID(id));
};

/**
 * Update menu group
 * @param {string} id - Menu group ID
 * @param {Object} data - Updated menu group data
 * @returns {Promise}
 */
export const updateMenuGroup = async (id, data) => {
    return api.put(ENDPOINTS.MENU_GROUPS.BY_ID(id), data);
};

/**
 * Delete menu group
 * @param {string} id - Menu group ID
 * @returns {Promise}
 */
export const deleteMenuGroup = async (id) => {
    return api.delete(ENDPOINTS.MENU_GROUPS.BY_ID(id));
};

/**
 * Search menu groups with filters
 * @param {Object} params - Search parameters
 * @returns {Promise}
 */
export const searchMenuGroups = async (params) => {
    return api.post(ENDPOINTS.MENU_GROUPS.SEARCH, params);
};

// ============ MENU MASTER OPERATIONS ============

/**
 * Create a new menu
 * @param {Object} data - Menu data
 * @returns {Promise}
 */
export const createMenu = async (data) => {
    return api.post(ENDPOINTS.MENUS.BASE, data);
};

/**
 * Get all menus
 * @returns {Promise}
 */
export const getAllMenus = async () => {
    return api.get(ENDPOINTS.MENUS.BASE);
};

/**
 * Get menu by ID
 * @param {string} id - Menu ID
 * @returns {Promise}
 */
export const getMenuById = async (id) => {
    return api.get(ENDPOINTS.MENUS.BY_ID(id));
};

/**
 * Update menu
 * @param {string} id - Menu ID
 * @param {Object} data - Updated menu data
 * @returns {Promise}
 */
export const updateMenu = async (id, data) => {
    return api.put(ENDPOINTS.MENUS.BY_ID(id), data);
};

/**
 * Delete menu
 * @param {string} id - Menu ID
 * @returns {Promise}
 */
export const deleteMenu = async (id) => {
    return api.delete(ENDPOINTS.MENUS.BY_ID(id));
};

/**
 * Search menus with filters
 * @param {Object} params - Search parameters
 * @returns {Promise}
 */
export const searchMenus = async (params) => {
    return api.post(ENDPOINTS.MENUS.SEARCH, params);
};

/**
 * Get menus grouped by menu groups
 * @returns {Promise}
 */
export const getMenusByGroups = async () => {
    return api.get(ENDPOINTS.MENUS.BY_GROUPS);
};

export default {
    // Menu Groups
    createMenuGroup,
    getAllMenuGroups,
    getMenuGroupById,
    updateMenuGroup,
    deleteMenuGroup,
    searchMenuGroups,
    // Menus
    createMenu,
    getAllMenus,
    getMenuById,
    updateMenu,
    deleteMenu,
    searchMenus,
    getMenusByGroups,
};
