/**
 * useAdminProfilePageConfig — Fetches live admin profile page config
 * and provides helper utilities for field visibility, labels, etc.
 * Mirrors useDoctorProfilePageConfig but uses admin profile config API.
 */
import { useMemo } from 'react';
import { useGetPublicAdminProfileConfigQuery } from '../../api/adminProfileConfigEndpoints';

const useAdminProfilePageConfig = (lang = 'en', userType = 'admin', configOverride = null) => {
    const { data: liveConfig, isLoading, error } = useGetPublicAdminProfileConfigQuery(
        { lang, userType },
        { skip: !!configOverride }
    );

    const config = configOverride || liveConfig;

    const helpers = useMemo(() => {
        const pageConfig = config?.page_config || {};
        const fieldConfigs = config?.field_configs || [];

        // Build lookup maps
        const sectionMap = {};
        const sections = (pageConfig.fields?.sections || []);
        for (const s of sections) {
            sectionMap[s.key] = s;
        }

        // Build flat lookup by field_key (matches how sections call these helpers)
        const fieldMap = {};
        for (const f of fieldConfigs) {
            fieldMap[f.field_key] = f;
        }

        const isSectionVisible = (sectionKey) => {
            const s = sectionMap[sectionKey];
            if (!s) return true;
            return s.is_present !== false;
        };

        const getSectionLabel = (sectionKey, defaultLabel) => {
            const s = sectionMap[sectionKey];
            return s?.label || defaultLabel;
        };

        const isFieldVisible = (fieldKey) => {
            const f = fieldMap[fieldKey];
            if (!f) return true;
            return f.is_present !== false;
        };

        const getFieldLabel = (fieldKey, defaultLabel) => {
            const f = fieldMap[fieldKey];
            return f?.label || defaultLabel;
        };

        const isFieldRequired = (fieldKey, defaultRequired = false) => {
            const f = fieldMap[fieldKey];
            if (!f) return defaultRequired;
            return !!f.required;
        };

        const getFieldPlaceholder = (fieldKey, defaultPlaceholder = '') => {
            const f = fieldMap[fieldKey];
            return f?.placeholder || defaultPlaceholder;
        };

        const getFieldHelperText = (fieldKey, defaultText = '') => {
            const f = fieldMap[fieldKey];
            return f?.helper_text || defaultText;
        };

        const getFieldOptions = (fieldKey) => {
            const f = fieldMap[fieldKey];
            return f?.options || [];
        };

        const getFieldConfig = (fieldKey) => {
            return fieldMap[fieldKey] || null;
        };

        return {
            pageTitle: pageConfig.page_title || 'Admin Profile Settings',
            pageSubtitle: pageConfig.page_subtitle || 'Manage your admin profile',
            primaryColor: pageConfig.primary_color || '#1976d2',
            secondaryColor: pageConfig.secondary_color || '#dc004e',
            backgroundColor: pageConfig.background_color || '#ffffff',
            primaryButtonText: pageConfig.primary_button_text || 'Save Profile',
            sections,
            fieldConfigs,
            isSectionVisible,
            getSectionLabel,
            isFieldVisible,
            getFieldLabel,
            isFieldRequired,
            getFieldPlaceholder,
            getFieldHelperText,
            getFieldOptions,
            getFieldConfig,
        };
    }, [config]);

    return { ...helpers, isLoading, error };
};

export default useAdminProfilePageConfig;
