/**
 * Bookings (new look) — every product the patient has bought, on one screen.
 *
 * Ported from the patient mobile MVP's ``app/(tabs)/appointments.tsx`` and
 * wired to this app's real endpoints through {@link useNewLookBookings}:
 * consultations, marketplace services and health plans, folded onto one status
 * axis.
 *
 * Two axes, deliberately kept apart: **status** (what stage it's at) as the
 * sub-heads, and **category** (what kind of product) as a filter that defaults
 * to All. Folding them together is what made the old two-mode screen
 * confusing — the same booking appeared or vanished depending on which mode you
 * happened to have left it in.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, ButtonBase, CircularProgress, Typography } from '@mui/material';
import NLIcon from '../../components/NLIcon';
import NLItemViews from '../../components/NLItemViews';
import NLEmptyState from '../../components/NLEmptyState';
import NLViewSwitcher from '../../components/NLViewSwitcher';
import NLBookingDetailDialog from '../../components/NLBookingDetailDialog';
import useNewLookBookings, {
    VIEW_ICON, VIEW_ORDER, VIEW_STATUS_LABEL, VIEW_SUBTITLE, VIEW_TINT, VIEW_TITLE,
} from '../../hooks/useNewLookBookings';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import { colors, radius, tint, typography } from '../../theme/tokens';

const ALL = 'all';

const Bookings = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    // The Home tiles deep-link straight to a status, so arriving here already
    // shows what was tapped.
    const [searchParams, setSearchParams] = useSearchParams();
    const urlView = searchParams.get('view');
    // In progress is the default: it's the care that's live right now, which
    // is what someone opening "Bookings" cold most wants to see.
    const view = VIEW_ORDER.includes(urlView) ? urlView : 'in_progress';
    const urlCategory = searchParams.get('category') || ALL;

    const [mode, setMode] = useState('list');
    const [detail, setDetail] = useState(null);

    const {
        byView, counts, pendingSplit, cancelledCount,
        categoriesInView, isLoading, isError, failed,
    } = useNewLookBookings();

    const all = byView[view] || [];
    const cats = useMemo(() => categoriesInView(view), [byView, view]);
    // A category with nothing in the newly-selected status shouldn't leave the
    // patient staring at an empty list — fall back to All.
    const activeCat = urlCategory !== ALL && cats.some((c) => c.key === urlCategory)
        ? urlCategory
        : ALL;
    const rows = activeCat === ALL ? all : all.filter((r) => r.categoryKey === activeCat);

    // Chip clicks replace rather than push: the status row is a filter, not a
    // trail of pages, and flooding history would make Back useless.
    const setParams = (next) => {
        const params = new URLSearchParams(searchParams);
        Object.entries(next).forEach(([k, v]) => {
            if (v == null || v === ALL) params.delete(k);
            else params.set(k, v);
        });
        setSearchParams(params, { replace: true });
    };

    const at = VIEW_ORDER.indexOf(view);
    const prevView = at > 0 ? VIEW_ORDER[at - 1] : null;
    const nextView = at < VIEW_ORDER.length - 1 ? VIEW_ORDER[at + 1] : null;

    const openFull = (booking) => {
        setDetail(null);
        navigate(`${basePath}/${booking.target || 'my-appointments'}`);
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>My Appointments</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Consultations, services and health plans — every stage in one place.
            </Typography>

            {failed.length && !isError ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Couldn’t load your {failed.join(' and ')} just now — everything else is shown.
                </Alert>
            ) : null}

            {isError ? (
                <Alert severity="error">Couldn’t load your bookings. Please try again.</Alert>
            ) : isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
                    <CircularProgress />
                </Box>
            ) : (
                <>
                    {/* ── Status sub-heads ─────────────────────────────── */}
                    <Box
                        sx={{
                            display: 'flex',
                            gap: '8px',
                            pb: 1.75,
                            overflowX: 'auto',
                            flexWrap: { xs: 'nowrap', md: 'wrap' },
                            scrollbarWidth: 'none',
                            '&::-webkit-scrollbar': { display: 'none' },
                        }}
                    >
                        {VIEW_ORDER.map((v) => {
                            const active = view === v;
                            return (
                                <ButtonBase
                                    key={v}
                                    onClick={() => setParams({ view: v })}
                                    aria-pressed={active}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        px: '13px',
                                        py: '9px',
                                        borderRadius: '20px',
                                        flexShrink: 0,
                                        border: `1px solid ${active ? VIEW_TINT[v] : colors.border}`,
                                        bgcolor: active ? VIEW_TINT[v] : colors.surface,
                                    }}
                                >
                                    <NLIcon
                                        name={VIEW_ICON[v]}
                                        size={14}
                                        color={active ? colors.white : colors.textSecondary}
                                    />
                                    <Typography
                                        sx={{
                                            fontSize: 12.5,
                                            fontWeight: 700,
                                            color: active ? colors.white : colors.textSecondary,
                                        }}
                                    >
                                        {VIEW_TITLE[v]}
                                    </Typography>
                                    <Box
                                        sx={{
                                            minWidth: 20,
                                            px: '5px',
                                            py: '1px',
                                            borderRadius: '10px',
                                            textAlign: 'center',
                                            bgcolor: active ? 'rgba(255,255,255,0.28)' : colors.background,
                                        }}
                                    >
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                fontWeight: 800,
                                                color: active ? colors.white : colors.textSecondary,
                                            }}
                                        >
                                            {counts[v]}
                                        </Typography>
                                    </Box>
                                </ButtonBase>
                            );
                        })}
                    </Box>

                    {/* ── Category filter, All by default ──────────────── */}
                    {cats.length ? (
                        <>
                            <Typography sx={{ ...typography.label, mb: 1 }}>
                                FILTER BY CATEGORY
                            </Typography>
                            <Box
                                sx={{
                                    display: 'flex',
                                    gap: '7px',
                                    pb: 1.75,
                                    overflowX: 'auto',
                                    flexWrap: { xs: 'nowrap', md: 'wrap' },
                                    scrollbarWidth: 'none',
                                    '&::-webkit-scrollbar': { display: 'none' },
                                }}
                            >
                                <CatChip
                                    icon="albums-outline"
                                    label="All"
                                    count={all.length}
                                    active={activeCat === ALL}
                                    onClick={() => setParams({ category: ALL })}
                                />
                                {cats.map((c) => (
                                    <CatChip
                                        key={c.key}
                                        label={c.label}
                                        count={c.count}
                                        active={activeCat === c.key}
                                        onClick={() => setParams({
                                            category: activeCat === c.key ? ALL : c.key,
                                        })}
                                    />
                                ))}
                            </Box>
                        </>
                    ) : null}

                    {/* What this stage means, and — for Pending — the split the
                        patient actually cares about, since only the unpaid half is
                        theirs to clear. */}
                    <Box sx={{ mb: 1.5 }}>
                        <Typography sx={typography.bodyMuted}>{VIEW_SUBTITLE[view]}</Typography>
                        {view === 'pending' && (pendingSplit.payment || pendingSplit.approval) ? (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: 0.75 }}>
                                {pendingSplit.payment ? (
                                    <StageChip
                                        icon="card-outline"
                                        label={`${pendingSplit.payment} awaiting payment`}
                                        tone={colors.error}
                                    />
                                ) : null}
                                {pendingSplit.approval ? (
                                    <StageChip
                                        icon="time-outline"
                                        label={`${pendingSplit.approval} awaiting approval`}
                                        tone={VIEW_TINT.pending}
                                    />
                                ) : null}
                            </Box>
                        ) : null}
                        {view === 'completed' && cancelledCount ? (
                            <Box sx={{ mt: 0.75 }}>
                                <StageChip
                                    icon="close-circle-outline"
                                    label={`includes ${cancelledCount} cancelled, rejected or expired`}
                                    tone={colors.error}
                                />
                            </Box>
                        ) : null}
                    </Box>

                    <NLViewSwitcher
                        mode={mode}
                        onChange={setMode}
                        hint={mode === 'slide'
                            ? 'Swipe · auto every 24s'
                            : `${rows.length} of ${all.length} ${VIEW_TITLE[view].toLowerCase()}`}
                    />

                    {rows.length ? (
                        <NLItemViews
                            mode={mode}
                            intervalSec={24}
                            showPrice={false}
                            tableTypeLabel="Product"
                            items={rows.map((r) => ({
                                id: r.id,
                                title: r.title,
                                subtitle: r.subtitle,
                                meta: r.meta,
                                badge: r.kindLabel,
                                // In Pending, say WHAT it's waiting on — the patient
                                // can clear a payment themselves but can only wait on
                                // an approval. Elsewhere the raw stage is enough.
                                note: r.pendingLabel || r.statusLabel,
                                noteIcon: r.pendingReason === 'payment'
                                    ? 'card-outline'
                                    : 'time-outline',
                                // A rejected / expired booking still lives in
                                // Completed, so the outcome rides on the row.
                                tag: r.cancelledTag,
                                tagTone: 'error',
                                price: null,
                                icon: r.icon,
                                tint: r.tint,
                                caps: r.caps,
                            }))}
                            onPress={(id) => setDetail(rows.find((x) => x.id === id) || null)}
                        />
                    ) : (
                        <NLEmptyState
                            icon={VIEW_ICON[view]}
                            title={activeCat === ALL
                                ? `Nothing ${VIEW_TITLE[view].toLowerCase()}`
                                : `Nothing ${VIEW_TITLE[view].toLowerCase()} in this category`}
                            subtitle={activeCat === ALL
                                ? 'Book something from Book Appointments to see it here.'
                                : 'Clear the filter to see everything at this stage.'}
                        />
                    )}

                    {/* Step through the stages in order rather than forcing a trip
                        back up to the chips. */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'stretch',
                            justifyContent: 'space-between',
                            gap: 1.25,
                            mt: 2.5,
                        }}
                    >
                        {prevView ? (
                            <PagerButton
                                hint="Previous"
                                label={VIEW_TITLE[prevView]}
                                icon="arrow-back"
                                onClick={() => setParams({ view: prevView })}
                            />
                        ) : <Box sx={{ flex: 1 }} />}
                        {nextView ? (
                            <PagerButton
                                hint="Next"
                                label={VIEW_TITLE[nextView]}
                                icon="arrow-forward"
                                align="end"
                                onClick={() => setParams({ view: nextView })}
                            />
                        ) : <Box sx={{ flex: 1 }} />}
                    </Box>
                </>
            )}

            <NLBookingDetailDialog
                open={!!detail}
                booking={detail}
                statusLabel={VIEW_STATUS_LABEL[view]}
                onClose={() => setDetail(null)}
                onOpenFull={openFull}
                onRebook={() => {
                    setDetail(null);
                    navigate(`${basePath}/newlook/book`);
                }}
                onViewCredits={() => {
                    setDetail(null);
                    navigate(`${basePath}/spending`);
                }}
            />
        </Box>
    );
};

