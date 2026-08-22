/**
 * FeatureProductLinking — SUPER_ADMIN "Feature ↔ Product Linking" surface.
 *
 * Pure-frontend / UI-only for now (no backend endpoints). Two-level drill-down:
 *   1. Offering cards  — every consultation type + Service + Group Offering.
 *   2. Linking table   — attach features + priority-formula placeholders per
 *                        provider. The table shape depends on the offering:
 *
 *   • Consultation types (audio / video / chat / …) → FLAT table, one row per
 *     doctor. A doctor can be attached to multiple features.
 *
 *   • Service → GROUPED table. Each service plan (e.g. "service_plan_1
 *     (Medical Certificate)") groups the providers attached to it (doc_1…doc_n).
 *
 *   • Group Offering → GROUPED table. Each group-service plan (e.g.
 *     "group_service_plan_1 (Longevity)") groups its team members.
 *
 * All seed content is mock/sample data. When the linking API lands, swap the
 * `build*` generators for RTK Query hooks keyed on the offering.
 */
import { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Grid, Stack, Breadcrumbs, Link, Button, Chip,
    Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
    Divider, TextField, Snackbar, Alert, Autocomplete, IconButton, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useGetDoctorsQuery } from '../../../api/doctorsEndpoints';
import {
    useGetFeatureProductLinksQuery,
    useSaveFeatureProductLinksMutation,
    useGetAdminProductsQuery,
    useGetLandingFeatureOptionsQuery,
    useGetFeatureProductProvidersQuery,
} from '../../../api/marketplaceEndpoints';
import { useGetGroupOfferingsQuery } from '../../../api/groupOfferingEndpoints';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import VideocamIcon from '@mui/icons-material/Videocam';
import ChatIcon from '@mui/icons-material/Chat';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import HomeIcon from '@mui/icons-material/Home';
import FestivalIcon from '@mui/icons-material/Festival';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import GroupsIcon from '@mui/icons-material/Groups';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import {
    SCHEDULABLE_CONSULTATION_TYPES,
} from '../../../../service-provider/ProfileSetting/constants/consultationTypes';

const SERVICE_COLOR = '#059669';
const GROUP_COLOR = '#d97706';

const CONSULT_ICONS = {
    audio: HeadphonesIcon,
    video: VideocamIcon,
    chat: ChatIcon,
    complete: LocalHospitalIcon,
    home_visit: HomeIcon,
    camp: FestivalIcon,
};

// ── Level 1: offering cards ────────────────────────────────────────────────
// Consultation types come straight from the shared constants so this page
// can't drift from the doctor's own Pricing / Calendar surfaces.
const OFFERINGS = [
    ...SCHEDULABLE_CONSULTATION_TYPES.map((t) => ({
        key: t.value,
        label: t.label,
        desc: t.description,
        color: t.color,
        icon: CONSULT_ICONS[t.value] || LocalHospitalIcon,
        kind: 'consultation',
    })),
    {
        key: 'service', label: 'Service', kind: 'service', color: SERVICE_COLOR,
        icon: MedicalServicesIcon,
        desc: 'Standalone services (certificates, reports) grouped by service plan.',
    },
    {
        key: 'group', label: 'Group Offering', kind: 'group', color: GROUP_COLOR,
        icon: GroupsIcon,
        desc: 'Team-delivered group offerings grouped by group-service plan.',
    },
];

/** Per-offering table config (headers + whether rows are grouped by a plan). */
function tableMeta(offering) {
    if (offering.kind === 'service') {
        return {
            grouped: true,
            planHeader: 'Service',
            memberHeader: 'Provider',
            pf1: 'Priority formula (placeholder_1) — booked-by, based on symptoms & specialization',
            pf2: 'Priority formula (placeholder_2) — card placement when booked via Find My Doctor',
        };
    }
    if (offering.kind === 'group') {
        return {
            grouped: true,
            planHeader: 'Group offering',
            memberHeader: 'Team',
            pf1: 'Priority formula (placeholder_1)',
            pf2: 'Priority formula (placeholder_2)',
        };
    }
    return {
        grouped: false,
        planHeader: null,
        memberHeader: offering.label, // the offering name sits atop the doctor column
        pf1: 'Priority formula (placeholder_1)',
        pf2: 'Priority formula (placeholder_2)',
    };
}

