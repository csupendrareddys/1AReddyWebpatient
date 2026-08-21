/**
 * Book Appointments (new look) — every booking mode on one page, as a form
 * rather than a shelf.
 *
 * Ported from the patient mobile MVP's ``app/quick-actions.tsx``. The Home
 * shelf is for glancing; this is for deciding. Pick who it's for and what kind
 * of care, then continue — so someone who knows exactly what they want doesn't
 * have to swipe a carousel to find it.
 *
 * WIRED TO THE REAL FLOW, not a mock catalogue:
 *  • the care options are this app's ``CONSULTATION_TYPES`` plus its Services
 *    and Health Plans surfaces, with live slot availability per type;
 *  • "who is this for?" reads the real house group, gated by ``patient.family``
 *    exactly as the booking flow's own member popup is;
 *  • Continue hands off to the real ``/book-by-type/:type`` flow.
 *
 * Choosing a family member here does the same two things the match page's
 * popup does — create the appointment's medical context for that member, then
 * record the choice — because setting only the redux flag would file the
 * booking against the patient while the screen claimed otherwise. That's also
 * why the slice actions are dispatched directly rather than through
 * ``useBookingFlow``: the order has to be reset → set type → create context →
 * navigate, and the bundled helper navigates immediately.
 */
import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Alert, Avatar, Box, Button, ButtonBase, CircularProgress, Typography,
} from '@mui/material';
import NLCard from '../../components/NLCard';
import NLIcon from '../../components/NLIcon';
import NLItemViews from '../../components/NLItemViews';
import NLViewSwitcher from '../../components/NLViewSwitcher';
import NLRecoShelf from '../../components/NLRecoShelf';
import NLEmptyState from '../../components/NLEmptyState';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import { FacilityList } from '../FindCare/FindCare';
import useProviderShelves from '../../hooks/useProviderShelves';
// ASSUMED endpoints (#8 recommendations, #10 facilities) — honest 404 banners until they ship.
import { useGetNLRecommendationsQuery, useGetNLFacilitiesQuery } from '../../api/assumedEndpoints';
import { useGetDoctorsListQuery } from '../../../api/scopedBookingApi';
import {
    useGetSlotAvailabilitySummaryQuery,
    useGetHouseGroupQuery,
    useCreateAppointmentContextMutation,
} from '../../../api/scopedBookingApi';
import {
    resetBookingFlow, setBookingFor, setConsultationType, setMedicalContextId,
} from '../../../redux/bookingFlowSlice';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { CONSULTATION_TYPES } from '../../../../service-provider/ProfileSetting/constants/consultationTypes';
import { NL_CATEGORIES } from '../../data/categories';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';

/** The types a patient can actually book — no camp, no marketplace status row. */
const BOOKABLE = ['audio', 'video', 'chat', 'complete', 'home_visit'];

const CONSULT_ICON = {
    video: 'videocam-outline',
    audio: 'call-outline',
    chat: 'chatbubble-outline',
    complete: 'business-outline',
    home_visit: 'home-outline',
};

const SLOT_COLOR = { green: '#4caf50', orange: '#e65100', red: '#f44336' };

/**
 * How many open slots this type has, in words.
 *
 * The backend counts unbooked future slots across the tenant's doctors and
 * buckets them 0 → red, 1-10 → orange, 11+ → green. Printing the count AND the
 * bucket gave "0 slots · No slots", so each bucket says it once.
 */
const slotLabel = ({ slotCount, slotStatus }) => {
    if (!slotCount) return 'No open slots right now';
    if (slotStatus === 'orange') return `Only ${slotCount} slot${slotCount === 1 ? '' : 's'} left`;
    return `${slotCount} slots available`;
};

/**
 * The two product families that aren't consultations. They're bought on their
 * own pages, so they hand off there rather than into the consultation flow.
 */
const OTHER_OPTIONS = [
    {
        key: 'services',
        name: 'Services',
        tagline: 'Health packages, tests and add-on services from your providers',
        icon: 'storefront-outline',
        tint: colors.secondary,
        target: 'marketplace',
    },
    {
        key: 'health_plans',
        name: 'Health Plans',
        tagline: 'Longer programmes run by a care team',
        icon: 'heart-circle-outline',
        tint: '#5e35b1',
        target: 'health-plans',
    },
    {
        key: 'recovery_plans',
        name: 'Recovery Plans',
        tagline: 'Short guided programmes for a specific illness',
        icon: 'thermometer-outline',
        tint: colors.error,
        target: 'newlook/recovery-plans',
    },
    {
        key: 'find_doctor',
        name: 'Find a Doctor',
        tagline: 'Browse doctors and book with a specific one',
        icon: 'search-outline',
        tint: colors.primary,
        target: 'newlook/find-care',
    },
];

