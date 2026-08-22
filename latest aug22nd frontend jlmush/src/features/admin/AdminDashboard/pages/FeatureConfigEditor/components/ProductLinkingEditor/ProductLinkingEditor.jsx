/**
 * ProductLinkingEditor — "Product & provider linking" section of the feature
 * editor.
 *
 * This edits the SAME data as the standalone "Feature-Product Linking" lab page
 * (`/dashboard/admin/feature-product-linking`): both read and write the shared
 * `FeatureProductLink` store (per offering). So a link added/removed here shows
 * up on the lab page and vice-versa — the two surfaces stay in sync.
 *
 * The links are GLOBAL per offering (not per landing feature): linking a
 * doctor/team to an offering+product records who fulfils that offering, once,
 * for the whole tenant. This section therefore loads every offering's links,
 * lets you add/remove, and saves each touched offering wholesale — the same
 * per-offering PUT the lab page uses. It is back-office routing data and is
 * never rendered on the public page.
 *
 * The lab page also carries per-provider "features" tags + two priority-formula
 * placeholders; this section doesn't surface those, but PRESERVES them on every
 * row so saving here never wipes what the lab set.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Box, Paper, Typography, Button, IconButton, Stack, Chip, MenuItem,
    TextField, Autocomplete, Alert, Divider, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import {
    useGetAdminProductsQuery,
    useGetFeatureProductProvidersQuery,
    useGetAllFeatureProductLinksQuery,
    useSaveFeatureProductLinksMutation,
} from '../../../../../api/marketplaceEndpoints';
import { useGetGroupOfferingsQuery } from '../../../../../api/groupOfferingEndpoints';
import {
    SCHEDULABLE_CONSULTATION_TYPES,
} from '../../../../../../service-provider/ProfileSetting/constants/consultationTypes';

// Offering options: every schedulable consultation type + Service + Group
// Offering. Keys match the backend ``?offering=`` provider-lookup tokens.
const OFFERINGS = [
    ...SCHEDULABLE_CONSULTATION_TYPES.map((t) => ({
        key: t.value, label: t.label, kind: 'consultation', color: t.color,
    })),
    { key: 'service', label: 'Service', kind: 'service', color: '#059669' },
    { key: 'group', label: 'Group Offering', kind: 'group', color: '#d97706' },
];
const OFFERING_BY_KEY = Object.fromEntries(OFFERINGS.map((o) => [o.key, o]));
const offeringLabel = (k) => OFFERING_BY_KEY[k]?.label || k || 'Offering';
const offeringColor = (k) => OFFERING_BY_KEY[k]?.color || '#607d8b';

const rowProviderId = (r) => String(r.team_id || r.doctor_id || '');
const linkKey = (offering, productId, providerId) =>
    `${offering}|${productId || ''}|${providerId}`;

// One stored FeatureProductLink → the editor's row shape. Keeps the lab-only
// extras (features tags, priority formulas, plan_ref) so a save here preserves
// them.
const linkToRow = (l) => ({
    offering: l.offering_key,
    product_id: l.product_id || null,
    product_name: l.product_name || null,
    provider_name: l.doctor_name || l.team_name || null,
    doctor_id: l.doctor_id || null,
    team_id: l.team_id || null,
    team_members: l.team_members || [],
    features: Array.isArray(l.features) ? l.features : [],
    formula1: l.formula1 || '',
    formula2: l.formula2 || '',
    plan_ref: l.plan_ref || null,
});

export default function ProductLinkingEditor({ disabled = false }) {
    const { data: products = [] } = useGetAdminProductsQuery();
    const { data: groupOfferings = [] } = useGetGroupOfferingsQuery('published');
    const { data: linksByOffering = {}, isLoading, isFetching } =
        useGetAllFeatureProductLinksQuery();
    const [saveLinks, { isLoading: saving }] = useSaveFeatureProductLinksMutation();

    const [rows, setRows] = useState([]);
    const [dirty, setDirty] = useState(false);
    const [savedTick, setSavedTick] = useState(false);
    const [error, setError] = useState('');

    // Which offerings existed at load — so a save also clears any we emptied.
    const [loadedOfferings, setLoadedOfferings] = useState(() => new Set());

    // (Re)hydrate local rows from the shared store whenever it (re)loads — e.g.
    // after the lab page saves and invalidates the cache. Skipped mid-fetch.
    useEffect(() => {
        if (isFetching) return;
        const flat = [];
        const offs = new Set();
        Object.entries(linksByOffering || {}).forEach(([offering, list]) => {
            offs.add(offering);
            (list || []).forEach((l) => flat.push(linkToRow(l)));
        });
        setRows(flat);
        setLoadedOfferings(offs);
        setDirty(false);
    }, [linksByOffering, isFetching]);

    // "Add link" panel state.
    const [offeringKey, setOfferingKey] = useState('');
    const [productId, setProductId] = useState('');
    const [provider, setProvider] = useState(null);

    const offering = OFFERING_BY_KEY[offeringKey] || null;
    const grouped = !!offering && (offering.kind === 'service' || offering.kind === 'group');

    const productOptions = useMemo(() => {
        if (!offering) return [];
        if (offering.kind === 'service') {
            return products.filter((p) => !p.is_group_service)
                .map((p) => ({ id: String(p.id), label: p.name }));
        }
        if (offering.kind === 'group') {
            return (groupOfferings || []).filter((o) => o.backing_product_id)
                .map((o) => ({ id: String(o.backing_product_id), label: o.name }));
        }
        return [];
    }, [offering, products, groupOfferings]);

    const { data: rawProviders = [], isFetching: loadingProviders } =
        useGetFeatureProductProvidersQuery(
            {
                offering: offeringKey,
                productId: grouped ? productId : null,
                flat: offering?.kind !== 'group',
            },
            { skip: !offering || (grouped && !productId) },
        );
    const providerOptions = rawProviders.map((p) => ({
        id: String(p.id), label: p.name, isTeam: !!p.is_team, members: p.members || [],
    }));

    const mutate = (next) => {
        setRows(next.map((r, i) => ({ ...r, display_order: i })));
        setDirty(true);
        setSavedTick(false);
    };
    const resetPanel = () => { setProvider(null); };

    const addLink = () => {
        if (disabled || !offering || !provider) return;
        if (grouped && !productId) return;
        const pid = grouped ? String(productId) : null;
        const key = linkKey(offeringKey, pid, provider.id);
        if (rows.some((r) => linkKey(r.offering, r.product_id, rowProviderId(r)) === key)) {
            resetPanel();
            return; // already linked — no dupes
        }
        const base = provider.isTeam
            ? { team_id: String(provider.id), team_members: provider.members || [] }
            : { doctor_id: String(provider.id) };
        mutate([...rows, {
            offering: offeringKey,
            product_id: pid,
            product_name: grouped
                ? (productOptions.find((p) => p.id === pid)?.label || null)
                : null,
            provider_name: provider.label,
            features: [], formula1: '', formula2: '',
            plan_ref: grouped
                ? (productOptions.find((p) => p.id === pid)?.label || null) : null,
            ...base,
        }]);
        resetPanel();
    };

    const removeAt = (idx) => mutate(rows.filter((_, i) => i !== idx));

    const handleSave = async () => {
        setError('');
        // Save every offering that has rows now, plus any that had rows at load
        // and were emptied (so the wholesale PUT clears them).
        const offs = new Set([
            ...loadedOfferings,
            ...rows.map((r) => r.offering),
        ]);
        try {
            await Promise.all([...offs].map((off) => {
                const offRows = rows
                    .filter((r) => r.offering === off)
                    .map((r, i) => ({
                        plan_ref: r.plan_ref || null,
                        doctor_id: r.doctor_id || null,
                        team_id: r.team_id || null,
                        product_id: r.product_id || null,
                        features: Array.isArray(r.features) ? r.features : [],
                        formula1: r.formula1 || '',
                        formula2: r.formula2 || '',
                        display_order: i,
                    }));
                return saveLinks({ offering: off, rows: offRows }).unwrap();
            }));
            setDirty(false);
            setSavedTick(true);
        } catch (e) {
            setError(e?.data?.message || e?.data?.error || 'Save failed');
        }
    };

    const displayGroups = useMemo(() => {
        const map = new Map();
        rows.forEach((r, idx) => {
            const gk = `${r.offering}|${r.product_id || ''}`;
            if (!map.has(gk)) {
                map.set(gk, {
                    offering: r.offering,
                    product_id: r.product_id || null,
                    product_name: r.product_name || null,
                    items: [],
                });
            }
            map.get(gk).items.push({ ...r, _idx: idx });
        });
        return [...map.values()];
    }, [rows]);

    const canAdd = !!offering && !!provider && (!grouped || !!productId);

    return (
        <Box>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                    Shared with the Feature-Product Linking page — changes here reflect there.
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                {isFetching && <CircularProgress size={16} />}
                {savedTick && !dirty && (
                    <Chip size="small" color="success" variant="outlined" label="Saved" />
                )}
                <Button
                    size="small" variant="contained" startIcon={<SaveIcon />}
                    onClick={handleSave} disabled={disabled || saving || !dirty}
                >
                    {saving ? 'Saving…' : 'Save links'}
                </Button>
            </Stack>
            {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box>
            ) : rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    No product links yet. Link an offering + product to the teams or
                    doctors that deliver it — this is back-office routing data and does
                    not appear on the public page.
                </Typography>
            ) : (
                displayGroups.map((g) => (
                    <Paper
                        key={`${g.offering}|${g.product_id || ''}`}
                        variant="outlined"
                        sx={{ p: 1.5, mb: 1, borderRadius: 2, borderLeft: `4px solid ${offeringColor(g.offering)}` }}
                    >
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
                            <Chip
                                size="small"
                                label={offeringLabel(g.offering)}
                                sx={{ bgcolor: `${offeringColor(g.offering)}18`, color: offeringColor(g.offering), fontWeight: 600 }}
                            />
                            {g.product_name && (
                                <Typography variant="body2" fontWeight={600}>{g.product_name}</Typography>
                            )}
                        </Stack>
                        <Stack spacing={0.5}>
                            {g.items.map((it) => (
                                <Stack key={it._idx} direction="row" alignItems="center" spacing={1}>
                                    <Chip
                                        size="small"
                                        variant="outlined"
                                        color={it.team_id ? 'warning' : 'default'}
                                        label={it.team_id ? `Team · ${it.provider_name || 'Team'}` : (it.provider_name || 'Doctor')}
                                    />
                                    {it.team_id && (it.team_members || []).length > 0 && (
                                        <Typography variant="caption" color="text.secondary">
                                            {it.team_members.join(', ')}
                                        </Typography>
                                    )}
                                    <Box sx={{ flexGrow: 1 }} />
                                    <IconButton size="small" color="error" disabled={disabled} onClick={() => removeAt(it._idx)}>
                                        <DeleteIcon fontSize="inherit" />
                                    </IconButton>
                                </Stack>
                            ))}
                        </Stack>
                    </Paper>
                ))
            )}

            <Divider sx={{ my: 1.5 }} />

            {/* Add-link panel: offering → (product) → provider → Add. */}
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: '#fafafa' }}>
                <Stack direction="row" spacing={1.5} alignItems="flex-start" flexWrap="wrap" useFlexGap>
                    <TextField
                        select size="small" label="Offering type" sx={{ minWidth: 200 }}
                        value={offeringKey} disabled={disabled}
                        onChange={(e) => { setOfferingKey(e.target.value); setProductId(''); setProvider(null); }}
                    >
                        <MenuItem value=""><em>Select…</em></MenuItem>
                        {OFFERINGS.map((o) => (
                            <MenuItem key={o.key} value={o.key}>{o.label}</MenuItem>
                        ))}
                    </TextField>

                    {grouped && (
                        <TextField
                            select size="small"
                            label={offering.kind === 'group' ? 'Group offering' : 'Service'}
                            sx={{ minWidth: 220 }}
                            value={productId} disabled={disabled || !offering}
                            onChange={(e) => { setProductId(e.target.value); setProvider(null); }}
                        >
                            <MenuItem value=""><em>Select…</em></MenuItem>
                            {productOptions.map((p) => (
                                <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>
                            ))}
                        </TextField>
                    )}

                    <Autocomplete
                        size="small" sx={{ minWidth: 240 }}
                        options={providerOptions}
                        getOptionLabel={(o) => o.label || ''}
                        isOptionEqualToValue={(o, v) => o.id === v.id}
                        value={provider}
                        onChange={(_, v) => setProvider(v)}
                        disabled={disabled || !offering || (grouped && !productId)}
                        loading={loadingProviders}
                        noOptionsText={
                            offering?.kind === 'group'
                                ? 'No team offers this product yet'
                                : (grouped && !productId ? 'Pick a product first' : 'No providers')
                        }
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label={offering?.kind === 'group' ? 'Team' : 'Doctor'}
                                placeholder="Search providers"
                            />
                        )}
                    />

                    <Button
                        variant="contained" startIcon={<AddIcon />}
                        onClick={addLink} disabled={!canAdd || disabled}
                    >
                        Add
                    </Button>
                </Stack>
                {offering?.kind === 'group' && (
                    <Alert severity="info" sx={{ mt: 1 }} icon={false}>
                        A group offering is delivered by a team — pick the team that
                        fulfils this offering.
                    </Alert>
                )}
            </Paper>
        </Box>
    );
}
