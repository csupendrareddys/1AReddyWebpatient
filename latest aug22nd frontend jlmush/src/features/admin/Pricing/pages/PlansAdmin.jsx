/**
 * PlansAdmin — PLATFORM_OWNER view of the plan catalog.
 *
 * Presentational only. All RTK Query wiring, form state, and
 * snackbar dispatching lives in ``../hooks/usePricingAdmin``.
 *
 * Dialog covers the full Plan model: pricing, trial, seat limits, and
 * then one of two mutually exclusive tails — ``default_addons`` + the
 * structured feature tree for provider plans, or the free-text
 * ``benefits`` list for service-receiver (patient) plans. Edit +
 * archive actions live on each row.
 */
import {
    Alert, Box, Button, Checkbox, Chip, CircularProgress, Container, Dialog,
    DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
    IconButton, InputLabel, MenuItem, FormControl, Paper, Select, Stack,
    Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
    Tooltip, Typography, Grid2 as Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';

import IconKeyField from '../../../../common/components/IconKeyField/IconKeyField';
import SaasCategoriesSection from '../components/SaasCategoriesSection';
import {
    useResyncPlanSubscribersMutation, useGetFeaturePathsQuery, useListSaasCategoriesQuery } from '../../api/pricingEndpoints';
import MuiIcon from '../../../../common/components/MuiIcon/MuiIcon';
import BenefitsEditor from '../components/BenefitsEditor';
import FeatureTreeEditor from '../components/FeatureTreeEditor';
import ProviderEntityQuotasEditor from '../components/ProviderEntityQuotasEditor';
import SeatLimitsEditor from '../components/SeatLimitsEditor';
import ChildCapsEditor, { childCapsError } from '../components/ChildCapsEditor';
import PlanCardPreview from '../components/PlanCardPreview';
import BuilderCart from '../components/BuilderCart';
import AddonCatalogueSummary from '../components/AddonCatalogueSummary';
import PlanAddonTermsEditor from '../components/PlanAddonTermsEditor';
import { useListResellerAddonCatalogueQuery } from
    '../../Reseller/api/resellerEndpoints';
import { usePricingAdmin } from '../hooks/usePricingAdmin';


const statusColor = {
    active: 'success', ACTIVE: 'success',
    draft: 'default', DRAFT: 'default',
    archived: 'error', ARCHIVED: 'error',
};


// Feature-path catalog via the reseller mirror endpoint — passed to
// FeatureTreeEditor's usePathsHook when the page runs in reseller scope.
const useResellerFeaturePaths = (arg, options) =>
    useGetFeaturePathsQuery('reseller', options);

const PlansAdmin = ({ ownerScope = 'platform' } = {}) => {
    // 'reseller' renders the SAME page against /api/v1/admin/reseller with
    // the vendor-only chrome hidden (categories, plan-type CRUD, defaults).
    const isVendor = ownerScope !== 'reseller';
    const { data: saasCategories = [] } = useListSaasCategoriesQuery(
        undefined, { skip: !isVendor });
const [resyncSubscribers, resyncState] = useResyncPlanSubscribersMutation();
    const {
        plans, plansLoading, plansError,
        addons,
        planDialogOpen, planForm, setPlanForm,
        openPlanDialog, closePlanDialog,
        editingPlanCode, isReceiverPlan,
        handleSavePlan, isSavingPlan,
        handleUpdatePlan,
        handleArchivePlan,
        planTypes, planTypesLoading,
        planTypeDialogOpen, planTypeForm, setPlanTypeForm,
        openPlanTypeDialog, closePlanTypeDialog,
        editingPlanTypeId,
        handleSavePlanType, isSavingPlanType,
        handleDeletePlanType,
        notify,
    } = usePricingAdmin({ scope: ownerScope });

    // Hook order must be stable — this sits BEFORE any early return.
    const { data: resellerCatalogue } = useListResellerAddonCatalogueQuery(
        undefined, { skip: isVendor });

    if (plansLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    // Only ``active`` add-ons are eligible for ``default_addons`` —
    // attaching a draft/archived add-on on subscribe would surprise
    // the tenant.
    // Refuse to POST a self-contradictory plan. The server rejects these
    // too, but a form that silently accepts bad numbers and only fails on
    // Save teaches operators to distrust the screen.
    const ownSeatsError = (() => {
        const n = (k) => (Number.isFinite(Number(planForm[k]))
            ? Number(planForm[k]) : null);
        const total = n('max_total_users');
        const parts = ['max_super_admins', 'max_sub_admins', 'max_providers']
            .map(n);
        if (total === null || parts.some((v) => v === null)) return null;
        const per = parts.reduce((a, b) => a + b, 0);
        return per > total
            ? `Seat limits: super admins + sub-admins + providers = ${per}, `
              + `which is more than the total of ${total}.`
            : null;
    })();
    const planBlockingError = ownSeatsError
        || childCapsError(planForm.child_plan_caps);

    const activeAddonCodes = (addons || [])
        .filter((a) => a.status === 'active')
        .map((a) => a.code);

    // The four ``max_*`` numeric fields are persisted flat on the
    // form, but ``SeatLimitsEditor`` works in the nested
    // ``{total, super_admin, sub_admin, provider}`` shape — adapt
    // either side of the boundary so we don't have two sources of
    // truth for the same numbers.
    const seatValue = {
        total: planForm.max_total_users,
        super_admin: planForm.max_super_admins,
        sub_admin: planForm.max_sub_admins,
        provider: planForm.max_providers,
    };
    const setSeats = (v) =>
        setPlanForm({
            ...planForm,
            max_total_users: v.total ?? 0,
            max_super_admins: v.super_admin ?? 0,
            max_sub_admins: v.sub_admin ?? 0,
            max_providers: v.provider ?? 0,
        });

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h5">Plans</Typography>
                <Stack direction="row" spacing={1}>
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => openPlanDialog(null)}>
                        New plan
                    </Button>
                </Stack>
            </Stack>
            

            {plansError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    Failed to load plans.
                </Alert>
            )}

            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Code</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell>Plan Type</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Default</TableCell>
                            <TableCell align="right">Total</TableCell>
                            <TableCell align="right">SA</TableCell>
                            <TableCell align="right">Sub-A</TableCell>
                            <TableCell align="right">Providers</TableCell>
                            <TableCell align="center">Add-ons</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {plans.map((p) => (
                            <TableRow key={p.id} hover>
                                <TableCell><code>{p.code}</code></TableCell>
                                <TableCell>{p.name}</TableCell>
                                <TableCell>{p.plan_type?.name}</TableCell>
                                <TableCell>
                                    {p.status === 'archived' ? (
                                        <Chip size="small" label={p.status} color={statusColor[p.status] || 'default'} />
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
                                                        status: p.status === 'active' ? 'draft' : 'active',
                                                    })
                                                }
                                                clickable
                                            />
                                        </Tooltip>
                                    )}
                                </TableCell>
                                <TableCell>{p.is_default ? 'yes' : ''}</TableCell>
                                <TableCell align="right">{p.user_limits?.total}</TableCell>
                                <TableCell align="right">{p.user_limits?.per_role?.super_admin}</TableCell>
                                <TableCell align="right">{p.user_limits?.per_role?.sub_admin}</TableCell>
                                <TableCell align="right">{p.user_limits?.per_role?.provider}</TableCell>
                                <TableCell>
                                    {(p.default_addons || []).length === 0
                                        ? '—'
                                        : (p.default_addons || []).map((c) => (
                                              <Chip key={c} size="small" label={c} sx={{ mr: 0.5 }} />
                                          ))}
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="Edit">
                                        <IconButton size="small" onClick={() => openPlanDialog(p)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {p.status !== 'archived' && (
                                        <Tooltip title="Archive">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => {
                                                    if (window.confirm(
                                                        `Archive plan "${p.code}"? Tenants currently on it will keep working until reassigned.`
                                                    )) handleArchivePlan(p.code);
                                                }}
                                            >
                                                <ArchiveIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {isVendor && <SaasCategoriesSection notify={notify} />}

            <Box sx={{ mt: 4, mb: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h5">Plan Types</Typography>
                <Stack direction="row" spacing={1}>
                    {isVendor && (
                        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openPlanTypeDialog(null)}>
                            New plan type
                        </Button>
                    )}
                </Stack>
            </Stack>

                {planTypesLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : (
                    <TableContainer component={Paper}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell align="center" width={60}>Icon</TableCell>
                                    <TableCell>Code</TableCell>
                                    <TableCell>Name</TableCell>
                                    <TableCell>Description</TableCell>
                                    <TableCell>Category</TableCell>
                                    <TableCell>Audience</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {planTypes.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7}>
                                            <Typography variant="body2" color="text.secondary">
                                                No plan types yet.
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                                {planTypes.map((pt) => (
                                    <TableRow key={pt.id} hover>
                                        <TableCell align="center">
                                            {/* An unset or unrecognised key renders the em
                                                dash rather than a gap, so the column reads
                                                as "no icon" instead of "still loading". */}
                                            <MuiIcon
                                                name={pt.icon_key}
                                                fontSize="small"
                                                color="action"
                                                fallback={
                                                    <Typography variant="body2" color="text.disabled">—</Typography>
                                                }
                                            />
                                        </TableCell>
                                        <TableCell><code>{pt.code}</code></TableCell>
                                        <TableCell>{pt.name}</TableCell>
                                        <TableCell>{pt.description}</TableCell>
                                        <TableCell>
                                            <Chip size="small" variant="outlined"
                                                  label={pt.category_code || 'default'} />
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                size="small"
                                                label={pt.is_receiver ? 'Receiver' : 'Provider'}
                                                color={pt.is_receiver ? 'info' : 'default'}
                                            />
                                        </TableCell>
                                        <TableCell align="right">
                                            {/* Plan types are the VENDOR's
                                                catalog — read-only for the
                                                reseller surface. */}
                                            {isVendor && (
                                                <>
                                                    <Tooltip title="Edit">
                                                        <IconButton size="small" onClick={() => openPlanTypeDialog(pt)}>
                                                            <EditIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Delete">
                                                        <IconButton
                                                            size="small"
                                                            color="error"
                                                            onClick={() => {
                                                                if (window.confirm(
                                                                    `Delete plan type "${pt.code}"? This only works if no plan is currently using it.`
                                                                )) handleDeletePlanType(pt.id, pt.code);
                                                            }}
                                                        >
                                                            <ArchiveIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Box>


            <Dialog open={planDialogOpen} onClose={closePlanDialog} fullWidth maxWidth="md">
                <DialogTitle>
                    {editingPlanCode ? `Edit plan: ${editingPlanCode}` : 'New plan'}
                </DialogTitle>
                <DialogContent dividers>
                    {/* Grandfathering notice. Subscribers keep the terms
                        captured at subscription time; edits here only shape
                        NEW subscriptions. The button is the vendor's
                        explicit, audited opt-out for this plan. */}
                    {editingPlanCode && (() => {
                        const subs = plans.find((p) => p.code === editingPlanCode)?.subscriber_count || 0;
                        if (!subs) return null;
                        return (
                            <Alert severity="info" sx={{ mb: 2 }}
                                action={
                                    <Button
                                        color="inherit" size="small"
                                        disabled={resyncState.isLoading}
                                        onClick={async () => {
                                            if (!window.confirm(
                                                `Push this plan's CURRENT terms to all ${subs} subscribed tenant(s)? `
                                                + 'Their feature set and limits will be replaced immediately.')) return;
                                            try {
                                                const r = await resyncSubscribers(
                                                    isVendor ? editingPlanCode
                                                        : { code: editingPlanCode, scope: 'reseller' }).unwrap();
                                                notify('success', `${r?.data?.resynced ?? subs} subscription(s) updated.`);
                                            } catch (err) {
                                                notify('error', err?.data?.error || 'Re-sync failed.');
                                            }
                                        }}
                                    >
                                        Push to {subs} subscriber{subs === 1 ? '' : 's'}
                                    </Button>
                                }
                            >
                                {subs} tenant{subs === 1 ? ' is' : 's are'} subscribed to this plan.
                                They keep the terms from their subscription time — changes here apply
                                only to new subscriptions (or use Push to migrate everyone).
                            </Alert>
                        );
                    })()}
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Code"
                                value={planForm.code}
                                onChange={(e) => setPlanForm({ ...planForm, code: e.target.value })}
                                disabled={Boolean(editingPlanCode)}
                                helperText="Stable identifier, e.g. plan2"
                                size="small"
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Name"
                                value={planForm.name}
                                onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                                size="small"
                                sx={{ flex: 2 }}
                            />
                        </Stack>
                        <FormControl size="small" fullWidth>
                            <InputLabel>Plan type</InputLabel>
                            <Select
                                label="Plan type"
                                value={planForm.saas_plan_type_id || ''}
                                onChange={(e) =>
                                    setPlanForm({
                                        ...planForm,
                                        saas_plan_type_id: e.target.value || null,
                                    })
                                }
                            >
                                <MenuItem value="">
                                    <em>None</em>
                                </MenuItem>
                                {planTypes.map((pt) => (
                                    <MenuItem key={pt.id} value={pt.id}>
                                        {pt.name} ({pt.code})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            label="Description"
                            value={planForm.description}
                            onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })}
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                        />

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

                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Trial days"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={planForm.trial_days ?? 0}
                                onChange={(e) =>
                                    setPlanForm({ ...planForm, trial_days: Number(e.target.value) })
                                }
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Grace days"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={planForm.grace_period_days ?? 0}
                                onChange={(e) =>
                                    setPlanForm({ ...planForm, grace_period_days: Number(e.target.value) })
                                }
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Data retention (days)"
                                type="number"
                                size="small"
                                inputProps={{ min: 1 }}
                                helperText="After suspension, data stays this long before S3 archive + purge"
                                value={planForm.data_retention_days ?? 180}
                                onChange={(e) =>
                                    setPlanForm({ ...planForm, data_retention_days: Number(e.target.value) })
                                }
                                sx={{ flex: 1 }}
                            />
                        </Stack>

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
                            {isVendor && (
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={!!planForm.is_default}
                                            onChange={(e) =>
                                                setPlanForm({ ...planForm, is_default: e.target.checked })
                                            }
                                        />
                                    }
                                    label="Default plan (auto-assigned to new tenants when no plan_code is supplied)"
                                />
                            )}
                            {/* Apex / reseller plan — vendor console only
                                (the reseller surface must never author
                                apex plans; the backend enforces the same).
                                A tenant subscribed to an apex plan gets the
                                reseller console and may create child
                                tenants up to these quotas. */}
                            {isVendor && !isReceiverPlan && (
                                <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={planForm.kind === 'apex'}
                                                onChange={(e) =>
                                                    setPlanForm({
                                                        ...planForm,
                                                        kind: e.target.checked ? 'apex' : 'normal',
                                                        ...(e.target.checked ? {} : {
                                                            max_child_subdomains: null,
                                                            max_child_custom_domains: null,
                                                        }),
                                                    })
                                                }
                                            />
                                        }
                                        label="Apex (reseller) plan — subscribers can sell tenancies to their own child tenants"
                                    />
                                    {planForm.kind === 'apex' && (
                                        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                                            <TextField
                                                size="small" type="number"
                                                label="Max child subdomains"
                                                value={planForm.max_child_subdomains ?? ''}
                                                onChange={(e) =>
                                                    setPlanForm({
                                                        ...planForm,
                                                        max_child_subdomains:
                                                            e.target.value === '' ? null : Number(e.target.value),
                                                    })
                                                }
                                                helperText="Children on <slug>.<apex-domain>"
                                            />
                                            <TextField
                                                size="small" type="number"
                                                label="Max child custom domains"
                                                value={planForm.max_child_custom_domains ?? ''}
                                                onChange={(e) =>
                                                    setPlanForm({
                                                        ...planForm,
                                                        max_child_custom_domains:
                                                            e.target.value === '' ? null : Number(e.target.value),
                                                    })
                                                }
                                                helperText="Children on their own domains"
                                            />
                                        </Stack>
                                    )}
                                </Box>
                            )}
                            <FormControl size="small" sx={{ minWidth: 180 }}>
                                <InputLabel>Over-limit action</InputLabel>
                                <Select
                                    label="Over-limit action"
                                    value={planForm.over_limit_action || 'block_new'}
                                    onChange={(e) =>
                                        setPlanForm({ ...planForm, over_limit_action: e.target.value })
                                    }
                                >
                                    <MenuItem value="block_new">Block new (default)</MenuItem>
                                    <MenuItem value="grace_then_suspend">Grace then suspend</MenuItem>
                                    <MenuItem value="suspend_immediately">Suspend immediately</MenuItem>
                                </Select>
                            </FormControl>
                        </Stack>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Seat limits
                            </Typography>
                            <SeatLimitsEditor value={seatValue} onChange={setSeats} />
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                                Provider-entity quotas (in-tenant marketplace)
                            </Typography>
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mb: 1 }}
                            >
                                How many doctor / clinic / hospital entities the
                                tenant may register <em>inside their own subdomain</em>.
                                Separate axis from team-seat counts above.
                            </Typography>
                            <ProviderEntityQuotasEditor
                                value={{
                                    doctor: planForm.max_provider_doctors,
                                    clinic: planForm.max_provider_clinics,
                                    hospital: planForm.max_provider_hospitals,
                                }}
                                onChange={(v) =>
                                    setPlanForm({
                                        ...planForm,
                                        max_provider_doctors: v.doctor,
                                        max_provider_clinics: v.clinic,
                                        max_provider_hospitals: v.hospital,
                                    })
                                }
                            />
                        </Box>

                        <Divider />

                        {/* A receiver (patient) plan sells a list of promises;
                            a provider plan sells add-ons + a feature tree. The
                            two are mutually exclusive, and whichever side is
                            hidden is sent empty — see ``buildPlanPayload``. */}
                        {/* Marketing highlights — every plan kind. Rendered
                            verbatim on the public pricing card; entitlement
                            still lives in the feature tree below. */}
                        {!isReceiverPlan && (
                            <Box>
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    Marketing highlights (pricing page)
                                </Typography>
                                <BenefitsEditor
                                    value={planForm.benefits || []}
                                    onChange={(benefits) => setPlanForm({ ...planForm, benefits })}
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                    Free-text bullets shown on the plan card. Leave empty to
                                    fall back to the structured feature list.
                                </Typography>
                            </Box>
                        )}
                        {isVendor && planForm.kind === 'apex' && (
                            <ChildCapsEditor
                                value={planForm.child_plan_caps}
                                onChange={(caps) => setPlanForm(
                                    { ...planForm, child_plan_caps: caps })}
                            />
                        )}
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
                                    <b>/join_receiver</b>. Receiver plans carry no add-ons and no
                                    feature tree — those are saved empty for this plan type.
                                </Typography>
                            </Box>
                        ) : (
                            <>
                                {isVendor && (
                                <Box>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                        Default add-ons (auto-attached on subscribe)
                                    </Typography>
                                    <FormControl size="small" fullWidth>
                                        <Select
                                            multiple
                                            value={planForm.default_addons || []}
                                            onChange={(e) =>
                                                setPlanForm({ ...planForm, default_addons: e.target.value })
                                            }
                                            renderValue={(selected) => (
                                                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                                    {selected.length === 0 && <em>None</em>}
                                                    {selected.map((c) => (
                                                        <Chip key={c} size="small" label={c} />
                                                    ))}
                                                </Stack>
                                            )}
                                        >
                                            {activeAddonCodes.length === 0 && (
                                                <MenuItem disabled>(no active add-ons in catalog)</MenuItem>
                                            )}
                                            {activeAddonCodes.map((c) => (
                                                <MenuItem key={c} value={c}>{c}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                        When this plan is assigned to a tenant, these add-ons will be auto-attached
                                        in dependency order (prerequisites first). Only <b>active</b> add-ons appear
                                        here; create them in <em>Add-ons</em> first.
                                    </Typography>
                                </Box>
                                )}
                                {isVendor && (
                                    <AddonCatalogueSummary addons={addons || []} />
                                )}
                                {isVendor ? (
                                    <PlanAddonTermsEditor
                                        value={planForm.addon_terms}
                                        onChange={(terms) => setPlanForm(
                                            { ...planForm, addon_terms: terms })}
                                        addons={addons || []}
                                    />
                                ) : (
                                    <PlanAddonTermsEditor
                                        title="Resale add-ons for tenants on this plan"
                                        value={planForm.addon_terms}
                                        onChange={(terms) => setPlanForm(
                                            { ...planForm, addon_terms: terms })}
                                        addons={(resellerCatalogue || []).map((a) => ({
                                            ...a, status: 'active',
                                        }))}
                                        costOf={(a) => {
                                            const s = a.subdomain_child;
                                            const d = a.custom_domain_child;
                                            const part = (t, lbl) => (t && t.price_inr != null
                                                ? `${lbl} ₹${t.price_inr}` : null);
                                            const bits = [part(s, 'sub'), part(d, 'dom')]
                                                .filter(Boolean);
                                            return bits.length
                                                ? `you pay ${bits.join(' · ')}` : null;
                                        }}
                                    />
                                )}
                                {isVendor && (
                                    <Box>
                                        <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                            Show add-on lines on the card:
                                        </Typography>
                                        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                                            {[['show_addons_main', 'Main tenant'],
                                              ['show_addons_subdomain_child', 'Subdomain child'],
                                              ['show_addons_custom_domain_child', 'Custom-domain child']].map(([k, label]) => (
                                                <FormControlLabel
                                                    key={k}
                                                    control={(
                                                        <Checkbox
                                                            size="small"
                                                            checked={(planForm.card_display || {})[k] !== false}
                                                            onChange={(e) => {
                                                                const cd = { ...(planForm.card_display || {}) };
                                                                if (e.target.checked) delete cd[k];
                                                                else cd[k] = false;
                                                                setPlanForm({
                                                                    ...planForm,
                                                                    card_display: Object.keys(cd).length ? cd : null,
                                                                });
                                                            }}
                                                        />
                                                    )}
                                                    label={label}
                                                    slotProps={{ typography: { variant: 'caption' } }}
                                                />
                                            ))}
                                        </Stack>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                            Display only — the plan keeps every add-on and price either way.
                                        </Typography>
                                    </Box>
                                )}
                                <PlanCardPreview
                                    planForm={planForm}
                                    addons={addons || []}
                                />
                                {isVendor && (
                                    <BuilderCart
                                        planForm={planForm}
                                        addons={addons || []}
                                    />
                                )}

                                <Divider />

                                <Box>
                                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                        Features
                                    </Typography>
                                    <FeatureTreeEditor
                                        value={planForm.features || {}}
                                        onChange={(features) => setPlanForm({ ...planForm, features })}
                                        {...(isVendor ? {} : { usePathsHook: useResellerFeaturePaths })}
                                    />
                                </Box>
                            </>
                        )}

                        <Alert severity="info">
                            Backend constraint: sum of per-role limits must be ≤ total. Plans start in
                            <b> draft</b>; flip to <b>active</b> via Edit before assigning to tenants.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
                    {planBlockingError && (
                        <Typography variant="caption" color="error"
                            sx={{ mr: 'auto', maxWidth: 460 }}>
                            {planBlockingError}
                        </Typography>
                    )}
                    <Button onClick={closePlanDialog}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSavePlan}
                        disabled={isSavingPlan || !planForm.code
                            || !planForm.name || Boolean(planBlockingError)}
                    >
                        {editingPlanCode ? 'Save changes' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={planTypeDialogOpen} onClose={closePlanTypeDialog} fullWidth maxWidth="xs">
                <DialogTitle>
                    {editingPlanTypeId ? `Edit plan type: ${planTypeForm.code}` : 'New plan type'}
                </DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Code"
                            value={planTypeForm.code}
                            onChange={(e) => setPlanTypeForm({ ...planTypeForm, code: e.target.value.toLowerCase() })}
                            disabled={Boolean(editingPlanTypeId)}
                            helperText={editingPlanTypeId
                                ? 'Permanent — plans and the pricing page select by this code'
                                : 'Stable identifier, e.g. clinic — permanent once created'}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Name"
                            value={planTypeForm.name}
                            onChange={(e) => setPlanTypeForm({ ...planTypeForm, name: e.target.value })}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Description"
                            value={planTypeForm.description}
                            onChange={(e) => setPlanTypeForm({ ...planTypeForm, description: e.target.value })}
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                        />
                        {/* Remounts per dialog open so the local text state
                            re-seeds from whichever plan type is being edited. */}
                        <IconKeyField
                            key={editingPlanTypeId || 'new'}
                            value={planTypeForm.icon_key}
                            onChange={(next) => setPlanTypeForm({ ...planTypeForm, icon_key: next })}
                        />
                        <TextField
                            select
                            label="Market category"
                            helperText="Which industry pricing page lists this type"
                            value={planTypeForm.category_id || ''}
                            onChange={(e) => setPlanTypeForm({ ...planTypeForm, category_id: e.target.value })}
                            size="small"
                            fullWidth
                            SelectProps={{ native: true }}
                            InputLabelProps={{ shrink: true }}
                        >
                            <option value="">(default category)</option>
                            {saasCategories.map((c) => (
                                <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
                            ))}
                        </TextField>
                        <Box>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!!planTypeForm.is_receiver}
                                        onChange={(e) =>
                                            setPlanTypeForm({
                                                ...planTypeForm,
                                                is_receiver: e.target.checked,
                                            })
                                        }
                                    />
                                }
                                label="Service-receiver (patient) type"
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                On, this type&apos;s plans are listed on <b>/join_receiver</b> for
                                patients. Off, they appear on <b>/pricing</b> for providers. The two
                                pages filter on this same flag, so a type shows on exactly one of them.
                            </Typography>
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closePlanTypeDialog}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSavePlanType}
                        disabled={isSavingPlanType || !planTypeForm.code || !planTypeForm.name}
                    >
                        {editingPlanTypeId ? 'Save changes' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default PlansAdmin;
