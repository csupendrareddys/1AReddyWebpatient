/**
 * My Bookings (category wise) — everything bought, grouped by what KIND of
 * product it is rather than by which stage it's at.
 *
 * The stage axis lives on My Appointments; this is the other way to read the
 * same rows, and it reads them from the same {@link useNewLookBookings} source
 * so a count here can never disagree with a count there.
 *
 * ``?kind=`` selects the group:
 *   consultation → My Appointments
 *   plans        → Health Care Plans (both kinds below, together)
 *   service      → My Service Plans
 *   group        → My Group Service Plans (Health)
 *   (absent)     → everything, one section per group
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Box, ButtonBase, CircularProgress, Typography } from '@mui/material';
import NLIcon from '../../components/NLIcon';
import NLItemViews from '../../components/NLItemViews';
import NLEmptyState from '../../components/NLEmptyState';
import NLViewSwitcher from '../../components/NLViewSwitcher';
import NLBookingDetailDialog from '../../components/NLBookingDetailDialog';
import useNewLookBookings, {
    VIEW_ICON, VIEW_ORDER, VIEW_STATUS_LABEL, VIEW_TINT, VIEW_TITLE,
} from '../../hooks/useNewLookBookings';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import { colors, radius, typography } from '../../theme/tokens';

/**
 * The groups, and which unified-row kinds each collects. ``consultation`` also
 * takes follow-ups: a follow-up IS an appointment, just one the doctor offered.
 */
const GROUPS = [
    {
        key: 'consultation',
        label: 'My Appointments',
        subtitle: 'Consultations and the follow-ups your doctor has offered',
        icon: 'videocam-outline',
        tint: colors.primary,
        kinds: ['consultation', 'follow_up'],
    },
    {
        key: 'service',
        label: 'My Service Plans',
        subtitle: 'Individual services and packages bought from a provider',
        icon: 'storefront-outline',
        tint: colors.secondary,
        kinds: ['service'],
    },
    {
        key: 'group',
        label: 'My Group Service Plans (Health)',
        subtitle: 'Longer programmes run by a care team, and recovery plans',
        icon: 'heart-circle-outline',
        tint: '#5e35b1',
        kinds: ['plan', 'recovery'],
    },
];

/** ``?kind=`` → which groups to show. */
const SELECTION = {
    consultation: ['consultation'],
    service: ['service'],
    group: ['group'],
    plans: ['service', 'group'],
};