const emptyRow = (id, member, over = {}) => ({
    id, member, doctor_id: null, team_id: null, team_members: [],
    product_id: null, features: [], formula1: '', formula2: '', ...over,
});

// One persisted link row → the table's row shape.
const linkToRow = (l) => ({
    id: l.id,
    member: l.team_name || l.doctor_name || 'Provider',
    doctor_id: l.doctor_id,
    team_id: l.team_id || null,
    team_members: l.team_members || [],
    product_id: l.product_id || null,
    features: Array.isArray(l.features) ? l.features : [],
    formula1: l.formula1 || '',
    formula2: l.formula2 || '',
});

// Build the grouping shell for an offering. Consultation types are one flat
// list; Service / Group are grouped by the real marketplace products — each
// product is a group ("services are products at marketplace"), not a fixed plan.
function buildScaffold(offering, products, groupOfferings) {
    if (offering.kind === 'service') {
        return products.filter((p) => !p.is_group_service)
            .map((p) => ({ plan: p.name, planId: p.id, rows: [] }));
    }
    if (offering.kind === 'group') {
        // The REAL group offerings are the admin-authored GroupOffering plans
        // (not stray is_group_service marketplace products). Each published one
        // mints a backing DoctorProduct — link against THAT so the providers +
        // FeatureProductLink product_id still resolve to the team.
        return (groupOfferings || [])
            .filter((o) => o.backing_product_id)
            .map((o) => ({ plan: o.name, planId: o.backing_product_id, rows: [] }));
    }
    return [{ plan: null, planId: null, rows: [] }];
}

// Merge persisted links into the scaffold. Grouped offerings drop each row
// under its product (product_id); flat offerings put every row in one group.
function hydrateGroups(scaffold, links, kind) {
    const groups = scaffold.map((g) => ({ ...g, rows: [] }));
    const grouped = kind === 'service' || kind === 'group';
    (links || []).forEach((l) => {
        const row = linkToRow(l);
        if (grouped) {
            let g = groups.find((x) => String(x.planId) === String(l.product_id));
            if (!g) { g = { plan: l.product_name || 'Unknown product', planId: l.product_id, rows: [] }; groups.push(g); }
            g.rows.push(row);
        } else {
            if (!groups.length) groups.push({ plan: null, planId: null, rows: [] });
            groups[0].rows.push(row);
        }
    });
    return groups;
}

