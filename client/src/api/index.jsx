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

// Pages a signed-out visitor can be on — a 401 there (a stale cookie checked
// on load) just clears it, with no trip to /login.
const PUBLIC_PATHS = ["/", "/login", "/landing", "/privacy-policy", "/blocked"];

// Set once a 401 has started the trip to /login: every other request that
// fails with it in the same moment must not start another one.
let sendingToLogin = false;

// Response interceptor — handle common error responses
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // 401 = the session is over (expired / invalid token, or the user is
        // gone). The login, username-check and OTP calls never get here —
        // they take their own 4xx answers through validateStatus — so a 401
        // here always comes from a call that needed the session. Clear it and
        // go to /login once, as a full page load: in-memory state (the
        // logged-in user, open loaders) still thinks it's signed in.
        if (error.response?.status === 401) {
            clearAuth();
            const path = window.location.pathname.replace(/\/+$/, "") || "/";
            if (!sendingToLogin && !PUBLIC_PATHS.includes(path)) {
                sendingToLogin = true;
                window.location.replace("/login");
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

// One request for the same GET at the same time. Two components (or an effect
// that runs twice) asking for the identical URL + params while the first is still
// in flight get that first request's answer instead of a second trip to the
// server. Only GETs, only while in flight — nothing is cached afterwards, so the
// next call (a refresh, a changed filter) always reads fresh data. Calls that can
// be cancelled (signal / cancelToken) are left alone.
const inFlight = new Map();
const plainGet = api.get.bind(api);
api.get = (url, config = {}) => {
    if (config.signal || config.cancelToken) return plainGet(url, config);
    let key;
    try {
        key = JSON.stringify([url, config.params ?? null, config.headers ?? null, config.responseType ?? null]);
    } catch {
        return plainGet(url, config);
    }
    const running = inFlight.get(key);
    if (running) return running;
    const request = plainGet(url, config).finally(() => {
        if (inFlight.get(key) === request) inFlight.delete(key);
    });
    inFlight.set(key, request);
    return request;
};

export const getLoggedInUser = () => {
    const user = localStorage.getItem("user");
    if (user) return JSON.parse(user);
    return null;
};

export const isUserAuthenticated = () => {
    return getLoggedInUser() !== null;
};

export default api;
