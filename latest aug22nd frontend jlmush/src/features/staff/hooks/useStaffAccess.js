/**
 * useStaffAccess — ``/api/v1/staff/me`` shaped into the two things the staff
 * surface actually asks of it: which module groups this person can reach, and
 * what they may do inside each one.
 *
 * The tree comes back whole (every module in the vertical) while the grants
 * cover only part of it, so the work here is pruning: a branch survives only
 * if a granted leaf sits somewhere beneath it. Showing an ungranted leaf
 * greyed out would read as "you nearly have this", which is not what an empty
 * grant means — it means nothing was given.
 *
 * The vocabulary (action columns, data-range labels) is imported from the
 * Operations matrix that wrote these rows rather than restated, so the labels
 * a staff member reads are the labels their provider ticked.
 */
import { useMemo } from 'react';

import {
    ACTION_COLUMNS, DATA_RANGES, DEFAULT_DATA_RANGE, ENTITY_LABEL,
} from '../../admin/Operations/permissions/constants/permissionTree';
import { routesFor } from '../constants/staffModules';
import { useGetStaffMeQuery } from '../api/staffEndpoints';

// Every column except ``full_access``, which is a shorthand for the rest.
const ACTIONS = ACTION_COLUMNS.filter((col) => col.key !== 'full_access');

const isOn = (grant, key) => !!(grant.full_access || grant[key]);

/** The actions a grant turns on, in matrix column order. */
export const grantedActions = (grant) => ACTIONS.filter((col) => isOn(grant, col.key));

/** ``LAST_30_DAYS`` -> ``Last 30 Days``; unknown windows print as-is. */
export const dataRangeLabel = (value) => DATA_RANGES.find((r) => r.value === value)?.label || value;

export const verticalLabel = (providerType) => ENTITY_LABEL[providerType] || providerType || '—';

/** Role lists arrive as names or as ``{id, name}`` rows depending on caller. */
const toRoleNames = (roles) => (roles || [])
    .map((role) => (typeof role === 'string' ? role : role?.name))
    .filter(Boolean);

/**
 * Keep only what a grant reaches. Leaves survive if they carry any action at
 * all; branches survive if a surviving leaf is under them.
 */
const prune = (nodes, grants, parentPath) => (nodes || []).reduce((kept, node) => {
    const path = parentPath ? `${parentPath}.${node.key}` : node.key;
    const children = node.children || [];

    if (children.length) {
        const keptChildren = prune(children, grants, path);
        if (keptChildren.length) kept.push({ ...node, path, children: keptChildren });
        return kept;
    }

    const grant = grants[path];
    if (grant) kept.push({ ...node, path, children: [], grant });
    return kept;
}, []);

const flattenLeaves = (nodes) => nodes.flatMap(
    (node) => (node.grant ? [node] : flattenLeaves(node.children)),
);

const useStaffAccess = ({ skip = false } = {}) => {
    // ``skip`` is for callers that mount for providers too — a clinic admin has
    // no staff profile, so asking for one would 403 on every render of a screen
    // they own outright.
    const { data, isLoading, isError, error, refetch } = useGetStaffMeQuery(undefined, { skip });

    // An all-false row is the absence of a permission, not a permission to do
    // nothing — the matrix never saves one, but a union across roles is cheap
    // to defend against here.
    const grants = useMemo(() => {
        const map = {};
        (data?.permissions || []).forEach((perm) => {
            if (!perm?.module) return;
            if (!ACTIONS.some((col) => isOn(perm, col.key))) return;
            map[perm.module] = { ...perm, data_range: perm.data_range || DEFAULT_DATA_RANGE };
        });
        return map;
    }, [data]);

    const groups = useMemo(() => {
        return prune(data?.modules || [], grants, '').map((group) => {
            // A group that is itself a leaf isn't in today's catalog, but the
            // tree is server-owned and may grow one.
            const leaves = group.grant ? [group] : flattenLeaves(group.children);
            return {
                ...group,
                leaves,
                canView: leaves.some((leaf) => isOn(leaf.grant, 'can_view')),
            };
        });
    }, [data, grants]);

    const staff = data?.staff || null;
    const provider = data?.provider || null;

    // Screens this person can actually open, as opposed to modules they hold a
    // grant on. The two differ, and the dashboard says so rather than linking
    // to pages that don't exist.
    const screens = useMemo(
        () => routesFor(provider?.type, grants),
        [provider?.type, grants],
    );

    return {
        isLoading,
        isError,
        error,
        refetch,
        staff,
        provider,
        roles: toRoleNames(data?.roles?.length ? data.roles : staff?.roles),
        groups,
        grants,
        screens,
        /** Does this person hold ``action`` on ``module``? */
        can: (module, action = 'can_view') => {
            const grant = grants[module];
            return !!grant && !!(grant.full_access || grant[action]);
        },
        grantedLeafCount: groups.reduce((total, group) => total + group.leaves.length, 0),
    };
};

export default useStaffAccess;