const FeatureProductLinking = () => {
    const [offering, setOffering] = useState(null);
    const [groups, setGroups] = useState([]);
    const [toast, setToast] = useState(null);

    const meta = offering ? tableMeta(offering) : null;

    // Real providers + product catalog + persisted links for this offering.
    const { data: doctorsData } = useGetDoctorsQuery({ per_page: 200 });
    const { data: products = [] } = useGetAdminProductsQuery();
    // Real group offerings (published) — used to scaffold the group section.
    const { data: groupOfferings = [] } = useGetGroupOfferingsQuery('published');
    const { data: featureOptions = [] } = useGetLandingFeatureOptionsQuery();
    const { data: links = [] } = useGetFeatureProductLinksQuery(offering?.key, { skip: !offering });
    const [saveLinks, { isLoading: saving }] = useSaveFeatureProductLinksMutation();

    const featureTitles = featureOptions.map((f) => f.title);

    const doctorOptions = (doctorsData?.doctors || []).map((d) => ({
        id: d.id,
        label: d.full_name || d.name
            || `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'Doctor',
    }));

    // Rebuild the grid from the plan scaffold + persisted rows whenever the
    // offering changes or its saved links (re)load.
    useEffect(() => {
        if (!offering) return;
        setGroups(hydrateGroups(buildScaffold(offering, products, groupOfferings), links, offering.kind));
        setAddGroupIdx(0);
        setAddDoctor(null);
    }, [offering, links, products, groupOfferings]);

    // Which plan/group the "Add provider" bar targets, and the picked doctor.
    const [addGroupIdx, setAddGroupIdx] = useState(0);
    const [addDoctor, setAddDoctor] = useState(null);

    // Scope the "Add provider" options to who actually offers the selected
    // product — teams for a group, listing doctors for a service — not any
    // doctor. Consultation offerings fall back to all doctors.
    const addTargetProductId = meta?.grouped ? (groups[addGroupIdx]?.planId || null) : null;
    const { data: scopedProviders = [] } = useGetFeatureProductProvidersQuery(
        { offering: offering?.key, productId: addTargetProductId },
        { skip: !offering || (meta?.grouped && !addTargetProductId) },
    );
    const providerOptions = scopedProviders.map((p) => ({
        id: p.id, label: p.name, members: p.members || [], isTeam: !!p.is_team,
    }));

    const editCell = (rowId, field, value) => {
        setGroups((prev) => prev.map((g) => ({
            ...g,
            rows: g.rows.map((r) => (r.id === rowId ? { ...r, [field]: value } : r)),
        })));
    };

    const addProvider = () => {
        if (!addDoctor) return;
        // A group offering links a TEAM (all members); other offerings a doctor.
        const over = addDoctor.isTeam
            ? { team_id: addDoctor.id, team_members: addDoctor.members || [] }
            : { doctor_id: addDoctor.id };
        setGroups((prev) => prev.map((g, i) => (i === addGroupIdx
            ? {
                ...g,
                rows: [...g.rows, emptyRow(
                    `${g.plan || 'consult'}-${addDoctor.id}-${Date.now()}`,
                    addDoctor.label, over,
                )],
            }
            : g)));
        setAddDoctor(null);
        setToast(`${addDoctor.label} attached — add features to link.`);
    };

    const removeRow = (rowId) => {
        setGroups((prev) => prev.map((g) => ({
            ...g, rows: g.rows.filter((r) => r.id !== rowId),
        })));
    };

    // Persist every non-placeholder row of the current offering (wholesale).
    const handleSave = async () => {
        if (!offering) return;
        const grouped = meta.grouped;
        const rows = groups.flatMap((g) => g.rows
            .filter((r) => !r._empty && (r.doctor_id || r.team_id))
            .map((r, i) => ({
                plan_ref: g.plan || null,
                doctor_id: r.doctor_id || null,
                team_id: r.team_id || null,
                // Grouped offerings: the group IS the marketplace product.
                product_id: grouped ? (g.planId || null) : null,
                features: Array.isArray(r.features) ? r.features : [],
                formula1: r.formula1 || '',
                formula2: r.formula2 || '',
                display_order: i,
            })));
        try {
            const saved = await saveLinks({ offering: offering.key, rows }).unwrap();
            setGroups(hydrateGroups(buildScaffold(offering, products, groupOfferings), saved, offering.kind));
            setToast('Links saved.');
        } catch (e) {
            setToast(e?.data?.message || e?.data?.error || 'Save failed');
        }
    };

    // Product cell — only for consultation offerings (flat), which ARE their own
    // product, shown as a fixed chip. Service / Group rows have no product cell:
    // the group itself is the marketplace product (the left column).
    const productCell = (row) => {
        if (row._empty || offering?.kind !== 'consultation') return null;
        return <Chip size="small" label={offering.label} sx={{ bgcolor: `${offering.color}18`, color: offering.color, fontWeight: 600 }} />;
    };

    // Editable config cell (features / formula placeholders).
    const cfgField = (row, field, placeholder, editable = true) => (
        <TextField
            value={row[field]}
            onChange={(e) => editCell(row.id, field, e.target.value)}
            placeholder={placeholder}
            size="small"
            variant="outlined"
            fullWidth
            disabled={!editable}
            InputProps={{ sx: { fontSize: 13 } }}
        />
    );

    const crumbs = (
        <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} sx={{ mb: 2 }}>
            <Link
                component="button"
                underline="hover"
                color={offering ? 'inherit' : 'text.primary'}
                onClick={() => setOffering(null)}
            >
                Feature-Product Linking
            </Link>
            {offering && <Typography color="text.primary">{offering.label}</Typography>}
        </Breadcrumbs>
    );

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>
                Feature-Product Linking
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 820 }}>
                Attach features and priority-formula placeholders to each product. Pick a consultation
                type, a service, or a group offering, then link the providers (or teams) to features.
                A provider can be attached to multiple features.
            </Typography>

            {crumbs}

            {/* ── Level 1: offering cards ── */}
            {!offering && (
                <Grid container spacing={2}>
                    {OFFERINGS.map((o) => {
                        const Icon = o.icon;
                        return (
                            <Grid item xs={12} sm={6} md={4} key={o.key}>
                                <Paper
                                    onClick={() => setOffering(o)}
                                    sx={{
                                        p: 3, cursor: 'pointer', height: '100%',
                                        borderTop: `4px solid ${o.color}`,
                                        transition: 'box-shadow .2s, transform .2s',
                                        '&:hover': { boxShadow: 6, transform: 'translateY(-2px)' },
                                    }}
                                >
                                    <Stack direction="row" spacing={2} alignItems="center" mb={1}>
                                        <Box sx={{
                                            width: 48, height: 48, borderRadius: 2,
                                            bgcolor: `${o.color}18`, color: o.color,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <Icon />
                                        </Box>
                                        <Typography variant="h6" fontWeight={700}>{o.label}</Typography>
                                    </Stack>
                                    <Typography variant="body2" color="text.secondary">{o.desc}</Typography>
                                </Paper>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            {/* ── Level 2: linking table ── */}
            {offering && meta && (
                <>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => setOffering(null)}>
                            Back
                        </Button>
                        <Typography variant="subtitle1" fontWeight={600}>{offering.label}</Typography>
                        <Chip
                            size="small"
                            label={meta.grouped ? `${groups.length} plans` : `${groups[0]?.rows.length || 0} doctors`}
                            color="primary"
                            variant="outlined"
                        />
                        <Box flex={1} />
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={<SaveIcon />}
                            onClick={handleSave}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </Button>
                    </Stack>

                    <TableContainer component={Paper}>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'action.hover', verticalAlign: 'top' } }}>
                                    {meta.grouped && <TableCell sx={{ minWidth: 220 }}>{meta.planHeader}</TableCell>}
                                    <TableCell sx={{ minWidth: 140 }}>{meta.memberHeader}</TableCell>
                                    {!meta.grouped && <TableCell sx={{ minWidth: 200 }}>Product (Book link)</TableCell>}
                                    <TableCell sx={{ minWidth: 240 }}>List of features</TableCell>
                                    <TableCell sx={{ minWidth: 240 }}>{meta.pf1}</TableCell>
                                    <TableCell sx={{ minWidth: 240 }}>{meta.pf2}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {groups.map((g) => {
                                    // Plans with no linked provider still render one placeholder
                                    // row so the plan name is visible (read-only until linked).
                                    const rows = g.rows.length
                                        ? g.rows
                                        : [{ id: `${g.plan}-empty`, member: '', features: '', formula1: '', formula2: '', _empty: true }];
                                    return rows.map((r, ri) => (
                                        <TableRow key={r.id} hover>
                                            {meta.grouped && ri === 0 && (
                                                <TableCell
                                                    rowSpan={rows.length}
                                                    sx={{ verticalAlign: 'top', fontWeight: 600, bgcolor: 'action.hover' }}
                                                >
                                                    {g.plan}
                                                </TableCell>
                                            )}
                                            <TableCell sx={{ fontWeight: meta.grouped ? 400 : 500 }}>
                                                {r._empty ? (
                                                    <Typography variant="caption" color="text.disabled">No provider linked</Typography>
                                                ) : (
                                                    <Box>
                                                        <Stack direction="row" alignItems="center" spacing={0.5}>
                                                            <span>{r.member}</span>
                                                            <IconButton size="small" onClick={() => removeRow(r.id)}
                                                                aria-label="Remove provider">
                                                                <DeleteIcon fontSize="inherit" />
                                                            </IconButton>
                                                        </Stack>
                                                        {r.team_id && (r.team_members || []).length > 0 && (
                                                            <Typography variant="caption" color="text.secondary">
                                                                Members: {r.team_members.join(', ')}
                                                            </Typography>
                                                        )}
                                                    </Box>
                                                )}
                                            </TableCell>
                                            {!meta.grouped && <TableCell>{productCell(r)}</TableCell>}
                                            <TableCell>
                                                {r._empty ? cfgField(r, 'features', '', false) : (
                                                    <Autocomplete
                                                        multiple freeSolo size="small"
                                                        options={featureTitles}
                                                        value={Array.isArray(r.features) ? r.features : []}
                                                        onChange={(_, v) => editCell(r.id, 'features', v)}
                                                        renderTags={(vals, getTagProps) => vals.map((opt, idx) => (
                                                            <Chip size="small" label={opt} {...getTagProps({ index: idx })} key={opt + idx} />
                                                        ))}
                                                        renderInput={(p) => (
                                                            <TextField {...p} placeholder="Pick landing features" variant="outlined"
                                                                InputProps={{ ...p.InputProps, sx: { fontSize: 13 } }} />
                                                        )}
                                                    />
                                                )}
                                            </TableCell>
                                            <TableCell>{cfgField(r, 'formula1', 'placeholder_1', !r._empty)}</TableCell>
                                            <TableCell>{cfgField(r, 'formula2', 'placeholder_2', !r._empty)}</TableCell>
                                        </TableRow>
                                    ));
                                })}
                            </TableBody>
                        </Table>
                    </TableContainer>

                    {/* Add a real provider (and then their features) to a plan. */}
                    <Paper variant="outlined" sx={{ p: 1.5, mt: 2, borderRadius: 2 }}>
                        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Typography variant="subtitle2">Add provider</Typography>
                            {meta.grouped && (
                                <TextField
                                    select size="small" label={meta.planHeader} sx={{ minWidth: 220 }}
                                    value={addGroupIdx}
                                    onChange={(e) => setAddGroupIdx(Number(e.target.value))}
                                >
                                    {groups.map((g, i) => (
                                        <MenuItem key={g.plan || i} value={i}>{g.plan || `Plan ${i + 1}`}</MenuItem>
                                    ))}
                                </TextField>
                            )}
                            <Autocomplete
                                size="small" sx={{ minWidth: 260 }}
                                options={providerOptions}
                                getOptionLabel={(o) => o.label || ''}
                                isOptionEqualToValue={(o, v) => o.id === v.id}
                                value={addDoctor}
                                onChange={(_, v) => setAddDoctor(v)}
                                noOptionsText={meta?.grouped ? 'No team offers this product yet' : 'No providers'}
                                renderInput={(p) => <TextField {...p} label={meta?.grouped ? 'Team member' : 'Doctor'}
                                    placeholder="Search providers" />}
                            />
                            <Button variant="contained" startIcon={<AddIcon />}
                                disabled={!addDoctor} onClick={addProvider}>
                                Add
                            </Button>
                        </Stack>
                    </Paper>

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="caption" color="text.secondary">
                        A provider can be attached to multiple features via the “List of features” column.
                        The two priority-formula columns are placeholders that will drive booking-order /
                        card-placement logic once wired to the backend.
                    </Typography>
                </>
            )}

            <Snackbar
                open={!!toast}
                autoHideDuration={3000}
                onClose={() => setToast(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity="success" variant="filled" onClose={() => setToast(null)}>{toast}</Alert>
            </Snackbar>
        </Box>
    );
};

export default FeatureProductLinking;
