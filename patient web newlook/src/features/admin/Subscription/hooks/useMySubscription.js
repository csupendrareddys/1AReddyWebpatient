/**
 * useMySubscription — tenant-facing hook for the current tenant's
 * resolved plan.
 *
 * Thin wrapper around ``useGetMyPlanQuery`` that normalises the
 * response into the shape the page needs (flattened feature rows, seat
 * rows) so the component stays purely presentational. Uses RTK Query's
 * cache as the single source of truth — no redundant slice.
 */
import { useMemo } from 'react';

import { useGetMyPlanQuery } from '../../api/pricingEndpoints';


const ROLE_ROWS = ['total', 'super_admin', 'sub_admin', 'provider'];


/** Walk the resolved feature tree into one row per leaf. */
const flattenFeatures = (tree, prefix = '') => {
    const rows = [];
    if (!tree || typeof tree !== 'object') return rows;
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'boolean') {
            rows.push({ path, enabled: value, meta: null });
        } else if (value && typeof value === 'object' && 'enabled' in value) {
            const { enabled, ...rest } = value;
            rows.push({ path, enabled: Boolean(enabled), meta: rest });
        } else if (value && typeof value === 'object') {
            rows.push(...flattenFeatures(value, path));
        }
    }
    return rows;
};


export const useMySubscription = ({ debug = true } = {}) => {
    const { data, error, isLoading, refetch } = useGetMyPlanQuery(debug);

    const featureRows = useMemo(
        () => flattenFeatures(data?.features || {}),
        [data?.features],
    );

    const seatRows = useMemo(() => {
        const counts = data?.counts || {};
        const limits = data?.limits || {};
        const limitSources = data?.limit_sources || {};
        return ROLE_ROWS.map((role) => ({
            role,
            used: counts[role] ?? null,
            limit: limits[role] ?? null,
            sources: limitSources[role] || ['plan'],
        }));
    }, [data?.counts, data?.limits, data?.limit_sources]);

    return {
        resolved: data,
        featureRows,
        seatRows,
        featureSources: data?.feature_sources || {},
        activeAddons: data?.active_addons || [],
        isLoading,
        error,
        refetch,
        hasNoSubscription: error?.data?.code === 'no_active_subscription',
    };
};

export default useMySubscription;
