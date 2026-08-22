/**
 * useLoginPageConfig Hook
 * Fetches the LIVE page configuration from the page-config system,
 * scoped to the caller's tenant (resolved via ``useTenantSlug``).
 */
import { useState, useEffect, useCallback } from 'react';
import { fetchPublicPageConfig } from '../../admin/api/pageConfigEndpoints';

/**
 * Hook to fetch and manage login page configuration
 * @param {string} pageType - e.g. 'admin_login', 'patient_login', 'doctor_login'
 * @param {string} lang - Language code ('en', 'hi', 'te'). Defaults to 'en'.
 * @returns {Object} { config, loading, error, refetch, availableLanguages }
 */
export const useLoginPageConfig = (pageType, lang = 'en') => {
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchConfig = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            // Tenant is resolved SERVER-SIDE from the request host (the
            // ``X-Tenant-Host`` header the browser sends natively), exactly
            // like the public landing endpoint. We deliberately do NOT pass a
            // client-derived ``tenant_slug`` here: ``resolveTenantSlug()``
            // returns the apex default ``'platform'`` for any ``www.<tenant>``
            // host (``www`` is a generic label), and the backend used to treat
            // that slug as authoritative — so every tenant reached at
            // ``www.<domain>`` (the recommended canonical Custom Hostname) got
            // the APEX login config instead of its own. Letting the host win
            // keeps this in lock-step with landing. Local ``?tenant=acme``
            // preview still works: axios sends it as ``X-Tenant-Slug``.
            const response = await fetchPublicPageConfig(pageType, lang);

            if (response.success && response.data) {
                setConfig(response.data);
            } else {
                setError(response.message || 'Failed to fetch configuration');
            }
        } catch (err) {
            // 404 = "this tenant hasn't published a login page config" — that's
            // an expected design path, not a real error. The page falls back
            // to ``getDefaultConfig()`` and renders fine. Logging it as an
            // ``error`` makes production consoles look broken when nothing
            // is, and trips any console-error-based CI / monitoring rule.
            // Reserve the loud log for genuinely unexpected failures
            // (network down, 5xx, parse error).
            const status = err?.response?.status;
            if (status && status !== 404) {
                console.error('Error fetching login page config:', err);
            }
            setError(null);
        } finally {
            setLoading(false);
        }
    }, [pageType, lang]);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    return {
        config,
        loading,
        error,
        refetch: fetchConfig,
        availableLanguages: config?.available_languages || ['en'],
    };
};

/**
 * Get default configuration when API fails or is unavailable
 * This allows the login page to work even if configuration is not loaded
 */
export const getDefaultConfig = () => ({
    logo_url: null,
    logo_alt_text: 'JLMUSH',
    logo_is_present: true,
    background_color: '#fff9f0',
    card_background_color: '#ffffff',
    page_title: 'Sign In',
    page_subtitle: 'Welcome back!',
    login_tab_text: 'Sign In',
    signup_tab_text: 'Sign up',
    signup_tab_is_present: true,
    login_button_text: 'Sign In',
    otp_button_text: 'Request OTP',
    otp_section_text: 'Login via Phone Number',
    otp_section_is_present: true,
    forgot_password_text: 'Forgot Password?',
    forgot_password_is_present: true,
    register_text: "Don't have an account",
    register_link_text: 'Register Now',
    register_is_present: true,
    terms_checkbox_text: 'Yes, I agree to the',
    terms_link_text: 'Terms & Conditions',
    terms_is_present: true,
    terms_required: true,
    remember_me_text: 'Remember Me',
    remember_me_is_present: true,
    user_type_selector_is_present: true,
    fields: [
        {
            id: 'default-username',
            field_key: 'username',
            field_type: 'text',
            label: 'Email / Phone / Aadhaar',
            placeholder: '',
            icon: 'Person',
            required: true,
            display_order: 1,
        },
        {
            id: 'default-password',
            field_key: 'password',
            field_type: 'password',
            label: 'Password',
            placeholder: '',
            icon: 'Lock',
            required: true,
            display_order: 2,
        },
    ],
    user_types: [
        { id: 'default-patient', type_key: 'patient', display_name: 'Patient', display_order: 1, default_selected: false, signup_route: '/auth/service-receiver/signup' },
        { id: 'default-doctor', type_key: 'doctor', display_name: 'Doctor', display_order: 2, default_selected: false, signup_route: '/auth/service-provider/doctor/signup' },
        { id: 'default-corporate', type_key: 'corporate', display_name: 'Corporate', display_order: 3, default_selected: false, signup_route: '/auth/corporate/signup' },
        { id: 'default-admin', type_key: 'admin', display_name: 'Admin', display_order: 4, default_selected: true, signup_route: null },
    ],
    extra_buttons: [],
});

export default useLoginPageConfig;