/** A read-only count chip under the stage heading. */
const StageChip = ({ icon, label, tone }) => (
    <Box
        sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            px: '9px',
            py: '3px',
            borderRadius: '10px',
            bgcolor: tint(tone, 0.1),
        }}
    >
        <NLIcon name={icon} size={12} color={tone} />
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: tone }}>{label}</Typography>
    </Box>
);

const CatChip = ({ icon, label, count, active, onClick }) => (
    <ButtonBase
        onClick={onClick}
        aria-pressed={active}
        sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            px: '12px',
            py: '7px',
            borderRadius: '16px',
            flexShrink: 0,
            border: `1px solid ${active ? colors.textPrimary : colors.border}`,
            bgcolor: active ? colors.textPrimary : colors.surface,
        }}
    >
        {icon ? (
            <NLIcon
                name={icon}
                size={13}
                color={active ? colors.white : colors.textSecondary}
            />
        ) : null}
        <Typography
            sx={{
                fontSize: 12,
                fontWeight: 600,
                color: active ? colors.white : colors.textSecondary,
            }}
        >
            {label}
        </Typography>
        <Box
            sx={{
                minWidth: 18,
                px: '5px',
                borderRadius: '9px',
                textAlign: 'center',
                bgcolor: active ? 'rgba(255,255,255,0.28)' : colors.background,
            }}
        >
            <Typography
                sx={{
                    fontSize: 10.5,
                    fontWeight: 800,
                    color: active ? colors.white : colors.textSecondary,
                }}
            >
                {count}
            </Typography>
        </Box>
    </ButtonBase>
);

const PagerButton = ({ hint, label, icon, align, onClick }) => (
    <ButtonBase
        onClick={onClick}
        sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
            gap: 1,
            py: 1.25,
            px: 1.5,
            borderRadius: `${radius.sm}px`,
            border: `1px solid ${colors.border}`,
            bgcolor: colors.surface,
        }}
    >
        {align === 'end' ? null : <NLIcon name={icon} size={16} color={colors.primary} />}
        <Box sx={{ textAlign: align === 'end' ? 'right' : 'left', minWidth: 0 }}>
            <Typography
                sx={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: colors.textMuted,
                    textTransform: 'uppercase',
                }}
            >
                {hint}
            </Typography>
            <Typography
                sx={{ fontSize: 13, fontWeight: 600, color: colors.primary, mt: '1px' }}
                noWrap
            >
                {label}
            </Typography>
        </Box>
        {align === 'end' ? <NLIcon name={icon} size={16} color={colors.primary} /> : null}
    </ButtonBase>
);

export default Bookings;
