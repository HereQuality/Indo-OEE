import React, { createContext, useState, useEffect } from 'react';
import { getCurrentUser, updatePreferences as apiUpdatePreferences } from '../api/auth.api';

export const AuthContext = createContext();

// Read token from cookie (preferred) or localStorage (migration fallback)
const getStoredToken = () => {
    const match = document.cookie.split('; ').find((row) => row.startsWith('token='));
    if (match) return decodeURIComponent(match.split('=')[1]);
    return localStorage.getItem('token'); // fallback
};

export const AuthProvider = ({ children }) => {
    const [adminData, setAdminData] = useState(null);
    const [role, setRole] = useState(null);
    const [isSessionVerified, setIsSessionVerified] = useState(false);

    useEffect(() => {
        const verifySession = async () => {
            try {
                const token = getStoredToken();
                if (!token) {
                    setIsSessionVerified(true);
                    return;
                }

                const response = await getCurrentUser();
                if (response.data && response.data.isOk) {
                    setAdminData(response.data.data);
                    setRole(response.data.data.roleType);
                }
            } catch (error) {
                // 403 = blocked or inactive — force logout
                if (error?.response?.status === 403) {
                    document.cookie = 'token=; path=/; max-age=0; SameSite=Strict';
                    document.cookie = 'role=; path=/; max-age=0; SameSite=Strict';
                    localStorage.clear();
                    sessionStorage.clear();
                }
                console.error("Session verification failed", error);
            } finally {
                setIsSessionVerified(true);
            }
        };

        verifySession();
    }, []);

    const updatePreferences = async (newPrefs) => {
        try {
            const res = await apiUpdatePreferences(newPrefs);
            if (res.data && res.data.isOk) {
                setAdminData(prev => ({
                    ...prev,
                    preferences: res.data.data
                }));
            }
        } catch (error) {
            console.error("Failed to update preferences:", error);
        }
    };

    return (
        <AuthContext.Provider value={{ adminData, setAdminData, role, setRole, isSessionVerified, setIsSessionVerified, updatePreferences }}>
            {children}
        </AuthContext.Provider>
    );
};