const BookAppointments = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const familyEnabled = hasFeature('patient.family');
    const [searchParams, setSearchParams] = useSearchParams();

    // Grid by default: the options fit on one screen as tiles, so the choice can
    // be made without scrolling. All four views stay available.
    const [mode, setMode] = useState('grid');
    const [picked, setPicked] = useState(null);
    const [bookingFor, setBookingForId] = useState('self');
    const [starting, setStarting] = useState(false);
    const [error, setError] = useState(null);

    const { data: availability, isLoading: slotsLoading } = useGetSlotAvailabilitySummaryQuery();
    const { data: houseGroupResp, isLoading: membersLoading } = useGetHouseGroupQuery(undefined, {
        skip: !familyEnabled,
    });
    const [createContext] = useCreateAppointmentContextMutation();

    // ── Sub-heads. Category is the booking form; the rest are ways of being
    // pointed at something bookable. The chosen one rides ?tab= so it's
    // linkable and survives a reload.
    const SUBHEADS = [
        { key: 'category', label: 'Category', icon: 'grid-outline' },
        { key: 'reco_you', label: 'Recommended for you', icon: 'sparkles-outline', shelf: 'interested' },
        { key: 'reco_family', label: 'For your child & family', icon: 'happy-outline', shelf: 'family' },
        { key: 'fits', label: 'Fits for you', icon: 'checkmark-circle', shelf: 'fits' },
        { key: 'fd', label: 'Family Doctor services', icon: 'medical-outline' },
        { key: 'favourite', label: 'Favourite doc / clinic / hospital', icon: 'star' },
        { key: 'find_doctor', label: 'Find by Doctor', icon: 'person-outline' },
        { key: 'find_clinic', label: 'Find by Clinic', icon: 'business-outline' },
        { key: 'find_hospital', label: 'Find by Hospital', icon: 'medkit-outline' },
    ];
    const urlTab = searchParams.get('tab');
    const tab = SUBHEADS.some((t) => t.key === urlTab) ? urlTab : 'category';
    const setTab = (key) => {
        const params = new URLSearchParams(searchParams);
        if (key === 'category') params.delete('tab');
        else params.set('tab', key);
        setSearchParams(params, { replace: true });
    };

    // Data for the non-category sub-heads, fetched only when needed.
    const { data: recoShelves = [], error: recoError } = useGetNLRecommendationsQuery(undefined, {
        skip: !['reco_you', 'reco_family', 'fits'].includes(tab),
    });
    const { fdLink, fdShelf, favourite, favShelf } = useProviderShelves();
    const { data: clinics = [], error: clinicsError } = useGetNLFacilitiesQuery('clinic', {
        skip: tab !== 'find_clinic',
    });
    const { data: hospitals = [], error: hospitalsError } = useGetNLFacilitiesQuery('hospital', {
        skip: tab !== 'find_hospital',
    });
    const { data: doctorsData, isLoading: doctorsLoading } = useGetDoctorsListQuery({}, {
        skip: tab !== 'find_doctor',
    });

    /** Shelf card press: ``book:<doctorId>`` starts a booking, else marketplace. */
    const openShelfCard = (id) => {
        if (String(id).startsWith('book:')) navigate(`${basePath}/newlook/book/consult/${String(id).slice(5)}`);
        else navigate(`${basePath}/marketplace`);
    };

    /** One assumed recommendation shelf, by its mobile key. */
    const assumedShelf = (shelfKey) => {
        const sh = recoShelves.find((x) => x.key === shelfKey);
        return (sh?.items || []).map((it) => ({
            id: String(it.id),
            title: it.name,
            subtitle: it.provider,
            meta: it.meta,
            note: it.reason,
            price: it.price ?? null,
            icon: 'sparkles-outline',
            tint: colors.primary,
        }));
    };

    // The endpoint has been seen returning both the bare array and a wrapped
    // shape; the booking flow's own popup normalises the same way.
    const members = Array.isArray(houseGroupResp)
        ? houseGroupResp
        : (houseGroupResp?.data?.members || houseGroupResp?.members || []);
    const bookableMembers = useMemo(() => members.filter((m) => {
        const perms = m.permissions || {};
        return perms.visible !== false && perms.appointments && perms.appointments !== 'none';
    }), [members]);

    const options = useMemo(() => {
        const consults = CONSULTATION_TYPES
            .filter((ct) => BOOKABLE.includes(ct.value))
            .map((ct) => {
                const slot = availability?.[ct.value] || { count: 0, status: 'red' };
                return {
                    key: ct.value,
                    name: ct.label,
                    tagline: ct.description,
                    icon: CONSULT_ICON[ct.value] || 'videocam-outline',
                    tint: ct.color,
                    kind: 'consultation',
                    slotCount: slot.count,
                    slotStatus: slot.status,
                    disabled: slot.status === 'red',
                };
            });
        return [...consults, ...OTHER_OPTIONS.map((o) => ({ ...o, kind: 'other' }))];
    }, [availability]);

    // The Home shelf links here with the category it was tapped on.
    const urlCategory = searchParams.get('category');
    useEffect(() => {
        if (!urlCategory) return;
        if (options.some((o) => o.key === urlCategory)) setPicked(urlCategory);
    }, [urlCategory, options]);

    const chosen = options.find((o) => o.key === picked) || null;
    const selectedMember = bookingFor === 'self'
        ? null
        : bookableMembers.find((m) => m.member_id === bookingFor) || null;
    const forLabel = selectedMember
        ? `${selectedMember.first_name} ${selectedMember.last_name || ''}`.trim()
        : 'you';

    const start = async () => {
        if (!chosen) return;
        setError(null);

        // Services / plans / doctor search are their own surfaces.
        if (chosen.kind === 'other') {
            navigate(`${basePath}/${chosen.target}`);
            return;
        }

        setStarting(true);
        dispatch(resetBookingFlow());
        dispatch(setConsultationType(chosen.key));
        if (selectedMember) {
            try {
                const ctx = await createContext({
                    consultation_type: chosen.key,
                    booking_for_id: selectedMember.linked_patient_id || null,
                    house_group_member_id: selectedMember.member_id || null,
                }).unwrap();
                dispatch(setMedicalContextId(ctx.id));
                dispatch(setBookingFor({ bookingFor, member: selectedMember }));
            } catch (e) {
                // Don't ship the patient onward believing the booking is for
                // someone else — stop here and say so.
                setStarting(false);
                setError(
                    e?.data?.error || e?.data?.message
                    || `Couldn’t start a booking for ${forLabel}. Please try again.`,
                );
                return;
            }
        }
        setStarting(false);
        navigate(`${basePath}/book-by-type/${chosen.key}`);
    };

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Book Appointments</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Choose who this is for and the kind of care you need. You can change
                either at any point before paying.
            </Typography>

            {/* ── Sub-heads on the left; the chosen panel on the right. On a
                phone the rail becomes a scrollable chip row on top. ── */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: '230px 1fr' },
                    gap: { xs: 2, md: 3 },
                    alignItems: 'start',
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: { xs: 'row', md: 'column' },
                        gap: '6px',
                        overflowX: { xs: 'auto', md: 'visible' },
                        position: { md: 'sticky' },
                        top: { md: 16 },
                        pb: { xs: 1, md: 0 },
                        scrollbarWidth: 'none',
                        '&::-webkit-scrollbar': { display: 'none' },
                    }}
                >
                    {SUBHEADS.map((t) => {
                        const active = tab === t.key;
                        return (
                            <ButtonBase
                                key={t.key}
                                onClick={() => setTab(t.key)}
                                aria-pressed={active}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    px: '12px',
                                    py: '10px',
                                    textAlign: 'left',
                                    justifyContent: 'flex-start',
                                    borderRadius: `${radius.sm}px`,
                                    flexShrink: 0,
                                    border: `1px solid ${active ? colors.primary : colors.border}`,
                                    bgcolor: active ? tint(colors.primary, 0.08) : colors.surface,
                                    color: active ? colors.primary : colors.textSecondary,
                                    fontSize: 12.5,
                                    fontWeight: active ? 700 : 600,
                                }}
                            >
                                <NLIcon
                                    name={t.icon}
                                    size={15}
                                    color={active ? colors.primary : colors.textMuted}
                                />
                                {t.label}
                            </ButtonBase>
                        );
                    })}
                </Box>

                <Box sx={{ minWidth: 0 }}>
                    {tab === 'category' ? (<>
            {/* The eight booking categories — the mobile Home's shelf. Each
                opens its own category page on the right of this rail. */}
            <Typography sx={{ ...typography.label, mb: 1.25 }}>BROWSE BY CATEGORY</Typography>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                    gap: '10px',
                    mb: 3,
                }}
            >
                {NL_CATEGORIES.map((c) => (
                    <ButtonBase
                        key={c.key}
                        onClick={() => navigate(`${basePath}/newlook/category/${c.key}`)}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            textAlign: 'left',
                            gap: '4px',
                            p: '12px',
                            borderRadius: `${radius.md}px`,
                            border: `1px solid ${colors.border}`,
                            bgcolor: colors.surface,
                            '&:hover': { boxShadow: '0 6px 18px rgba(15, 27, 45, 0.10)' },
                        }}
                    >
                        <Box
                            sx={{
                                width: 34,
                                height: 34,
                                borderRadius: '50%',
                                bgcolor: tint(c.tint, 0.1),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                mb: '6px',
                            }}
                        >
                            <NLIcon name={c.icon} size={18} color={c.tint} />
                        </Box>
                        <Typography
                            sx={{ fontSize: 13, fontWeight: 700, color: colors.textPrimary, ...clamp(2) }}
                        >
                            {c.name}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: colors.textMuted, ...clamp(2) }}>
                            {c.short}
                        </Typography>
                    </ButtonBase>
                ))}
            </Box>

            {/* ── Who is this for? ─────────────────────────────────────── */}
            <Typography sx={{ ...typography.label, mb: 1.25 }}>WHO IS THIS FOR?</Typography>
            {familyEnabled && membersLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <CircularProgress size={16} />
                    <Typography sx={typography.bodyMuted}>Loading your family…</Typography>
                </Box>
            ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px', mb: 2.5 }}>
                    <PersonChip
                        label="Myself"
                        sub="Your own records"
                        active={bookingFor === 'self'}
                        onClick={() => setBookingForId('self')}
                    />
                    {bookableMembers.map((m) => (
                        <PersonChip
                            key={m.member_id}
                            label={`${m.first_name} ${m.last_name || ''}`.trim()}
                            sub={m.relation || 'Family'}
                            image={m.profile_image}
                            active={bookingFor === m.member_id}
                            onClick={() => setBookingForId(m.member_id)}
                        />
                    ))}
                </Box>
            )}

            {/* ── What kind of care? ───────────────────────────────────── */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    mb: 1.25,
                    flexWrap: 'wrap',
                }}
            >
                <Typography sx={{ ...typography.label, flex: 1 }}>WHAT KIND OF CARE?</Typography>
                <NLViewSwitcher
                    inline
                    mode={mode}
                    onChange={setMode}
                    hint={picked ? '1 selected' : undefined}
                />
            </Box>

            {slotsLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : mode === 'list' ? (
                // The list view keeps the radio affordance because that's what the
                // picking is for; the other three are for scanning what's on offer.
                options.map((o) => {
                    const active = picked === o.key;
                    return (
                        <ButtonBase
                            key={o.key}
                            onClick={() => setPicked(active ? null : o.key)}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '12px',
                                p: '13px',
                                mb: '9px',
                                width: '100%',
                                textAlign: 'left',
                                borderRadius: `${radius.md}px`,
                                border: active
                                    ? `2px solid ${colors.primary}`
                                    : `1px solid ${colors.border}`,
                                bgcolor: colors.surface,
                                opacity: o.disabled ? 0.6 : 1,
                            }}
                        >
                            <Box
                                sx={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: '50%',
                                    bgcolor: tint(o.tint, 0.1),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <NLIcon name={o.icon} size={19} color={o.tint} />
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography sx={typography.h3}>{o.name}</Typography>
                                <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>
                                    {o.tagline}
                                </Typography>
                                {o.kind === 'consultation' ? (
                                    <Typography sx={{ ...typography.caption, color: SLOT_COLOR[o.slotStatus] }}>
                                        {slotLabel(o)}
                                    </Typography>
                                ) : null}
                            </Box>
                            <Box
                                sx={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: '50%',
                                    border: `2px solid ${active ? colors.primary : colors.border}`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                {active ? (
                                    <Box
                                        sx={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: '50%',
                                            bgcolor: colors.primary,
                                        }}
                                    />
                                ) : null}
                            </Box>
                        </ButtonBase>
                    );
                })
            ) : (
                <NLItemViews
                    mode={mode}
                    intervalSec={16}
                    showPrice={false}
                    tableTypeLabel="Availability"
                    items={options.map((o) => ({
                        id: o.key,
                        title: o.name,
                        subtitle: o.tagline,
                        badge: o.kind === 'consultation'
                            ? `${o.slotCount} slots`
                            : 'Own page',
                        // Live slot availability rides on ``note``, not ``badge``:
                        // grid is this page's default view and it renders the note
                        // but not the badge, so availability would otherwise be
                        // invisible exactly where the choice is being made.
                        note: o.kind === 'consultation' ? slotLabel(o) : undefined,
                        noteIcon: o.slotStatus === 'red' ? 'alert-circle-outline' : 'time-outline',
                        selected: picked === o.key,
                        price: null,
                        icon: o.icon,
                        tint: o.tint,
                    }))}
                    onPress={(key) => setPicked(picked === key ? null : key)}
                />
            )}

            {chosen ? (
                <NLCard sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                        sx={{
                            width: 40,
                            height: 40,
                            borderRadius: '50%',
                            bgcolor: tint(chosen.tint, 0.1),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <NLIcon name={chosen.icon} size={19} color={chosen.tint} />
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography sx={typography.bodyMuted}>You&apos;re booking</Typography>
                        <Typography sx={typography.h3}>{chosen.name}</Typography>
                        <Typography sx={typography.bodyMuted}>for {forLabel}</Typography>
                    </Box>
                </NLCard>
            ) : null}

            {chosen?.disabled ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No doctor has open slots for {chosen.name} right now. You can still
                    continue to see who offers it.
                </Alert>
            ) : null}

            {error ? (
                <Alert severity="error" sx={{ mt: 2 }} onClose={() => setError(null)}>
                    {error}
                </Alert>
            ) : null}

            <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={!chosen || starting}
                onClick={start}
                sx={{ mt: 2.5, height: 48, fontSize: 15, fontWeight: 700 }}
            >
                {starting ? 'Starting…'
                    : chosen ? `Continue with ${chosen.name}`
                        : 'Pick a kind of care'}
            </Button>
                    </>) : null}

                    {/* ── Recommendation sub-heads (assumed #8) ─────────── */}
                    {['reco_you', 'reco_family', 'fits'].includes(tab) ? (
                        <>
                            <NLAssumedNotice error={recoError} endpoint="GET /api/patient/recommendations" />
                            {(() => {
                                const def = SUBHEADS.find((t) => t.key === tab);
                                const items = assumedShelf(def.shelf);
                                return items.length ? (
                                    <NLRecoShelf
                                        title={def.label}
                                        subtitle="Tap anything to continue into the real booking flow"
                                        icon={def.icon}
                                        items={items}
                                        intervalSec={20}
                                        onPress={openShelfCard}
                                    />
                                ) : !recoError ? (
                                    <NLEmptyState
                                        icon={def.icon}
                                        title="Nothing here yet"
                                        subtitle="Picks appear as you browse and book."
                                    />
                                ) : null;
                            })()}
                        </>
                    ) : null}

                    {/* ── Family doctor's services (real) ───────────────── */}
                    {tab === 'fd' ? (
                        fdShelf.length ? (
                            <NLRecoShelf
                                title="Family Doctor services"
                                subtitle={fdLink?.doctor_name
                                    ? `Everything Dr. ${fdLink.doctor_name} offers`
                                    : 'Everything your family doctor offers'}
                                icon="medical-outline"
                                items={fdShelf}
                                intervalSec={20}
                                showPrice={false}
                                onPress={openShelfCard}
                                onSeeAll={() => navigate(`${basePath}/newlook/second-opinion`)}
                                seeAllLabel="Second opinion"
                            />
                        ) : (
                            <NLEmptyState
                                icon="medical-outline"
                                title="No family doctor linked"
                                subtitle="Link one from the Second Opinion page to see their services here."
                            />
                        )
                    ) : null}

                    {/* ── Favourite provider (real, from history) ───────── */}
                    {tab === 'favourite' ? (
                        favShelf.length ? (
                            <NLRecoShelf
                                title="Your favourite doctor, clinic & hospital"
                                subtitle={`From the provider you book most${favourite?.name ? ` — Dr. ${favourite.name}` : ''}`}
                                icon="star"
                                tint={colors.warning}
                                items={favShelf}
                                intervalSec={22}
                                showPrice={false}
                                onPress={openShelfCard}
                                onSeeAll={() => navigate(`${basePath}/newlook/find-care`)}
                                seeAllLabel="Find care"
                            />
                        ) : (
                            <NLEmptyState
                                icon="star"
                                title="No favourite yet"
                                subtitle="Book with someone a couple of times and they show up here."
                            />
                        )
                    ) : null}

                    {/* ── Find by Doctor (real) ─────────────────────────── */}
                    {tab === 'find_doctor' ? (
                        doctorsLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                                <CircularProgress />
                            </Box>
                        ) : (doctorsData?.doctors || []).length ? (
                            <Box sx={{ display: 'grid', gap: '12px' }}>
                                {(doctorsData?.doctors || []).map((d) => (
                                    <NLCard key={d.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                                        <Avatar src={d.profile_image || undefined} sx={{ width: 48, height: 48 }}>
                                            {(d.full_name || '?')[0]}
                                        </Avatar>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={typography.h3}>Dr. {d.full_name}</Typography>
                                            <Typography sx={{ ...typography.bodyMuted, ...clamp(1) }}>
                                                {(d.specializations || [])
                                                    .map((sp) => (typeof sp === 'string' ? sp : sp?.name || ''))
                                                    .filter(Boolean).join(', ') || 'Doctor'}
                                            </Typography>
                                        </Box>
                                        <Button size="small" variant="outlined" onClick={() => navigate(`${basePath}/doctor/${d.id}`)}>
                                            Profile
                                        </Button>
                                        <Button size="small" variant="contained" onClick={() => navigate(`${basePath}/newlook/book/consult/${d.id}`)}>
                                            Book
                                        </Button>
                                    </NLCard>
                                ))}
                            </Box>
                        ) : (
                            <NLEmptyState icon="person-outline" title="No doctors found" />
                        )
                    ) : null}

                    {/* ── Find by Clinic / Hospital (assumed #10) ───────── */}
                    {tab === 'find_clinic' ? (
                        <FacilityList
                            kind="clinic"
                            rows={clinics}
                            error={clinicsError}
                            onOpenServices={(f) => navigate(
                                `${basePath}/marketplace?doctor=${encodeURIComponent(f.name || '')}`,
                            )}
                        />
                    ) : null}
                    {tab === 'find_hospital' ? (
                        <FacilityList
                            kind="hospital"
                            rows={hospitals}
                            error={hospitalsError}
                            onOpenServices={(f) => navigate(
                                `${basePath}/marketplace?doctor=${encodeURIComponent(f.name || '')}`,
                            )}
                        />
                    ) : null}
                </Box>
            </Box>
        </Box>
    );
};

const PersonChip = ({ label, sub, image, active, onClick }) => (
    <ButtonBase
        onClick={onClick}
        aria-pressed={active}
        sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            px: '12px',
            py: '10px',
            textAlign: 'left',
            borderRadius: `${radius.md}px`,
            border: active ? `2px solid ${colors.primary}` : `1px solid ${colors.border}`,
            bgcolor: colors.surface,
            minWidth: 190,
        }}
    >
        <Avatar src={image || undefined} sx={{ width: 32, height: 32 }}>
            {(label || '?')[0]}
        </Avatar>
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
                sx={{ fontSize: 13.5, fontWeight: 700, color: colors.textPrimary, ...clamp(1) }}
            >
                {label}
            </Typography>
            <Typography sx={{ fontSize: 11, color: colors.textMuted, ...clamp(1) }}>
                {sub}
            </Typography>
        </Box>
        {active ? <NLIcon name="checkmark-circle" size={18} color={colors.primary} /> : null}
    </ButtonBase>
);

export default BookAppointments;
