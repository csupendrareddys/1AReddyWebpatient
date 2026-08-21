/**
 * Recovery Plans (new look) — port of the mobile MVP's
 * ``app/more/recovery-plans.tsx``: short guided programmes for a specific
 * illness, with Browse Plans / My Plans tabs, a plan-detail dialog listing
 * what's included, and a Start action.
 *
 * Runs on ASSUMED endpoints #5/#6/#7 (api/assumedEndpoints.js) — recovery
 * plans don't exist as a product in this backend yet. The page states that
 * when the calls 404 instead of showing an invented catalogue.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, IconButton, Typography,
} from '@mui/material';
import NLCard from '../../components/NLCard';
import NLBadge from '../../components/NLBadge';
import NLIcon from '../../components/NLIcon';
import NLEmptyState from '../../components/NLEmptyState';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import {
    useGetNLRecoveryPlansQuery, useGetNLRecoveryPlanOrdersQuery,
    useOrderNLRecoveryPlanMutation, isMissingEndpoint,
} from '../../api/assumedEndpoints';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { fmtDate, humanise, inr } from '../../utils/format';

/** Order status → badge tone, straight from the mobile file. */
const STATUS_TONE = {
    pending: 'warning',
    confirmed: 'primary',
    rejected: 'neutral',
    in_process: 'primary',
    completed: 'success',
    cancelled: 'neutral',
};

