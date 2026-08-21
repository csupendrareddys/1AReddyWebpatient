/**
 * MembershipPlansAdmin — PLATFORM_OWNER view of the marketplace membership
 * catalog (apex larazen.in product line).
 *
 * Mirrors ``PlansAdmin`` (SaaS plans) but trimmed: marketplace plans don't
 * carry seat limits / over-limit actions / default add-ons. Instead they
 * carry a ``vertical_plan_type_id`` FK (authored in the Verticals section at
 * the bottom of this page), ``tier`` (Basic / Growth / Pro), and — depending
 * on whether that vertical is_receiver — either free-text ``benefits`` or a
 * bullet list under ``features``.
 *
 * UI conventions kept identical to the SaaS PlansAdmin shipped earlier today
 * so the platform owner moves between the two admins without friction:
 *   * Status chip on each row is clickable (Draft ↔ Active flip).
 *   * Edit dialog Status select only shows when editing existing rows
 *     (creates always start as ``draft`` server-side).
 *   * Archive icon hidden once a row is already archived.
 */
import {
    Alert, Box, Button, Checkbox, Chip, CircularProgress, Container, Dialog,
    DialogActions, DialogContent, DialogTitle, Divider, FormControl,
    FormControlLabel, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
    Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip,
    Typography,Grid2 as Grid
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import StarIcon from '@mui/icons-material/Star';

import { useMembershipAdmin } from '../hooks/useMembershipAdmin';
import VerticalTypesSection from '../../VerticalTypes/components/VerticalTypesSection';
import { useListVerticalTypesQuery } from '../../api/verticalTypeEndpoints';
import BenefitsEditor from '../../Pricing/components/BenefitsEditor';
import FeatureBulletsEditor from '../components/FeatureBulletsEditor';
import FeatureTreeEditor from '../../Pricing/components/FeatureTreeEditor';
import { bakeBullets } from '../utils/fixedFeatures';
import planLimitLines from '../../../../utils/planLimits';


const statusColor = {
    active: 'success',
    draft: 'default',
    archived: 'error',
    legacy: 'warning',
};

const verticalColor = {
    doctor: 'primary',
    clinic: 'info',
    hospital: 'secondary',
};

const tierColor = {
    basic: 'default',
    growth: 'info',
    pro: 'success',
};


// Features in Round 1 are stored as ``{ bullets: ["…", "…", …] }``.
// The dialog edits them as an ordered list of bubbles (see
// ``FeatureBulletsEditor``) — the same array is persisted and rendered
// verbatim on the public plan card. Round 2 will tighten this to a
// whitelisted path set if real feature gates land.

/**
 * Receiver (patient) plans and provider plans describe what they sell in
 * mutually exclusive ways: a receiver plan carries free-text ``benefits``, a
 * provider plan carries ``features.bullets``. The dialog only ever shows one
 * side, so the hidden side is zeroed rather than sent stale — otherwise
 * repointing a plan at a vertical of the other kind would silently keep
 * whatever the previous one left behind.
 *
 * Mirrors ``buildPlanPayload`` in usePricingAdmin, minus the add-ons and
 * feature tree that marketplace plans don't have.
 */
// The three charge values are edited as text but the API validates them as
// numbers — coerce here so a "0" string doesn't trip the non_negative_number
// check. A receiver (patient) plan carries no platform charges, so they're
// zeroed there.
function withNumericCharges(form) {
    const num = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };
    return {
        charge1_value: num(form.charge1_value),
        charge2_value: num(form.charge2_value),
        charge3_value: num(form.charge3_value),
        charge1_tax_value: num(form.charge1_tax_value),
        charge2_tax_value: num(form.charge2_tax_value),
        charge3_tax_value: num(form.charge3_tax_value),
    };
}

