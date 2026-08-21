/**
 * Hook the public DoctorSignupPage uses to fetch its live config.
 *
 * Implementation note: we go via the shared ``axiosInstance`` (NOT
 * RTK Query) because the signup page is an anonymous endpoint that
 * runs before the user is authenticated. The RTK Query path was found
 * to get tangled with the global 401 refresh-then-retry interceptor
 * when the page first mounts in a logged-out state, leaving the query
 * stuck in ``status: pending`` even after the server returned 200.
 * A bare axios call sidesteps that pipeline entirely while still
 * benefiting from the X-Tenant-* header logic baked into the
 * instance.
 *
 * Returns:
 *   {
 *     config:       full payload { page_config, field_configs, data_sources,
 *                                   locked_field_keys } or null while loading,
 *     loading:      boolean,
 *     error:        any,
 *     getField:     (fieldKey) => fieldConfigRow | null,
 *     getFieldProp: (fieldKey, prop, fallback) => string,
 *     getOptions:   (dataSource) => Array<{id, name, ...}>,
 *     isPresent:    (fieldKey, defaultIfMissing = true) => boolean,
 *     isLocked:     (fieldKey) => boolean,
 *   }
 *
 * Designed to fail SAFE: if the config request fails or the field key
 * isn't in the response, callers fall back to their hardcoded defaults
 * so the signup page keeps rendering even if the backend is down.
 */
import { useEffect, useMemo, useState } from 'react';
import axiosInstance from '../../../api/axiosConfig';

export default function useDoctorSignupPageConfig(lang = 'en') {
    const [config, setConfig] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        axiosInstance
            .get('/api/doctor-signup-config/public/doctor_signup', { params: { lang } })
            .then((res) => {
                if (cancelled) return;
                // The standard envelope is {success, data: {...}, message}.
                // axiosBaseQuery elsewhere does the unwrap via
                // transformResponse, but here we do it inline.
                const payload = res?.data?.data ?? res?.data ?? null;
                setConfig(payload);
                setLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err);
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [lang]);

    return useMemo(() => {
        const fieldConfigs = Array.isArray(config?.field_configs) ? config.field_configs : [];
        const dataSources = config?.data_sources || {};
        const lockedSet = new Set(config?.locked_field_keys || []);

        const fieldsByKey = new Map();
        for (const f of fieldConfigs) {
            if (f && f.field_key) fieldsByKey.set(f.field_key, f);
        }

        const getField = (fieldKey) => fieldsByKey.get(fieldKey) || null;

        const getFieldProp = (fieldKey, prop, fallback = '') => {
            const f = fieldsByKey.get(fieldKey);
            if (!f) return fallback;
            const v = f[prop];
            return v === undefined || v === null || v === '' ? fallback : v;
        };

        const getOptions = (dataSource) =>
            (dataSource && dataSources[dataSource]) || [];

        const isPresent = (fieldKey, defaultIfMissing = true) => {
            const f = fieldsByKey.get(fieldKey);
            if (!f) return defaultIfMissing;
            return f.is_present !== false;
        };

        const isLocked = (fieldKey) => lockedSet.has(fieldKey);

        return {
            config,
            loading,
            error,
            getField,
            getFieldProp,
            getOptions,
            isPresent,
            isLocked,
        };
    }, [config, loading, error]);
}
