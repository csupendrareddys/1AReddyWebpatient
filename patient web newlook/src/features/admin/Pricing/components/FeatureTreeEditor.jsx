/**
 * FeatureTreeEditor — structured editor for the plan/addon feature tree.
 *
 * Why this is structured (not a JSON textarea):
 *   * Backend whitelists every legal path in ``ALLOWED_FEATURE_PATHS``
 *     (Backend/app/api/pricing/service.py). Anything outside the list
 *     is rejected on save — operators typing free-form JSON would
 *     have to know the schema by heart.
 *   * The whitelist is fetched at runtime from
 *     ``GET /api/platform/feature-paths`` so a new path added in
 *     code shows up here without a frontend change.
 *
 * Output shape: nested ``{enabled: bool}`` leaves matching the
 * format ``_walk_features`` accepts. Categories without any toggled
 * leaf are omitted from the output (cleaner DB).
 *
 * Usage::
 *
 *   <FeatureTreeEditor
 *     value={planForm.features || {}}
 *     onChange={(features) => setPlanForm({ ...planForm, features })}
 *   />
 */
import { useMemo } from 'react';
import {
    Accordion, AccordionDetails, AccordionSummary, Box, Chip,
    CircularProgress, FormControlLabel, Stack, Switch, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import { useGetFeaturePathsQuery } from '../../api/pricingEndpoints';


/** Read a deeply nested ``{enabled: bool}`` leaf for a dotted path. */
const _isEnabled = (tree, path) => {
    if (!tree) return false;
    const parts = path.split('.');
    let node = tree;
    for (const part of parts) {
        if (!node || typeof node !== 'object') return false;
        node = node[part];
    }
    if (typeof node === 'boolean') return node;
    if (node && typeof node === 'object') return Boolean(node.enabled);
    return false;
};

/**
 * Set a path inside the tree to ``{enabled: bool}``. Returns a new
 * tree (no mutation). Removes empty branches when toggling off so
 * the saved JSON stays compact.
 */
const _setEnabled = (tree, path, enabled) => {
    const parts = path.split('.');
    const next = JSON.parse(JSON.stringify(tree || {}));

    let node = next;
    for (let i = 0; i < parts.length - 1; i += 1) {
        const key = parts[i];
        if (!node[key] || typeof node[key] !== 'object') {
            node[key] = {};
        }
        node = node[key];
    }
    const leafKey = parts[parts.length - 1];
    if (enabled) {
        // Preserve metadata if the leaf was a dict (e.g. {enabled, control}).
        const existing = node[leafKey];
        if (existing && typeof existing === 'object') {
            node[leafKey] = { ...existing, enabled: true };
        } else {
            node[leafKey] = { enabled: true };
        }
    } else {
        // Toggling off: prune the leaf entirely so the saved JSON
        // doesn't carry a dangling ``{enabled: false}``.
        delete node[leafKey];
    }
    return next;
};

/** Group dotted paths by their leading segment for the accordions. */
const _groupByCategory = (paths) => {
    const groups = {};
    for (const p of paths) {
        const [category] = p.split('.');
        if (!groups[category]) groups[category] = [];
        groups[category].push(p);
    }
    return groups;
};

/** Pretty-print the trailing segment of a path for the toggle label. */
const _humanise = (segment) =>
    segment
        .split('_')
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(' ');


const FeatureTreeEditor = ({
    value,
    onChange,
    disabled = false,
    // Optional override — caller supplies its own RTK Query hook. The
    // default is the platform-owner ``/api/platform/feature-paths``
    // endpoint, but the tenant-admin TenantProviderPlansAdmin reuses
    // this component with the tenant-scoped hook so SUPER_ADMIN can
    // load the whitelist without PLATFORM_OWNER auth.
    usePathsHook = useGetFeaturePathsQuery,
    // Optional arg forwarded into the paths hook. Used by the
    // tenant-admin TenantProviderPlansAdmin to scope the whitelist to
    // a vertical (doctor / clinic / hospital) so the editor doesn't
    // surface tenant-level paths (subdomain, landing builder,
    // marketplace listings) that shouldn't apply to a provider plan.
    // The default hook (``useGetFeaturePathsQuery``, platform-owner)
    // takes no args and ignores the value — passing it is harmless.
    pathsHookArg = undefined,
}) => {
    const { data: paths = [], isLoading, error } = usePathsHook(pathsHookArg);

    const groups = useMemo(() => _groupByCategory(paths), [paths]);

    if (isLoading) {
        return (
            <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={16} />
                <Typography variant="caption" color="text.secondary">
                    Loading feature whitelist…
                </Typography>
            </Stack>
        );
    }

    if (error) {
        return (
            <Typography variant="caption" color="error">
                Failed to load feature paths.
            </Typography>
        );
    }

    return (
        <Box>
            {Object.entries(groups).map(([category, categoryPaths]) => {
                const enabledCount = categoryPaths.filter((p) =>
                    _isEnabled(value, p),
                ).length;
                return (
                    <Accordion
                        key={category}
                        disableGutters
                        square
                        sx={{ '&:before': { display: 'none' }, boxShadow: 'none', borderTop: 1, borderColor: 'divider' }}
                    >
                        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Stack direction="row" spacing={1} alignItems="center">
                                <Typography sx={{ fontWeight: 600 }}>
                                    {_humanise(category)}
                                </Typography>
                                <Chip
                                    size="small"
                                    label={`${enabledCount} / ${categoryPaths.length}`}
                                    color={enabledCount > 0 ? 'primary' : 'default'}
                                    variant={enabledCount > 0 ? 'filled' : 'outlined'}
                                />
                            </Stack>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Stack>
                                {categoryPaths.map((path) => {
                                    const leaf = path.split('.').slice(1).join('.');
                                    const enabled = _isEnabled(value, path);
                                    return (
                                        <FormControlLabel
                                            key={path}
                                            control={
                                                <Switch
                                                    checked={enabled}
                                                    disabled={disabled}
                                                    onChange={(e) =>
                                                        onChange(
                                                            _setEnabled(value, path, e.target.checked),
                                                        )
                                                    }
                                                />
                                            }
                                            label={
                                                <Stack>
                                                    <Typography variant="body2">
                                                        {_humanise(leaf)}
                                                    </Typography>
                                                    <Typography variant="caption" color="text.secondary">
                                                        {path}
                                                    </Typography>
                                                </Stack>
                                            }
                                        />
                                    );
                                })}
                            </Stack>
                        </AccordionDetails>
                    </Accordion>
                );
            })}
        </Box>
    );
};

export default FeatureTreeEditor;