function buildMembershipPayload(form, isReceiver) {
    if (isReceiver) {
        return {
            ...form,
            // Blank rows are an editing artifact, not a benefit.
            benefits: (form.benefits || []).map((b) => (b || '').trim()).filter(Boolean),
            features: {},
            // Patient plans don't levy platform charges on a provider.
            charge1_value: 0,
            charge2_value: 0,
            charge3_value: 0,
            charge1_tax_value: 0,
            charge2_tax_value: 0,
            charge3_tax_value: 0,
            // A patient employs nobody and holds no affiliations. Nulled, not
            // omitted — repointing a provider tier at the patient vertical has
            // to drop its caps rather than leave them enforcing on a plan
            // whose form no longer shows them.
            max_support_staff: null,
            max_link_connections: null,
        };
    }
    return {
        ...form,
        ...withNumericCharges(form),
        benefits: [],
        // Provider tiers don't grant a member discount — the field is hidden
        // for them, so anything still on the form is a leftover from editing
        // a receiver tier in the same session.
        member_discount_pct: 0,
        // Preserve any other keys the operator may have stored under
        // ``features`` while baking the bullet list — special ``{token}``
        // rows resolve to their live number ("15% commission on every
        // booking") so the backend only ever stores plain strings.
        features: {
            ...form.features,
            bullets: bakeBullets(form, form.features?.bullets),
        },
    };
}


