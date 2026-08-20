/**
 * Centralized Axios instance with interceptors
 * Token is stored in a cookie (not localStorage) after login.
 */
import axios from "axios";

// Read API URL directly from env variables (Vite uses import.meta.env)
const API_URL = import.meta.env.VITE_API_BASE_URL;

// Helper: read a cookie value by name
const getCookieValue = (name) => {
    const match = document.cookie.split('; ').find((row) => row.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.split('=')[1]) : null;
};

// Helper: clear auth cookies + storage (used on 401)
const clearAuth = () => {
    document.cookie = 'token=; path=/; max-age=0; SameSite=Strict';
    document.cookie = 'role=; path=/; max-age=0; SameSite=Strict';
    localStorage.clear();
    sessionStorage.clear();
};

// Create axios instance with base configuration
const api = axios.create({
    baseURL: API_URL,
    timeout: 30000,
    headers: {
        "Content-Type": "application/json",
    },
    withCredentials: true, // Send cookies with all requests
});

// Request interceptor — inject JWT from cookie
api.interceptors.request.use(
    (config) => {
        const token = getCookieValue("token") || localStorage.getItem("token"); // fallback for migration
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — handle common error responses
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Handle 401 Unauthorized — clear stale credentials and redirect to login
        if (error.response?.status === 401) {
            clearAuth();
            const onLoginPage =
                window.location.pathname === "/" ||
                window.location.pathname === "/login";
            if (!onLoginPage) {
                window.location.href = "/";
            }
        }

        if (error.response?.status === 403) {
            const msg = error.response?.data?.message || '';
            const isBlockedOrInactive =
                msg.toLowerCase().includes('blocked') ||
                msg.toLowerCase().includes('inactive');
            if (isBlockedOrInactive) {
                clearAuth();
                const onBlockedPage = window.location.pathname === '/blocked';
                if (!onBlockedPage) {
                    window.location.href = `/blocked`;
                }
            } else {
                // Dispatch global event for generic 403s so UI can show a toast
                window.dispatchEvent(new CustomEvent('api-forbidden', { detail: { message: msg } }));
            }
        }

        if (error.response?.status >= 500) {
            console.error("Server error:", error.response?.data?.message);
        }

        return Promise.reject(error);
    }
);

export const getLoggedInUser = () => {
    const user = localStorage.getItem("user");
    if (user) return JSON.parse(user);
    return null;
};

export const isUserAuthenticated = () => {
    return getLoggedInUser() !== null;
};

export default api;
