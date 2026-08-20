import React, { createContext, useCallback, useContext, useRef, useState, useEffect } from "react";
import AlertContainer from "../Components/Common/AlertContainer";

const AlertContext = createContext(null);

let idCounter = 0;

export const AlertProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);
    const [confirmState, setConfirmState] = useState(null); // { message, title, resolve, tone }
    const resolveRef = useRef(null);

    const dismissToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const pushToast = useCallback((message, type = "info", duration = 4000) => {
        const id = ++idCounter;
        setToasts((prev) => [...prev, { id, message, type }]);
        if (duration > 0) {
            setTimeout(() => dismissToast(id), duration);
        }
        return id;
    }, [dismissToast]);

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