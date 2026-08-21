/**
 * usePageConfig Hook
 * 
 * Custom hook to fetch and use page configuration for login/signup pages.
 * Falls back to default config if no LIVE config exists.
 * 
 * Usage:
 * const { config, loading, error } = usePageConfig('patient_login');
 */

import { useState, useEffect } from 'react';
import { fetchPublicPageConfig } from '../../../features/admin/api/pageConfigEndpoints';

// Default configurations for each page type
const DEFAULT_CONFIGS = {
    patient_login: {
        page_title: 'Patient Login',
        page_subtitle: 'Access your health records and appointments',
        primary_button_text: 'Sign In',
        primary_color: '#1976d2',
        secondary_color: '#dc004e',
        background_color: '#ffffff',
        card_background_color: '#ffffff',
        logo_is_present: true,
        otp_is_present: true,
        forgot_password_is_present: true,
        forgot_password_text: 'Forgot Password?',
        register_is_present: true,
        register_text: "Don't have an account?",
        register_link_text: 'Register Now',
        remember_me_is_present: true,
        remember_me_text: 'Remember Me',
        terms_is_present: true,
        footer_is_present: true,
    },
    doctor_login: {
        page_title: 'Doctor Login',
        page_subtitle: 'Access your dashboard and patient records',
        primary_button_text: 'Sign In',
        primary_color: '#2e7d32',
        secondary_color: '#1565c0',
        background_color: '#ffffff',
        card_background_color: '#ffffff',
        logo_is_present: true,
        otp_is_present: true,
        forgot_password_is_present: true,
        forgot_password_text: 'Forgot Password?',
        register_is_present: true,
        register_text: "Don't have an account?",
        register_link_text: 'Register Now',
        remember_me_is_present: true,
        remember_me_text: 'Remember Me',
        terms_is_present: true,
        footer_is_present: true,
    },
    admin_login: {
        page_title: 'Admin Login',
        page_subtitle: 'Healthcare Administration Portal',
        primary_button_text: 'Sign In',
        primary_color: '#ed6c02',
        secondary_color: '#d32f2f',
        background_color: '#ffffff',
        card_background_color: '#ffffff',
        logo_is_present: true,
        otp_is_present: false,
        forgot_password_is_present: true,
        forgot_password_text: 'Forgot Password?',
        register_is_present: false,
        remember_me_is_present: true,
        remember_me_text: 'Remember Me',
        terms_is_present: false,
        footer_is_present: true,
    },
    patient_signup: {
        page_title: 'Create Patient Account',
        page_subtitle: 'Join our healthcare platform',
        primary_button_text: 'Create Account',
        primary_color: '#1976d2',
        secondary_color: '#dc004e',
        background_color: '#ffffff',
        card_background_color: '#ffffff',
        logo_is_present: true,
        otp_is_present: false,
        forgot_password_is_present: false,
        register_is_present: false,
        remember_me_is_present: false,
        terms_is_present: true,
        terms_required: true,
        privacy_is_present: true,
        footer_is_present: true,
    },
    doctor_signup: {
        page_title: 'Doctor Registration',
        page_subtitle: 'Join our network of healthcare providers',
        primary_button_text: 'Register',
        primary_color: '#2e7d32',
        secondary_color: '#1565c0',
        background_color: '#ffffff',
        card_background_color: '#ffffff',
        logo_is_present: true,
        otp_is_present: false,
        forgot_password_is_present: false,
        register_is_present: false,
        remember_me_is_present: false,
        terms_is_present: true,
        terms_required: true,
        privacy_is_present: true,
        footer_is_present: true,
    },
};

/**
 * Hook to fetch and provide page configuration
 * @param {string} pageType - One of: patient_login, doctor_login, admin_login, patient_signup, doctor_signup
 * @returns {{ config: Object, loading: boolean, error: string|null, refetch: Function }}
 */
export const usePageConfig = (pageType) => {
    const [config, setConfig] = useState(DEFAULT_CONFIGS[pageType] || {});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchConfig = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetchPublicPageConfig(pageType);
            console.log(`[usePageConfig] Fetched config for ${pageType}:`, response);

            if (response.success && response.data) {
                // Merge fetched config with defaults to ensure all fields exist
                const finalConfig = {
                    ...DEFAULT_CONFIGS[pageType],
                    ...response.data,
                };
                console.log(`[usePageConfig] Final merged config:`, finalConfig);
                console.log(`[usePageConfig] Logo URL:`, finalConfig.logo_url, 'Logo present:', finalConfig.logo_is_present);
                setConfig(finalConfig);
            }
        } catch (err) {
            // Silently fall back to defaults - no need to show error to users
            console.warn('Failed to fetch page config, using defaults:', err);
            setConfig(DEFAULT_CONFIGS[pageType] || {});
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchConfig();
    }, [pageType]);

    return { config, loading, error, refetch: fetchConfig };
};

export default usePageConfig;