const RecoveryPlans = () => {
    const [tab, setTab] = useState('browse');
    const [detail, setDetail] = useState(null);
    const [started, setStarted] = useState(false);
    const [orderError, setOrderError] = useState(null);

    const { data: plans = [], isLoading: plansLoading, error: plansError } = useGetNLRecoveryPlansQuery();
    const { data: orders = [], isLoading: ordersLoading } = useGetNLRecoveryPlanOrdersQuery();
    const [orderPlan, { isLoading: ordering }] = useOrderNLRecoveryPlanMutation();

    const start = async (plan) => {
        setOrderError(null);
        try {
            await orderPlan(plan.id).unwrap();
            setStarted(true);
        } catch (e) {
            setOrderError(isMissingEndpoint(e)
                ? 'Starting a plan needs POST /api/patient/recovery-plans/<id>/order, which doesn’t exist yet.'
                : e?.data?.error || e?.data?.message || 'Couldn’t start the plan.');
        }
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Recovery Plans</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Short, guided plans that see you through a specific illness — day one to recovery.
            </Typography>

            <NLAssumedNotice error={plansError} endpoint="GET /api/patient/recovery-plans" />

            {/* ── Browse / My Plans tabs ───────────────────────────────── */}
            <Box
                sx={{
                    display: 'flex',
                    bgcolor: colors.surface,
                    borderRadius: `${radius.sm}px`,
                    border: `1px solid ${colors.border}`,
                    p: '4px',
                    mb: 2.25,
                }}
            >
                {[
                    { key: 'browse', label: 'Browse Plans' },
                    { key: 'orders', label: `My Plans (${orders.length})` },
                ].map((t) => (
                    <ButtonBase
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        sx={{
                            flex: 1,
                            py: 1.1,
                            borderRadius: `${radius.sm - 2}px`,
                            bgcolor: tab === t.key ? colors.primary : 'transparent',
                            color: tab === t.key ? colors.white : colors.textSecondary,
                            fontSize: 12.5,
                            fontWeight: 600,
                        }}
                    >
                        {t.label}
                    </ButtonBase>
                ))}
            </Box>

            {tab === 'browse' ? (
                plansLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                        <CircularProgress />
                    </Box>
                ) : plans.length ? (
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                            gap: '12px',
                        }}
                    >
                        {plans.map((p) => (
                            <NLCard key={p.id} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}>
                                    <Box
                                        sx={{
                                            width: 36,
                                            height: 36,
                                            borderRadius: '50%',
                                            bgcolor: tint(colors.primary, 0.1),
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                        }}
                                    >
                                        <NLIcon name="thermometer-outline" size={17} color={colors.primary} />
                                    </Box>
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography sx={typography.h3}>
                                            {p.condition ? `${p.condition} Recovery Plan` : p.name}
                                        </Typography>
                                        <Typography sx={typography.caption}>
                                            {p.duration_label || `${p.duration_days} days`} guided programme
                                        </Typography>
                                    </Box>
                                    <NLBadge
                                        label={p.duration_label || `${p.duration_days}d`}
                                        tone="primary"
                                    />
                                </Box>
                                <Typography sx={{ ...typography.bodyMuted, ...clamp(3) }}>
                                    {p.description}
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        mt: 'auto',
                                    }}
                                >
                                    <Typography sx={{ fontSize: 21, fontWeight: 800, color: colors.primary }}>
                                        {inr(p.price)}
                                    </Typography>
                                    <Button
                                        variant="contained"
                                        size="small"
                                        onClick={() => { setDetail(p); setStarted(false); setOrderError(null); }}
                                    >
                                        View &amp; start
                                    </Button>
                                </Box>
                            </NLCard>
                        ))}
                    </Box>
                ) : (
                    <NLEmptyState
                        icon="thermometer-outline"
                        title="No recovery plans yet"
                        subtitle="Plans appear here once the catalogue is published."
                    />
                )
            ) : ordersLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : orders.length ? (
                orders.map((o) => (
                    <NLCard key={o.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.25 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={typography.body}>{o.plan_name}</Typography>
                            <Typography sx={typography.bodyMuted}>
                                Started {fmtDate(o.ordered_on) || o.ordered_on}
                            </Typography>
                        </Box>
                        <Box sx={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 700, color: colors.textPrimary }}>
                                {inr(o.amount)}
                            </Typography>
                            <NLBadge
                                label={humanise(o.status)}
                                tone={STATUS_TONE[o.status] || 'neutral'}
                            />
                        </Box>
                    </NLCard>
                ))
            ) : (
                <NLEmptyState
                    icon="thermometer-outline"
                    title="No plans yet"
                    subtitle="Start one from Browse Plans and it appears here."
                />
            )}

            {/* ── Plan detail / start dialog ───────────────────────────── */}
            <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ ...typography.h3, flex: 1 }}>
                        {detail?.name || ''}
                    </Typography>
                    <IconButton size="small" onClick={() => setDetail(null)} aria-label="Close">
                        <NLIcon name="close" size={20} color={colors.textSecondary} />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {detail && started ? (
                        <Box sx={{ textAlign: 'center', py: 1.5 }}>
                            <NLIcon name="checkmark-circle" size={44} color={colors.success} />
                            <Typography sx={{ ...typography.h3, mt: 1.5 }}>Plan started</Typography>
                            <Typography sx={{ ...typography.bodyMuted, mt: 0.5 }}>
                                Day 1 of {detail.duration_days} begins today. Your care team will
                                check in shortly.
                            </Typography>
                        </Box>
                    ) : detail ? (
                        <>
                            <Typography sx={{ fontSize: 21, fontWeight: 800, color: colors.primary }}>
                                {inr(detail.price)}
                            </Typography>
                            <Typography sx={typography.caption}>
                                {detail.duration_label || `${detail.duration_days} days`} · taxes included
                            </Typography>
                            <Typography sx={{ ...typography.body, mt: 1.5 }}>
                                {detail.description}
                            </Typography>

                            {(detail.includes || []).length ? (
                                <>
                                    <Typography sx={{ ...typography.label, mt: 2, mb: 0.75 }}>
                                        WHAT&apos;S INCLUDED
                                    </Typography>
                                    {detail.includes.map((inc) => (
                                        <Box
                                            key={inc}
                                            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.4 }}
                                        >
                                            <NLIcon name="checkmark-circle" size={15} color={colors.secondaryDark} />
                                            <Typography sx={typography.body}>{inc}</Typography>
                                        </Box>
                                    ))}
                                </>
                            ) : null}

                            {orderError ? (
                                <Alert severity="warning" sx={{ mt: 2 }} onClose={() => setOrderError(null)}>
                                    {orderError}
                                </Alert>
                            ) : null}
                        </>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    {started ? (
                        <Button
                            variant="contained"
                            onClick={() => { setDetail(null); setTab('orders'); }}
                        >
                            Done
                        </Button>
                    ) : (
                        <>
                            <Button onClick={() => setDetail(null)}>Cancel</Button>
                            <Button
                                variant="contained"
                                disabled={ordering}
                                onClick={() => detail && start(detail)}
                            >
                                {ordering ? 'Starting…' : detail ? `Start plan · ${inr(detail.price)}` : ''}
                            </Button>
                        </>
                    )}
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default RecoveryPlans;