const Categories = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const [searchParams] = useSearchParams();
    const kind = searchParams.get('kind');

    // Sliding by default: grouped by kind, each section is a shelf to glance
    // along rather than a list to read top to bottom.
    const [mode, setMode] = useState('slide');
    // Each section carries its own stage row, defaulting to In progress —
    // the stage with something live in it. Kept per section because the
    // sections are independent: filtering appointments shouldn't silently
    // filter your service plans too.
    const [stageByGroup, setStageByGroup] = useState({});
    const stageOf = (key) => stageByGroup[key] || 'in_progress';
    const setStage = (key, view) => setStageByGroup((prev) => ({ ...prev, [key]: view }));
    const [detail, setDetail] = useState(null);

    const { rows, isLoading, isError, failed } = useNewLookBookings();

    const shownKeys = SELECTION[kind] || GROUPS.map((g) => g.key);
    const groups = GROUPS.filter((g) => shownKeys.includes(g.key));
    const title = kind === 'plans' ? 'Health Care Plans'
        : groups.length === 1 ? groups[0].label
            : 'My Bookings (category wise)';

    const openFull = (booking) => {
        setDetail(null);
        navigate(`${basePath}/${booking.target || 'my-appointments'}`);
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>{title}</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                {groups.length === 1
                    ? groups[0].subtitle
                    : 'Everything you’ve booked, grouped by what kind of product it is.'}
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
                    <NLViewSwitcher
                        mode={mode}
                        onChange={setMode}
                        hint={`${groups.reduce((n, g) => n + rows.filter((r) => g.kinds.includes(r.kind) && r.view === stageOf(g.key)).length, 0)} in view`}
                    />

                    {groups.map((g) => {
                        const inGroup = rows.filter((r) => g.kinds.includes(r.kind));
                        const stage = stageOf(g.key);
                        const items = inGroup.filter((r) => r.view === stage);
                        return (
                            <Box key={g.key} sx={{ mb: 3.5 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
                                    <NLIcon name={g.icon} size={18} color={g.tint} />
                                    <Typography sx={{ ...typography.h2, flex: 1 }}>
                                        {g.label}
                                    </Typography>
                                    <Box
                                        sx={{
                                            minWidth: 24,
                                            px: '7px',
                                            py: '2px',
                                            borderRadius: '11px',
                                            bgcolor: colors.background,
                                        }}
                                    >
                                        <Typography
                                            sx={{ fontSize: 12, fontWeight: 700, color: colors.textSecondary }}
                                        >
                                            {inGroup.length}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Typography sx={{ ...typography.bodyMuted, mb: 1.25 }}>
                                    {g.subtitle}
                                </Typography>

                                {/* Stage sub-heads for THIS section — scrolls
                                    sideways when the row won't fit. */}
                                <Box
                                    sx={{
                                        display: 'flex',
                                        gap: '7px',
                                        mb: 1.5,
                                        overflowX: 'auto',
                                        pb: '4px',
                                        scrollbarWidth: 'none',
                                        '&::-webkit-scrollbar': { display: 'none' },
                                    }}
                                >
                                    {VIEW_ORDER.map((v) => {
                                        const on = stage === v;
                                        const n = inGroup.filter((r) => r.view === v).length;
                                        return (
                                            <ButtonBase
                                                key={v}
                                                onClick={() => setStage(g.key, v)}
                                                aria-pressed={on}
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    px: '11px',
                                                    py: '7px',
                                                    borderRadius: '18px',
                                                    flexShrink: 0,
                                                    border: `1px solid ${on ? VIEW_TINT[v] : colors.border}`,
                                                    bgcolor: on ? VIEW_TINT[v] : colors.surface,
                                                }}
                                            >
                                                <NLIcon
                                                    name={VIEW_ICON[v]}
                                                    size={13}
                                                    color={on ? colors.white : colors.textSecondary}
                                                />
                                                <Typography
                                                    sx={{
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        color: on ? colors.white : colors.textSecondary,
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    {VIEW_TITLE[v]}
                                                </Typography>
                                                <Box
                                                    sx={{
                                                        minWidth: 18,
                                                        px: '5px',
                                                        borderRadius: '9px',
                                                        textAlign: 'center',
                                                        bgcolor: on ? 'rgba(255,255,255,0.28)' : colors.background,
                                                    }}
                                                >
                                                    <Typography
                                                        sx={{
                                                            fontSize: 10.5,
                                                            fontWeight: 800,
                                                            color: on ? colors.white : colors.textSecondary,
                                                        }}
                                                    >
                                                        {n}
                                                    </Typography>
                                                </Box>
                                            </ButtonBase>
                                        );
                                    })}
                                </Box>

                                {items.length ? (
                                    <NLItemViews
                                        mode={mode}
                                        intervalSec={22}
                                        showPrice={false}
                                        tableTypeLabel="Stage"
                                        items={items.map((r) => ({
                                            id: r.id,
                                            title: r.title,
                                            subtitle: r.subtitle,
                                            meta: r.meta,
                                            // Grouped by kind, the useful badge is
                                            // the STAGE — it's the axis this page
                                            // isn't sorted by.
                                            badge: VIEW_TITLE[r.view],
                                            note: r.pendingLabel || r.statusLabel,
                                            noteIcon: r.pendingReason === 'payment'
                                                ? 'card-outline' : 'time-outline',
                                            tag: r.cancelledTag,
                                            tagTone: 'error',
                                            price: null,
                                            icon: r.icon,
                                            tint: r.tint,
                                            caps: r.caps,
                                        }))}
                                        onPress={(id) => setDetail(items.find((x) => x.id === id) || null)}
                                    />
                                ) : (
                                    <Box
                                        sx={{
                                            p: 2,
                                            borderRadius: `${radius.md}px`,
                                            border: `1px dashed ${colors.border}`,
                                            bgcolor: colors.surface,
                                        }}
                                    >
                                        <Typography sx={typography.bodyMuted}>
                                            Nothing {VIEW_TITLE[stage].toLowerCase()} here.
                                        </Typography>
                                    </Box>
                                )}
                            </Box>
                        );
                    })}

                    {!rows.length ? (
                        <NLEmptyState
                            icon="grid-outline"
                            title="Nothing booked yet"
                            subtitle="Anything you book shows up here, grouped by kind."
                        />
                    ) : null}
                </>
            )}

            <NLBookingDetailDialog
                open={!!detail}
                booking={detail}
                statusLabel={detail ? VIEW_STATUS_LABEL[detail.view] : ''}
                onClose={() => setDetail(null)}
                onOpenFull={openFull}
                onRebook={() => { setDetail(null); navigate(`${basePath}/newlook/book`); }}
                onViewCredits={() => { setDetail(null); navigate(`${basePath}/spending`); }}
            />
        </Box>
    );
};

export default Categories;
