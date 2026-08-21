/**
 * usePatientProfilePageConfig -- Fetches the LIVE page config for Patient Profile
 * and provides helper utilities to control field visibility, labels, required
 * status, and placeholders based on admin configuration.
 *
 * Usage in any component:
 *   const { isFieldVisible, getFieldLabel, isFieldRequired, isSectionVisible, ... } = usePatientProfilePageConfig();
 *
 *   // Hide a field if admin turned it off:
 *   {isFieldVisible('blood_group') && <TextField label={getFieldLabel('blood_group', 'Blood Group')} required={isFieldRequired('blood_group')} ... />}
 *
 * For admin preview mode, pass configOverride to skip API call and use draft data:
 *   const cfg = usePatientProfilePageConfig('en', 'patient', { page_config: draft, field_configs: fields });
 */
import { useMemo } from 'react';
import { useGetPublicPatientProfileConfigQuery } from '../../api/patientProfileConfigEndpoints';

const usePatientProfilePageConfig = (lang = 'en', userType = 'patient', configOverride = null) => {
    // Skip API call when configOverride is provided (admin preview mode)
    const {
        data: configData,
        isLoading: apiLoading,
        isError,
        error,
    } = useGetPublicPatientProfileConfigQuery(
        { lang, userType },
        { skip: !!configOverride }
    );

    // Use configOverride if provided, otherwise use API data
    const resolvedData = configOverride || configData;
    const isLoading = configOverride ? false : apiLoading;

    // After transformResponse, resolvedData = { page_config: {...}, field_configs: [...], data_sources: {...} }
    const pageConfig = resolvedData?.page_config || null;
    const fieldConfigs = resolvedData?.field_configs || [];
    const dataSources = resolvedData?.data_sources || {};

    // Debug logging removed — was spamming console on every re-render

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

    // -- Field helpers --

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

    const getFieldOptions = (fieldKey) => {
        const f = fieldMap[fieldKey];
        return f?.options || [];
    };

    // -- Section helpers --

    const isSectionVisible = (sectionKey) => {
        if (!pageConfig) return true;
        const s = sectionMap[sectionKey];
        return s ? s.is_present !== false : true;
    };

    const getSectionLabel = (sectionKey, defaultLabel) => {
        const s = sectionMap[sectionKey];
        return s?.label || defaultLabel;
    };

    // -- Page-level settings --

    const pageTitle = pageConfig?.page_title || 'Patient Profile & Settings';
    const pageSubtitle = pageConfig?.page_subtitle || '';
    const primaryColor = pageConfig?.primary_color || '#1976d2';
    const secondaryColor = pageConfig?.secondary_color || '#dc004e';
    const backgroundColor = pageConfig?.background_color || '#ffffff';
    const cardBackgroundColor = pageConfig?.card_background_color || '#ffffff';
    const primaryButtonText = pageConfig?.primary_button_text || 'Save Profile';
    const footerText = pageConfig?.footer_text || '';
    const footerIsPresent = pageConfig?.footer_is_present ?? false;

    return {
        isLoading,
        isError,
        hasConfig: !!pageConfig,
        pageConfig,
        fieldConfigs,
        dataSources,
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
        cardBackgroundColor,
        primaryButtonText,
        footerText,
        footerIsPresent,
    };
};

export default usePatientProfilePageConfig;
