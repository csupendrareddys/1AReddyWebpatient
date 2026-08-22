/**
 * useDoctorProfilePageConfig — Fetches the LIVE page config for Doctor Profile
 * and provides helper utilities to control field visibility, labels, required
 * status, and placeholders based on admin configuration.
 *
 * Usage in any component:
 *   const { isFieldVisible, getFieldLabel, isFieldRequired, isSectionVisible, ... } = useDoctorProfilePageConfig();
 *
 *   // Hide a field if admin turned it off:
 *   {isFieldVisible('first_name') && <TextField label={getFieldLabel('first_name', 'First Name')} required={isFieldRequired('first_name')} ... />}
 *
 * For admin preview mode, pass configOverride to skip API call and use draft data:
 *   const cfg = useDoctorProfilePageConfig('en', 'doctor', { page_config: draft, field_configs: fields });
 */
import { useMemo } from 'react';
import { useGetPublicDoctorProfileConfigQuery } from '../../../admin/api/doctorProfileConfigEndpoints';

const useDoctorProfilePageConfig = (lang = 'en', userType = 'doctor', configOverride = null) => {
    // Skip API call when configOverride is provided (admin preview mode)
    const {
        data: configData,
        isLoading: apiLoading,
        isError,
        error,
    } = useGetPublicDoctorProfileConfigQuery(
        { lang, userType },
        { skip: !!configOverride }
    );

    // Use configOverride if provided, otherwise use API data
    const resolvedData = configOverride || configData;
    const isLoading = configOverride ? false : apiLoading;

    // After transformResponse, resolvedData = { page_config: {...}, field_configs: [...] }
    const pageConfig = resolvedData?.page_config || null;
    const fieldConfigs = resolvedData?.field_configs || [];

    // DEBUG: Log to verify data extraction (dev only)
    if (import.meta.env.DEV) {
        console.log('[PageConfig] resolvedData:', resolvedData, 'override?', !!configOverride);
        console.log('[PageConfig] isLoading:', isLoading, 'isError:', isError);
        console.log('[PageConfig] pageConfig:', pageConfig ? 'loaded' : 'null');
        console.log('[PageConfig] fieldConfigs count:', fieldConfigs.length);
        console.log('[PageConfig] sections:', pageConfig?.fields?.sections?.map(s => `${s.key}:${s.is_present}`));
    }

    // Build fast lookup maps
    const fieldMap = useMemo(() => {
        const map = {};
        for (const f of fieldConfigs) {
            map[f.field_key] = f;
        }
        return map;
    }, [fieldConfigs]);

    const sectionMap = useMemo(() => {
        const map = {};
        const sections = pageConfig?.fields?.sections || [];
        for (const s of sections) {
            map[s.key] = s;
        }
        return map;
    }, [pageConfig]);

    // ── Field helpers ─────────────────────────────────────────────

    const isFieldVisible = (fieldKey) => {
        if (!fieldConfigs.length) return true;
        const f = fieldMap[fieldKey];
        return f ? f.is_present !== false : true;
    };

    const getFieldLabel = (fieldKey, defaultLabel) => {
        const f = fieldMap[fieldKey];
        return f?.label || defaultLabel;
    };

    const getFieldPlaceholder = (fieldKey, defaultPlaceholder = '') => {
        const f = fieldMap[fieldKey];
        return f?.placeholder || defaultPlaceholder;
    };

    const isFieldRequired = (fieldKey, defaultRequired = false) => {
        const f = fieldMap[fieldKey];
        return f ? f.required === true : defaultRequired;
    };

    const getFieldConfig = (fieldKey) => fieldMap[fieldKey] || null;

    // ── Section helpers ───────────────────────────────────────────

    const isSectionVisible = (sectionKey) => {
        if (!pageConfig) return true;
        const s = sectionMap[sectionKey];
        return s ? s.is_present !== false : true;
    };

    const getSectionLabel = (sectionKey, defaultLabel) => {
        const s = sectionMap[sectionKey];
        return s?.label || defaultLabel;
    };

    // ── Page-level settings ───────────────────────────────────────

    const pageTitle = pageConfig?.page_title || 'Doctor Profile & Settings';
    const pageSubtitle = pageConfig?.page_subtitle || '';
    const primaryColor = pageConfig?.primary_color || '#1976d2';
    const secondaryColor = pageConfig?.secondary_color || '#dc004e';
    const backgroundColor = pageConfig?.background_color || '#ffffff';
    const primaryButtonText = pageConfig?.primary_button_text || 'Save Profile';
    const footerText = pageConfig?.footer_text || '';
    const footerIsPresent = pageConfig?.footer_is_present ?? false;

    const getFieldOptions = (fieldKey) => {
        const f = fieldMap[fieldKey];
        return f?.options || [];
    };

    return {
        isLoading,
        isError,
        hasConfig: !!pageConfig,
        pageConfig,
        fieldConfigs,
        isFieldVisible,
        getFieldLabel,
        getFieldPlaceholder,
        isFieldRequired,
        getFieldConfig,
        getFieldOptions,
        isSectionVisible,
        getSectionLabel,
        pageTitle,
        pageSubtitle,
        primaryColor,
        secondaryColor,
        backgroundColor,
        primaryButtonText,
        footerText,
        footerIsPresent,
    };
};

export default useDoctorProfilePageConfig;