const MembershipPlansAdmin = () => {
    const {
        plans, plansLoading, plansError,
        planDialogOpen, planForm, setPlanForm,
        openPlanDialog, closePlanDialog,
        editingPlanCode,
        handleSavePlan, isSavingPlan,
        handleUpdatePlan,
        handleArchivePlan,
    } = useMembershipAdmin();

    // Populates the plan dialog's Vertical picker. Same rows the section at the
    // bottom of this page edits, so a vertical created there is immediately
    // selectable here (the mutations invalidate this query's tag).
    const { data: verticalTypes = [] } = useListVerticalTypesQuery();

    // The vertical this plan points at, and whether it's the patient side.
    // ``vertical_plan_type_id`` is the only handle the plan has — name /
    // is_receiver all live on the vertical row.
    const selectedVerticalType = verticalTypes.find(
        (vt) => vt.id === planForm.vertical_plan_type_id,
    ) || null;
    const isReceiverPlan = !!selectedVerticalType?.is_receiver;

    const handleSave = async () => {
        // Normalise the payload (trim/zero the hidden side) and call through
        // to the hook's saver.
        await handleSavePlan(buildMembershipPayload(planForm, isReceiverPlan));
    };

    // Diagnose why the Create button is disabled so the operator gets
    // a tooltip instead of a silent no-op click. Empty string = enabled.
    const missingFields = (() => {
        if (isSavingPlan) return 'Saving…';
        const missing = [];
        if (!planForm.code) missing.push('code');
        if (!planForm.name) missing.push('name');
        if (!planForm.vertical_plan_type_id) missing.push('vertical');
        if (!planForm.tier) missing.push('tier');
        if (missing.length === 0) return '';
        return `Fill in: ${missing.join(', ')}`;
    })();

    if (plansLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Container maxWidth="xl" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="h5">Marketplace Membership Plans</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Tiers shown on the apex pricing page (<code>larazen.in</code>).
                        Separate from the SaaS tenant plans under <em>Plans</em>.
                    </Typography>
                </Box>
                <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    onClick={() => openPlanDialog(null)}
                >
                    New plan
                </Button>
            </Stack>

            {plansError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    Failed to load membership plans. Reload the page or check the API.
                </Alert>
            )}

            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Code</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell>Vertical</TableCell>
                            <TableCell>Tier</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="center">Member disc.</TableCell>
                            <TableCell align="center">Limits</TableCell>
                            <TableCell align="center">Featured</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {plans.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={9}>
                                    <Typography variant="body2" color="text.secondary">
                                        No membership plans yet. Click <b>New plan</b> to author one.
                                        Aim for nine total — 3 verticals × 3 tiers.
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {plans.map((p) => {
                            // Serialised nested on the plan, so no lookup is
                            // needed. Null (a plan authored before the FK, or
                            // pointed at a deleted vertical) reads as "—"
                            // rather than a blank chip.
                            const vt = p.vertical_plan_type;
                            return (
                            <TableRow key={p.id} hover>
                                <TableCell><code>{p.code}</code></TableCell>
                                <TableCell>{p.name}</TableCell>
                                <TableCell>
                                    <Chip
                                        size="small"
                                        label={vt?.name || '—'}
                                        color={verticalColor[vt?.code] || 'default'}
                                        variant="outlined"
                                    />
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        size="small"
                                        label={p.tier}
                                        color={tierColor[p.tier] || 'default'}
                                        variant="outlined"
                                    />
                                </TableCell>
                                <TableCell>
                                    {p.status === 'archived' ? (
                                        <Tooltip title="Closed to new subscribers. Anyone already on it keeps it unchanged.">
                                            <Chip
                                                size="small"
                                                label={p.status}
                                                color={statusColor[p.status] || 'default'}
                                            />
                                        </Tooltip>
                                    ) : p.is_legacy ? (
                                        // A legacy plan is still draft/active
                                        // underneath, but the operator cares that
                                        // it's legacy first — surface that on the
                                        // chip. Editing the plan (toggle off / flip
                                        // status) happens in the edit dialog, so this
                                        // one isn't click-to-flip.
                                        <Chip
                                            size="small"
                                            label="legacy"
                                            color={statusColor.legacy}
                                        />
                                    ) : (
                                        <Tooltip
                                            title={
                                                p.status === 'active'
                                                    ? 'Click to move back to draft'
                                                    : 'Click to activate this plan'
                                            }
                                        >
                                            <Chip
                                                size="small"
                                                label={p.status}
                                                color={statusColor[p.status] || 'default'}
                                                onClick={() =>
                                                    handleUpdatePlan(p.code, {
                                                        status: p.status === 'active'
                                                            ? 'draft' : 'active',
                                                    })
                                                }
                                                clickable
                                            />
                                        </Tooltip>
                                    )}
                                </TableCell>
                                <TableCell align="center">
                                    {Number(p.member_discount_pct) > 0 ? (
                                        <Chip
                                            size="small"
                                            color="success"
                                            label={`${Number(p.member_discount_pct)}% off`}
                                        />
                                    ) : '—'}
                                </TableCell>
                                {/* Capped tiers only. An em-dash for the rest
                                    reads as "no cap", which is the truth and
                                    is shorter than two "Unlimited" chips on
                                    every uncapped row. */}
                                <TableCell align="center">
                                    {planLimitLines(p).length === 0 ? '—' : (
                                        <Stack spacing={0.5} alignItems="center">
                                            {planLimitLines(p).map((l) => (
                                                <Chip key={l.key} size="small" variant="outlined"
                                                    label={l.text} />
                                            ))}
                                        </Stack>
                                    )}
                                </TableCell>
                                <TableCell align="center">
                                    {p.is_featured ? <StarIcon fontSize="small" color="warning" /> : '—'}
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="Edit">
                                        <IconButton size="small" onClick={() => openPlanDialog(p)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {p.status !== 'archived' && (
                                        <Tooltip title="Archive (close to new subscribers)">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => {
                                                    if (window.confirm(
                                                        `Archive plan "${p.code}"? It stops being offered to new `
                                                        + `subscribers. Anyone already on it keeps it unchanged.`
                                                    )) handleArchivePlan(p.code);
                                                }}
                                            >
                                                <ArchiveIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* The verticals the plans above are authored against — same
                relationship Plan Types have to the SaaS plans on PlansAdmin,
                so it sits in the same place: under the table it classifies. */}
            <VerticalTypesSection />

            <Dialog open={planDialogOpen} onClose={closePlanDialog} fullWidth maxWidth="md">
                <DialogTitle>
                    {editingPlanCode ? `Edit plan: ${editingPlanCode}` : 'New membership plan'}
                </DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Code"
                                value={planForm.code}
                                onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })}
                                disabled={Boolean(editingPlanCode)}
                                helperText="Stable identifier, e.g. doctor_starter"
                                size="small"
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Name"
                                value={planForm.name}
                                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                                helperText="Customer-facing label, e.g. 'Doctor Starter' or 'Hospital Enterprise'"
                                size="small"
                                sx={{ flex: 2 }}
                            />
                        </Stack>

                        <TextField
                            label="Description"
                            value={planForm.description}
                            onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                            helperText="One-liner shown under the card title on the pricing page."
                        />

                        <Stack direction="row" spacing={1}>
                            <FormControl size="small" sx={{ flex: 1 }}>
                                <InputLabel>Vertical</InputLabel>
                                <Select
                                    label="Vertical"
                                    value={planForm.vertical_plan_type_id}
                                    onChange={(e) =>
                                        setPlanForm({
                                            ...planForm,
                                            vertical_plan_type_id: e.target.value,
                                        })
                                    }
                                >
                                    {/* The verticals authored in the section below,
                                        not a fixed doctor/clinic/hospital list — a
                                        newly published vertical has to be selectable
                                        here or it can never get plans. Value is the
                                        row id: the plan stores a FK, not a name. */}
                                    {verticalTypes.map((vt) => (
                                        <MenuItem key={vt.id} value={vt.id}>
                                            {vt.name}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl size="small" sx={{ flex: 1 }}>
                                <InputLabel>Tier</InputLabel>
                                <Select
                                    label="Tier"
                                    value={planForm.tier}
                                    onChange={(e) =>
                                        setPlanForm({ ...planForm, tier: e.target.value })
                                    }
                                >
                                    <MenuItem value="basic">Basic</MenuItem>
                                    <MenuItem value="growth">Growth</MenuItem>
                                    <MenuItem value="pro">Pro / Enterprise</MenuItem>
                                </Select>
                            </FormControl>
                            <TextField
                                label="Sort order"
                                type="number"
                                size="small"
                                value={planForm.sort_order ?? 0}
                                onChange={(e) =>
                                    setPlanForm({
                                        ...planForm,
                                        sort_order: Number(e.target.value),
                                    })
                                }
                                helperText="Lower = first"
                                sx={{ flex: 1 }}
                            />
                        </Stack>

                        {/* <Stack direction="row" spacing={1}>
                            <TextField
                                label="Monthly ₹"
                                type="number"
                                size="small"
                                value={planForm.price_inr_monthly ?? ''}
                                onChange={(e) =>
                                    setPlanForm({
                                        ...planForm,
                                        price_inr_monthly:
                                            e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                helperText="0 = Free · -1 = Custom · blank = not offered"
                                sx={{ flex: 1 }}
                            /> */}
                        <Alert severity="info" sx={{ mb: 1 }}>
                            <b>Pricing</b> — each period is read on its own:
                            <br />
                            • a price sells the plan at that rate.
                            <br />
                            • <b>0</b> makes that period read <b>&quot;Free&quot;</b> on the
                            plan card — it&apos;s still offered, just not charged for.
                            <br />
                            • <b>-1</b> makes that period read <b>&quot;Custom / Contact
                            sales&quot;</b> on the plan card.
                            <br />
                            • <b>blank</b> means the period isn&apos;t offered — it&apos;s
                            dropped from the billing toggle entirely rather than shown as
                            Custom. A plan with no priced period won&apos;t render a card.
                        </Alert>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                                <Stack spacing={1}>
                                    <TextField
                                        label="Monthly ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.price_inr_monthly ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                price_inr_monthly:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                    <TextField
                                        label="No discount Monthly ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.og_price_inr_monthly ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                og_price_inr_monthly:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                </Stack>
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                                <Stack spacing={1}>
                                    <TextField
                                        label="Quarterly ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.price_inr_quarterly ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                price_inr_quarterly:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                    <TextField
                                        label="No discount Quarterly ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.og_price_inr_quarterly ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                og_price_inr_quarterly:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                </Stack>
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                                <Stack spacing={1}>
                                    <TextField
                                        label="Semi-annual ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.price_inr_semi_annual ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                price_inr_semi_annual:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                    <TextField
                                        label="No discount Semi-annual ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.og_price_inr_semi_annual ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                og_price_inr_semi_annual:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                </Stack>
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                                <Stack spacing={1}>
                                    <TextField
                                        label="Annual ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.price_inr_annual ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                price_inr_annual:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                    <TextField
                                        label="No discount Annual ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.og_price_inr_annual ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                og_price_inr_annual:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                </Stack>
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                                <Stack spacing={1}>
                                    <TextField
                                        label="Biennial ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.price_inr_biennial ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                price_inr_biennial:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                    <TextField
                                        label="No discount Biennial ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.og_price_inr_biennial ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                og_price_inr_biennial:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                </Stack>
                            </Grid>

                            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                                <Stack spacing={1}>
                                    <TextField
                                        label="Triennial ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.price_inr_triennial ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                price_inr_triennial:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                    <TextField
                                        label="No discount Triennial ₹"
                                        type="number"
                                        size="small"
                                        value={planForm.og_price_inr_triennial ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                og_price_inr_triennial:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="0 = Free · -1 = Custom · blank = not offered"
                                        fullWidth
                                    />
                                </Stack>
                            </Grid>
                        </Grid>
                            {/* <TextField
                                label="Annual ₹"
                                type="number"
                                size="small"
                                value={planForm.price_inr_annual ?? ''}
                                onChange={(e) =>
                                    setPlanForm({
                                        ...planForm,
                                        price_inr_annual:
                                            e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                helperText="Blank = monthly only"
                                sx={{ flex: 1 }}
                            /> */}
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Trial days"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={planForm.trial_days ?? 0}
                                onChange={(e) =>
                                    setPlanForm({
                                        ...planForm,
                                        trial_days: Number(e.target.value),
                                    })
                                }
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Payout hold (days)"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={planForm.payout_hold_days ?? ''}
                                onChange={(e) =>
                                    setPlanForm({
                                        ...planForm,
                                        payout_hold_days:
                                            e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                helperText="How long a subscribed doctor's earnings are held before payout. Blank = tenant default."
                                sx={{ flex: 1 }}
                            />
                            {/* Receiver (patient) tiers only. A provider tier
                                is what a practice SELLS through — its money
                                levers are commission and the platform charges
                                below, which cut the provider's earnings. A
                                discount there would have the platform paying a
                                doctor to be a member. The backend zeroes it on
                                provider verticals regardless of what's sent. */}
                            {isReceiverPlan && (
                                <TextField
                                    label="Member discount %"
                                    type="number"
                                    size="small"
                                    inputProps={{ min: 0, max: 100, step: '0.01' }}
                                    value={planForm.member_discount_pct ?? 0}
                                    onChange={(e) =>
                                        setPlanForm({
                                            ...planForm,
                                            member_discount_pct:
                                                e.target.value === '' ? 0 : Number(e.target.value),
                                        })
                                    }
                                    helperText="Flat % off every consultation & service for holders of this tier. 0 = none."
                                    sx={{ flex: 1 }}
                                />
                            )}
                        </Stack>

                        {/* Patient Family quotas — receiver (patient) plans only.
                            A minor / linked member never buys their own plan, so
                            how many an owner may create is a property of THIS
                            plan. Persisted into PatientFamilyPolicy by the plan
                            create/update route. */}
                        {isReceiverPlan && (
                            <Box sx={{ mt: 1 }}>
                                <Divider sx={{ mb: 1.5 }} />
                                <Typography variant="subtitle2">Patient Family quotas</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    How many minor profiles, linked adults, and family roles a holder of
                                    this plan may create — members don&apos;t buy their own plan, this one
                                    covers them. Use <b>-1</b> for unlimited, <b>0</b> to disallow.
                                </Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    {[
                                        { k: 'max_minor_subaccounts', label: 'Minor profiles' },
                                        { k: 'max_family_links', label: 'Linked adults' },
                                        { k: 'max_patient_roles', label: 'Family roles' },
                                    ].map(({ k, label }) => (
                                        <TextField key={k} label={label} type="number" size="small"
                                            inputProps={{ min: -1, step: 1 }}
                                            value={planForm[k] ?? 0}
                                            onChange={(e) => setPlanForm({
                                                ...planForm,
                                                [k]: e.target.value === '' ? 0 : Math.max(-1, Math.trunc(Number(e.target.value))),
                                            })}
                                            sx={{ flex: 1 }} />
                                    ))}
                                </Stack>
                            </Box>
                        )}

                        {/* Capacity caps. A receiver (patient) tier has
                            neither — a patient employs nobody and holds no
                            affiliations — so the section is hidden and both
                            fields are nulled in buildMembershipPayload rather
                            than left carrying whatever the last provider tier
                            edited in this session put there. */}
                        {!isReceiverPlan && (
                            <Box>
                                <Divider sx={{ mb: 1 }} />
                                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                    Plan limits
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                                    How much a member on this tier may hold. Leave blank for
                                    unlimited; <b>0</b> means the tier grants none at all. A cap
                                    refuses the next one — it never removes what a member
                                    already has, so moving someone down a tier is safe.
                                </Typography>
                                <Stack direction="row" spacing={1}>
                                    <TextField
                                        label="Support staff"
                                        type="number"
                                        size="small"
                                        inputProps={{ min: 0 }}
                                        value={planForm.max_support_staff ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                max_support_staff:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="People in My Link → Support Staff. Blank = unlimited."
                                        sx={{ flex: 1 }}
                                    />
                                    <TextField
                                        label="My Link affiliations"
                                        type="number"
                                        size="small"
                                        inputProps={{ min: 0 }}
                                        value={planForm.max_link_connections ?? ''}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm,
                                                max_link_connections:
                                                    e.target.value === '' ? null : Number(e.target.value),
                                            })
                                        }
                                        helperText="Active links in My Link → Affiliations. Counted on both ends. Blank = unlimited."
                                        sx={{ flex: 1 }}
                                    />
                                </Stack>
                            </Box>
                        )}

                        {/* Health credits moved to their own admin page
                            (Membership → Health Credits) so the grant + per-
                            offering caps can be retuned live, without editing /
                            re-versioning the plan. This dialog no longer owns
                            them. */}

                        {/* Platform charges — moved here from the tenant-wide
                            Billing Config. Each charge is deducted from a
                            subscribed provider's appointment earnings; a doctor
                            with no active plan is charged nothing. Receiver
                            (patient) plans don't levy charges, so the section is
                            hidden for them (and zeroed in buildMembershipPayload). */}
                        {!isReceiverPlan && (
                            <Box>
                                <Divider sx={{ mb: 1 }} />
                                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                    Platform charges
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                                    Deducted from each appointment payment before GST/TDS —
                                    inclusive of the per-charge tax below. Percentage of the
                                    payment (charge) / of the charge (tax), or a fixed ₹ amount.
                                </Typography>
                                {[1, 2, 3].map((n) => {
                                    const nameKey = `charge${n}_name`;
                                    const typeKey = `charge${n}_type`;
                                    const valueKey = `charge${n}_value`;
                                    const taxTypeKey = `charge${n}_tax_type`;
                                    const taxValueKey = `charge${n}_tax_value`;
                                    return (
                                        <Box key={n} sx={{ mb: 1.5 }}>
                                            <Stack direction="row" spacing={1} sx={{ mb: 0.5 }}>
                                                <TextField
                                                    label={`Charge ${n} name`}
                                                    size="small"
                                                    value={planForm[nameKey] ?? ''}
                                                    onChange={(e) =>
                                                        setPlanForm({ ...planForm, [nameKey]: e.target.value })
                                                    }
                                                    sx={{ flex: 2 }}
                                                />
                                                <FormControl size="small" sx={{ flex: 1 }}>
                                                    <InputLabel>Type</InputLabel>
                                                    <Select
                                                        label="Type"
                                                        value={planForm[typeKey] ?? 'percentage'}
                                                        onChange={(e) =>
                                                            setPlanForm({ ...planForm, [typeKey]: e.target.value })
                                                        }
                                                    >
                                                        <MenuItem value="percentage">Percentage (%)</MenuItem>
                                                        <MenuItem value="fixed">Fixed (₹)</MenuItem>
                                                    </Select>
                                                </FormControl>
                                                <TextField
                                                    label="Value"
                                                    type="number"
                                                    size="small"
                                                    inputProps={{ min: 0, step: '0.01' }}
                                                    value={planForm[valueKey] ?? '0'}
                                                    onChange={(e) =>
                                                        setPlanForm({ ...planForm, [valueKey]: e.target.value })
                                                    }
                                                    sx={{ flex: 1 }}
                                                />
                                            </Stack>
                                            {/* Per-charge tax — folded into the deducted charge. */}
                                            <Stack direction="row" spacing={1} sx={{ pl: 2 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', flex: 2 }}>
                                                    Tax on charge {n}
                                                </Typography>
                                                <FormControl size="small" sx={{ flex: 1 }}>
                                                    <InputLabel>Tax type</InputLabel>
                                                    <Select
                                                        label="Tax type"
                                                        value={planForm[taxTypeKey] ?? 'percentage'}
                                                        onChange={(e) =>
                                                            setPlanForm({ ...planForm, [taxTypeKey]: e.target.value })
                                                        }
                                                    >
                                                        <MenuItem value="percentage">Percentage (%)</MenuItem>
                                                        <MenuItem value="fixed">Fixed (₹)</MenuItem>
                                                    </Select>
                                                </FormControl>
                                                <TextField
                                                    label="Tax value"
                                                    type="number"
                                                    size="small"
                                                    inputProps={{ min: 0, step: '0.01' }}
                                                    value={planForm[taxValueKey] ?? '0'}
                                                    onChange={(e) =>
                                                        setPlanForm({ ...planForm, [taxValueKey]: e.target.value })
                                                    }
                                                    sx={{ flex: 1 }}
                                                />
                                            </Stack>
                                        </Box>
                                    );
                                })}
                            </Box>
                        )}

                        {/* Feature control — the dotted capability paths this
                            plan unlocks (incl. the new Service / Group offering
                            access controls). Stored alongside the marketing
                            bullets under ``features``. */}
                        {!isReceiverPlan && (
                            <Box>
                                <Divider sx={{ mb: 1 }} />
                                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                    Features included in this plan
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    Toggle the capabilities this membership tier unlocks for a
                                    provider — including whether they may offer standalone
                                    Services and team-delivered Group offerings.
                                </Typography>
                                <FeatureTreeEditor
                                    value={planForm.features || {}}
                                    onChange={(features) =>
                                        setPlanForm({ ...planForm, features })
                                    }
                                />
                            </Box>
                        )}

                        <Stack direction="row" spacing={2} alignItems="center">
                            {editingPlanCode && (
                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                    <InputLabel>Status</InputLabel>
                                    <Select
                                        label="Status"
                                        value={planForm.status || 'draft'}
                                        onChange={(e) =>
                                            setPlanForm({ ...planForm, status: e.target.value })
                                        }
                                    >
                                        <MenuItem value="draft">Draft</MenuItem>
                                        <MenuItem value="active">Active</MenuItem>
                                        <MenuItem value="archived">Archived</MenuItem>
                                    </Select>
                                </FormControl>
                            )}
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={!!planForm.is_featured}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm, is_featured: e.target.checked,
                                            })
                                        }
                                    />
                                }
                                label='Featured ("Most Popular" badge)'
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!!planForm.is_legacy}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm, is_legacy: e.target.checked,
                                            })
                                        }
                                    />
                                }
                                label="Legacy plan"
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={planForm.holding_enabled !== false}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm, holding_enabled: e.target.checked,
                                            })
                                        }
                                    />
                                }
                                label="Holding page when subscription lapses"
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!!planForm.publish_on_landing}
                                        onChange={(e) =>
                                            setPlanForm({
                                                ...planForm, publish_on_landing: e.target.checked,
                                            })
                                        }
                                    />
                                }
                                label="Publish on landing (self-serve signup) — off = admin-assign only"
                            />
                        </Stack>

                        <Divider />

                        {/* A receiver (patient) plan sells a list of promises; a
                            provider plan sells feature bullets. The two are
                            mutually exclusive and whichever side is hidden gets
                            sent empty — see ``buildMembershipPayload``. Same
                            split as PlansAdmin, minus the add-ons and feature
                            tree that marketplace plans don't have. */}
                        {isReceiverPlan ? (
                            <Box>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    Benefits
                                </Typography>
                                <BenefitsEditor
                                    value={planForm.benefits || []}
                                    onChange={(benefits) => setPlanForm({ ...planForm, benefits })}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                    Shown verbatim, in this order, on the plan card at{' '}
                                    <b>/join_receiver</b>. Receiver plans carry no feature bullets —
                                    those are saved empty for this vertical.
                                </Typography>
                            </Box>
                        ) : (
                            <Box>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    Feature bullets
                                </Typography>
                                <FeatureBulletsEditor
                                    value={planForm.features?.bullets || []}
                                    onChange={(bullets) =>
                                        setPlanForm({
                                            ...planForm,
                                            features: { ...planForm.features, bullets },
                                        })
                                    }
                                    plan={planForm}
                                />
                            </Box>
                        )}

                        <Alert severity="info">
                            Marketplace memberships are sold to <b>doctors / clinics / hospitals
                            who register on larazen.in</b>. Distinct from the SaaS plans (under <em>Plans</em>)
                            which sell tenant subdomains. Round 1 surfaces these on the apex pricing page;
                            Round 2 wires self-serve signup and payouts.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closePlanDialog}>Cancel</Button>
                    {/* Tooltip surfaces *why* the button is disabled — the
                        prior silent-no-op was the main "Create button isn't
                        working" symptom. Wrap in a span because MUI Tooltip
                        can't sit directly on a disabled <Button>. */}
                    <Tooltip
                        title={missingFields || ''}
                        disableHoverListener={!missingFields}
                    >
                        <span>
                            <Button
                                variant="contained"
                                onClick={handleSave}
                                disabled={!!missingFields}
                            >
                                {editingPlanCode ? 'Save changes' : 'Create'}
                            </Button>
                        </span>
                    </Tooltip>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default MembershipPlansAdmin;
