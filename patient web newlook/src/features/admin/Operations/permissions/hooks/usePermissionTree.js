/**
 * usePermissionTree — state for the roles-and-permissions matrix.
 *
 * The invariant this hook exists to protect: **a grant lives on a leaf and
 * nowhere else**. ``grants`` is keyed by leaf path only. A branch's checkboxes
 * are computed from the leaves beneath it every render, so there is no second
 * copy of the truth to fall out of sync — collapsing a branch, switching roles
 * and re-expanding can't resurrect a stale roll-up, and a three-level branch
 * needs no different handling from a two-level one. The backend stores leaves
 * only for the same reason.
 *
 * The tree comes in as a prop rather than from a local constant: for the live
 * verticals it is fetched from the backend catalog, and for the preview ones
 * it is a local tree. Neither case is this hook's business.
 *
 * Drafts are kept PER ROLE, so switching the role dropdown parks the current
 * ticks and restores whatever that role had rather than wiping the screen — an
 * operator comparing two roles side by side is the normal way this gets used.
 * A role's draft is seeded from the server the first time its saved grants
 * arrive, and never re-seeded after that, so a background refetch can't
 * silently discard edits in progress.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    ACTION_COLUMNS, GRANT_COLUMNS, DEFAULT_DATA_RANGE,
} from '../constants/permissionTree';

const EMPTY_GRANT = ACTION_COLUMNS.reduce(
    (acc, col) => ({ ...acc, [col.key]: false }),
    { data_range: DEFAULT_DATA_RANGE },
);

const pathOf = (parentPath, key) => (parentPath ? `${parentPath}.${key}` : key);

/** Server rows -> the draft map this hook works in. */
const fromServer = (permissions) => {
    const map = {};
    (permissions || []).forEach((p) => {
        const grant = { data_range: p.data_range || DEFAULT_DATA_RANGE };
        ACTION_COLUMNS.forEach((col) => { grant[col.key] = !!p[col.key]; });
        map[p.module] = grant;
    });
    return map;
};

/**
 * One walk of the tree that precomputes everything the table needs:
 *  - ``leavesByPath``  every node -> the leaf paths under it (a leaf maps to
 *                      itself, which is what lets branch and leaf share one
 *                      toggle path)
 *  - ``labelByPath``   for the payload
 *  - ``allLeaves``     the column select-all target
 *  - ``branchPaths``   the expand-all target
 */
const indexTree = (nodes) => {
    const leavesByPath = {};
    const labelByPath = {};
    const allLeaves = [];
    const branchPaths = [];

    const walk = (node, parentPath) => {
        const path = pathOf(parentPath, node.key);
        labelByPath[path] = node.label;
        const children = node.children || [];
        if (!children.length) {
            leavesByPath[path] = [path];
            allLeaves.push(path);
            return [path];
        }
        branchPaths.push(path);
        const leaves = children.flatMap((child) => walk(child, path));
        leavesByPath[path] = leaves;
        return leaves;
    };

    nodes.forEach((node) => walk(node, ''));
    return { leavesByPath, labelByPath, allLeaves, branchPaths };
};

/** Visible rows, depth-first, descending only into expanded branches. */
const buildRows = (nodes, expanded, depth, parentPath, out) => {
    nodes.forEach((node) => {
        const path = pathOf(parentPath, node.key);
        const children = node.children || [];
        out.push({ path, label: node.label, depth, isLeaf: !children.length });
        if (children.length && expanded.has(path)) {
            buildRows(children, expanded, depth + 1, path, out);
        }
    });
    return out;
};

