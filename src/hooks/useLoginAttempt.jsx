import { useState, useEffect, useCallback, useRef } from 'react';
import { getLoginStatusByEmail } from '../api/auth.api';

// Simple email validation regex
const isValidEmail = (email) => {
    return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Custom hook for managing login attempt status
 * Handles countdown timer and lock status checking
 * @param {string} email - Email to check status for
 * @returns {Object} Login attempt status and formatted time
 */
export const useLoginAttempt = (email) => {
    const [status, setStatus] = useState({
        attemptCount: 0,
        isLocked: false,
        lockUntil: null,
        remainingTime: null,
        attemptsRemaining: 3,
    });
    const [formattedTime, setFormattedTime] = useState('');
    const [loading, setLoading] = useState(false);

    // Ref to track debounce timeout
    const debounceTimeoutRef = useRef(null);

    // Fetch login status from server
    const fetchStatus = useCallback(async () => {
        if (!email) return;

        try {
            setLoading(true);
            const response = await getLoginStatusByEmail(email);
            if (response.data?.status === 'success' && response.data?.data) {
                setStatus(response.data.data);
            }
        } catch (error) {
            console.error('Failed to fetch login status:', error);
        } finally {
            setLoading(false);
        }
    }, [email]);

    // Debounced fetch status when email changes
    useEffect(() => {
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }

        if (!isValidEmail(email)) {
            return;
        }

        debounceTimeoutRef.current = setTimeout(() => {
            fetchStatus();
        }, 500);

        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, [email, fetchStatus]);

    // Countdown timer effect
    useEffect(() => {
        if (!status.remainingTime || status.remainingTime <= 0) {
            setFormattedTime('');
            return;
        }

        const interval = setInterval(() => {
            setStatus(prev => {
                const newRemaining = prev.remainingTime - 1000;
                if (newRemaining <= 0) {
                    clearInterval(interval);
                    return {
                        ...prev,
                        remainingTime: 0,
                        isLocked: false,
                    };
                }
                return { ...prev, remainingTime: newRemaining };
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [status.isLocked, status.remainingTime > 0]);

    // Format time to HH:MM:SS
    useEffect(() => {
        if (status.remainingTime && status.remainingTime > 0) {
            const totalSeconds = Math.floor(status.remainingTime / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            const formatted = `${hours.toString().padStart(2, '0')}:${minutes
                .toString()
                .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            setFormattedTime(formatted);
        } else {
            setFormattedTime('');
        }
    }, [status.remainingTime]);

    // Function to update status from login response
    const updateFromResponse = useCallback((responseData) => {
        if (responseData.attemptsRemaining !== undefined) {
            setStatus(prev => ({
                ...prev,
                attemptCount: 3 - responseData.attemptsRemaining,
                attemptsRemaining: responseData.attemptsRemaining,
            }));
        }
        if (responseData.lockedUntil || responseData.remainingTimeMs || responseData.remainingTime) {
            // Convert minutes to ms if API returns minutes
            let remainingMs = responseData.remainingTimeMs;
            if (!remainingMs && responseData.remainingTime) {
                remainingMs = responseData.remainingTime * 60 * 1000;
            }

            setStatus(prev => ({
                ...prev,
                isLocked: true,
                lockUntil: responseData.lockedUntil,
                remainingTime: remainingMs,
            }));
        }
    }, []);

    return {
        ...status,
        formattedTime,
        loading,
        fetchStatus,
        updateFromResponse,
    };
};

export default useLoginAttempt;
