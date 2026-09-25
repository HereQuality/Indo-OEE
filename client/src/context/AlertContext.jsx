import React, { createContext, useCallback, useContext, useRef, useState, useEffect } from "react";
import AlertContainer from "../Components/Common/AlertContainer";

const AlertContext = createContext(null);

let idCounter = 0;

export const AlertProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState(null); // { message, title, resolve, tone }
    const resolveRef = useRef(null);
    // Each toast's dismiss timer, and which "type|message" is on screen as which
    // toast — so a message repeated while it is still showing can be recognised.
    const timersRef = useRef(new Map());
    const liveRef = useRef(new Map());

    const dismissToast = useCallback((id) => {
        clearTimeout(timersRef.current.get(id));
        timersRef.current.delete(id);
        for (const [key, liveId] of liveRef.current) {
            if (liveId === id) liveRef.current.delete(key);
        }
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const pushToast = useCallback((message, type = "info", duration = 4000) => {
        // The same message pushed again while it is still on screen — e.g. one
        // per keystroke while typing past a limit — keeps a single toast and
        // just restarts its timer, instead of stacking a copy each time.
        const key = `${type}|${message}`;
        let id = liveRef.current.get(key);
        if (id === undefined) {
            id = ++idCounter;
            liveRef.current.set(key, id);
            setToasts((prev) => [...prev, { id, message, type }]);
        } else {
            clearTimeout(timersRef.current.get(id));
        }
        if (duration > 0) {
            timersRef.current.set(id, setTimeout(() => dismissToast(id), duration));
        }
        return id;
    }, [dismissToast]);

    useEffect(() => {
        const timers = timersRef.current;
        return () => timers.forEach(clearTimeout);
    }, []);

    const success = useCallback((message, duration) => pushToast(message, "success", duration), [pushToast]);
    const error = useCallback((message, duration) => pushToast(message, "error", duration), [pushToast]);
    const info = useCallback((message, duration) => pushToast(message, "info", duration), [pushToast]);
    const warning = useCallback((message, duration) => pushToast(message, "warning", duration), [pushToast]);

    // Returns a Promise<boolean> — resolves true if the user confirms, false if cancelled.
    const confirm = useCallback((message, options = {}) => {
        return new Promise((resolve) => {
            resolveRef.current = resolve;
            setConfirmState({
                message,
                title: options.title || "Are you sure?",
                confirmText: options.confirmText || "Yes, Continue",
                cancelText: options.cancelText || "Cancel",
                tone: options.tone || "danger",
            });
        });
    }, []);

    const handleConfirmResult = useCallback((result) => {
        if (resolveRef.current) {
            resolveRef.current(result);
            resolveRef.current = null;
        }
        setConfirmState(null);
    }, []);

    useEffect(() => {
        const handleForbidden = (e) => {
            const message = e.detail?.message || "You do not have permission to perform this action.";
            error(message);
        };
        window.addEventListener("api-forbidden", handleForbidden);
        return () => window.removeEventListener("api-forbidden", handleForbidden);
    }, [error]);

    const value = {
        success,
        error,
        info,
        warning,
        toast: pushToast,
        confirm,
    };

    return (
        <AlertContext.Provider value={value}>
            {children}
            <AlertContainer
                toasts={toasts}
                onDismiss={dismissToast}
                confirmState={confirmState}
                onConfirmResult={handleConfirmResult}
            />
        </AlertContext.Provider>
    );
};

export const useAlert = () => {
    const ctx = useContext(AlertContext);
    if (!ctx) {
        throw new Error("useAlert must be used within an AlertProvider");
    }
    return ctx;
};