const usePermissionTree = ({ tree, roleKey, savedPermissions }) => {
    const nodes = useMemo(() => tree || [], [tree]);

    const { leavesByPath, labelByPath, allLeaves, branchPaths } = useMemo(
        () => indexTree(nodes), [nodes],
    );

    // { [roleKey]: { [leafPath]: grant } } — parked drafts, see the header.
    const [draftsByRole, setDraftsByRole] = useState({});
    // Which roles have already taken their server state. A ref, not state:
    // it must be readable inside the same effect that sets it, and changing
    // it should never on its own cause a render.
    const hydrated = useRef({});

    // Groups start open (you can see the modules) and modules start closed, so
    // the third level is something you deliberately open — which is exactly
    // the "click Profile Details to reveal Personal & Professional Details"
    // flow this screen is built around.
    const [expanded, setExpanded] = useState(() => new Set());
    const treeSignature = nodes.map((g) => g.key).join('|');
    useEffect(() => {
        setExpanded(new Set(nodes.map((group) => group.key)));
    }, [treeSignature]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Seed a role's draft from the server exactly once. Re-seeding on every
    // refetch would throw away edits in progress the moment any cache
    // invalidation touched this query.
    useEffect(() => {
        if (!roleKey || savedPermissions === undefined) return;
        if (hydrated.current[roleKey]) return;
        hydrated.current[roleKey] = true;
        setDraftsByRole((prev) => ({ ...prev, [roleKey]: fromServer(savedPermissions) }));
    }, [roleKey, savedPermissions]);

    const grants = draftsByRole[roleKey] || {};
    const grantFor = useCallback(
        (leafPath) => grants[leafPath] || EMPTY_GRANT, [grants],
    );

    /** Apply ``mutate`` to each of ``leafPaths`` in the CURRENT role's draft. */
    const patchLeaves = useCallback((leafPaths, mutate) => {
        setDraftsByRole((prev) => {
            const current = prev[roleKey] || {};
            const next = { ...current };
            leafPaths.forEach((leafPath) => {
                next[leafPath] = mutate(next[leafPath] || EMPTY_GRANT, leafPath);
            });
            return { ...prev, [roleKey]: next };
        });
    }, [roleKey]);

    // Full Access is a shorthand for "every column in this row", so it writes
    // them all; unticking any single column drops Full Access again, otherwise
    // the header would claim more than the row grants.
    const applyColumn = useCallback((grant, column, value) => {
        if (column === 'full_access') {
            const next = { ...grant, full_access: value };
            GRANT_COLUMNS.forEach((key) => { next[key] = value; });
            return next;
        }
        const next = { ...grant, [column]: value };
        if (!value) next.full_access = false;
        else if (GRANT_COLUMNS.every((key) => next[key])) next.full_access = true;
        return next;
    }, []);

    /**
     * Whether a column is on for a node. ``all``/``some`` drive the branch
     * checkbox's checked/indeterminate pair; a leaf is just ``all``.
     */
    const columnState = useCallback((path, column) => {
        const leaves = leavesByPath[path] || [];
        if (!leaves.length) return { all: false, some: false };
        let on = 0;
        leaves.forEach((leafPath) => {
            if ((grants[leafPath] || EMPTY_GRANT)[column]) on += 1;
        });
        return { all: on === leaves.length, some: on > 0 && on < leaves.length };
    }, [grants, leavesByPath]);

    /**
     * One handler for branch and leaf alike: toggle to the opposite of "all
     * leaves already have it". So a half-ticked branch fills in rather than
     * clearing — the reading an operator expects from a dash.
     */
    const toggle = useCallback((path, column) => {
        const leaves = leavesByPath[path] || [];
        const { all } = columnState(path, column);
        patchLeaves(leaves, (grant) => applyColumn(grant, column, !all));
    }, [leavesByPath, columnState, patchLeaves, applyColumn]);

    /** Header click — same toggle, applied to every leaf in the tree. */
    const toggleColumnAll = useCallback((column) => {
        const all = allLeaves.every((leafPath) => (grants[leafPath] || EMPTY_GRANT)[column]);
        patchLeaves(allLeaves, (grant) => applyColumn(grant, column, !all));
    }, [allLeaves, grants, patchLeaves, applyColumn]);

    /**
     * A branch's data range is only meaningful when its leaves agree; when
     * they don't the select shows blank ("Mixed") rather than picking a winner
     * and silently misreporting the others.
     */
    const dataRangeOf = useCallback((path) => {
        const leaves = leavesByPath[path] || [];
        const first = (grants[leaves[0]] || EMPTY_GRANT).data_range;
        const uniform = leaves.every(
            (leafPath) => (grants[leafPath] || EMPTY_GRANT).data_range === first,
        );
        return uniform ? first : '';
    }, [grants, leavesByPath]);

    const setDataRange = useCallback((path, value) => {
        patchLeaves(leavesByPath[path] || [], (grant) => ({ ...grant, data_range: value }));
    }, [leavesByPath, patchLeaves]);

    const toggleExpand = useCallback((path) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
        });
    }, []);

    const expandAll = useCallback(() => setExpanded(new Set(branchPaths)), [branchPaths]);
    const collapseAll = useCallback(() => setExpanded(new Set()), []);

    const rows = useMemo(
        () => buildRows(nodes, expanded, 0, '', []), [nodes, expanded],
    );

    /**
     * Discard edits and go back to what's stored. Once there's a server,
     * "reset" means revert rather than blank — blanking a saved role and
     * calling it a reset would be one Save away from revoking everything.
     * With no server (the preview entities) saved is empty, so it clears.
     */
    const revert = useCallback(() => {
        setDraftsByRole((prev) => ({ ...prev, [roleKey]: fromServer(savedPermissions) }));
    }, [roleKey, savedPermissions]);

    // How much of the tree this role can touch at all — the honest one-line
    // answer to "what does this role actually get?".
    const grantedLeafCount = useMemo(() => allLeaves.filter(
        (leafPath) => ACTION_COLUMNS.some((col) => (grants[leafPath] || EMPTY_GRANT)[col.key]),
    ).length, [allLeaves, grants]);

    /**
     * The rows a save sends. Only leaves with at least one grant are included
     * — an all-false row is the absence of a permission, not a permission to
     * do nothing, and the backend drops them anyway.
     */
    const buildPayload = useCallback(() => allLeaves
        .filter((leafPath) => ACTION_COLUMNS.some(
            (col) => (grants[leafPath] || EMPTY_GRANT)[col.key],
        ))
        .map((leafPath) => ({
            module: leafPath,
            label: labelByPath[leafPath],
            ...ACTION_COLUMNS.reduce((acc, col) => ({
                ...acc, [col.key]: !!(grants[leafPath] || EMPTY_GRANT)[col.key],
            }), {}),
            data_range: (grants[leafPath] || EMPTY_GRANT).data_range || DEFAULT_DATA_RANGE,
        })), [allLeaves, grants, labelByPath]);

    // Compared as canonical strings rather than by tracking edits, so an edit
    // and its undo correctly reads as "not dirty". Each row is flattened to a
    // fixed field order and the rows are sorted, so neither key order nor row
    // order can make identical states look different — which a plain
    // JSON.stringify of the two shapes would.
    const isDirty = useMemo(() => {
        const rowKey = (row) => [
            row.module,
            ...ACTION_COLUMNS.map((col) => (row[col.key] ? '1' : '0')),
            row.data_range || DEFAULT_DATA_RANGE,
        ].join(':');
        const norm = (rows) => rows.map(rowKey).sort().join('|');
        const saved = Object.entries(fromServer(savedPermissions))
            .map(([module, grant]) => ({ module, ...grant }));
        return norm(buildPayload()) !== norm(saved);
    }, [buildPayload, savedPermissions]);

    return {
        rows,
        expanded,
        toggleExpand,
        expandAll,
        collapseAll,
        grantFor,
        columnState,
        toggle,
        toggleColumnAll,
        dataRangeOf,
        setDataRange,
        revert,
        isDirty,
        grantedLeafCount,
        totalLeafCount: allLeaves.length,
        buildPayload,
    };
};

export default usePermissionTree;
