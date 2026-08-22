/**
 * useProfileUI — Manages UI state for the admin profile page.
 * Mirrors the doctor's useProfileUI hook.
 */
import { useState, useCallback } from 'react';

const useProfileUI = (previewMode = false) => {
    const [activeTab, setActiveTab] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    const handleTabChange = useCallback((event, newValue) => {
        if (!previewMode) {
            setActiveTab(newValue);
        }
    }, [previewMode]);

    const handleCloseSnackbar = useCallback(() => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

    const showSnackbar = useCallback((message, severity = 'success') => {
        setSnackbar({ open: true, message, severity });
    }, []);

    return {
        activeTab,
        loading,
        error,
        snackbar,
        handleTabChange,
        handleCloseSnackbar,
        showSnackbar,
        setLoading,
        setError,
    };
};

export default useProfileUI;
