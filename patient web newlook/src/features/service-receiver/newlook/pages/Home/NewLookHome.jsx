/**
 * Home (new look) — the patient dashboard, ported from the mobile MVP's
 * ``app/(tabs)/index.tsx`` and wired to this app's real endpoints.
 *
 * Section order is the mobile screen's, because that order is the design: a
 * greeting and three live numbers, then the two ways to start something (browse
 * the booking shelf, or open the full form), then what's already running, then
 * who else's care this account covers.
 *
 * Divergences from the mobile screen, and why:
 *  • the hamburger — the dashboard sidebar is already the menu;
 *  • the bell and "Ask Agent" ride ASSUMED endpoints (#3, #9 in
 *    api/assumedEndpoints.js) — the pages they open say so until those ship;
 *  • the recommendation shelves — no recommendation service yet, so the shelf
 *    pattern is fed by the real marketplace catalogue, and Discover carries the
 *    assumed-endpoint version;
 *  • "Second Opinion" in Track your care became Pending — the real first stage
 *    of a booking; second opinions have their own page in the sidebar.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Alert, Avatar, Badge, Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material';
import NLCard from '../../components/NLCard';
import NLIcon from '../../components/NLIcon';
import NLStatTile from '../../components/NLStatTile';
import NLSectionHeader from '../../components/NLSectionHeader';
import NLTwoRowSlider from '../../components/NLTwoRowSlider';
import NLBookingStrip from '../../components/NLBookingStrip';
import useNewLookBookings, { VIEW_TINT, VIEW_TITLE } from '../../hooks/useNewLookBookings';
import {
    useGetCreditsQuery,
    useBrowseMarketplaceQuery,
} from '../../../api/scopedBookingApi';
import { useGetMinorsQuery, useGetFamilyScopesQuery } from '../../../Family/api/familyEndpoints';
// ASSUMED endpoints (#1 wallet, #3 bell badge, #8 recommendations) — harmless 404s until they ship.
import {
    useGetNLNotificationsQuery, useGetNLRecommendationsQuery, useGetNLWalletQuery,
} from '../../api/assumedEndpoints';
import {
    useGetMyFamilyDoctorQuery, useGetMySecondOpinionBookingsQuery,
} from '../../../../family-doctor/api/familyDoctorEndpoints';
import NLRecoShelf from '../../components/NLRecoShelf';
import useProviderShelves from '../../hooks/useProviderShelves';
import { NL_CATEGORIES } from '../../data/categories';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { inr } from '../../utils/format';

/** Non-booking shortcuts, shown beneath the booking categories. */
const SHORTCUTS = [
    { icon: 'search-outline', label: 'Find Care', sub: 'Doctors, services & plans', target: 'newlook/find-care' },
    { icon: 'medical-outline', label: 'Second Opinion', sub: 'By your family doctor', target: 'newlook/second-opinion' },
    { icon: 'headset-outline', label: 'Care Team', sub: 'Support staff', target: 'support-staff' },
    { icon: 'people-outline', label: 'Family', sub: 'Minors & dependents', target: 'family', feature: 'patient.family' },
    { icon: 'chatbubbles-outline', label: 'Messages', sub: 'Service chats', target: 'my-services' },
    { icon: 'document-text-outline', label: 'Prescriptions', sub: 'Medicines & documents', target: 'my-records' },
    { icon: 'card-outline', label: 'Wallet', sub: 'Balance & top-up', target: 'newlook/wallet' },
    { icon: 'analytics-outline', label: 'Spending', sub: 'Payments & credits', target: 'spending' },
    { icon: 'thermometer-outline', label: 'Recovery Plans', sub: 'Illness-to-recovery programmes', target: 'newlook/recovery-plans' },
    { icon: 'notifications-outline', label: 'Notifications', sub: 'Alerts & reminders', target: 'newlook/notifications' },
    { icon: 'storefront-outline', label: 'Services', sub: 'Buy add-on services', target: 'marketplace', feature: 'clinic.marketplace' },
    { icon: 'heart-circle-outline', label: 'Health Plans', sub: 'Team programmes', target: 'health-plans' },
    { icon: 'ribbon-outline', label: 'Membership', sub: 'Your plan & benefits', target: 'my-membership' },
    { icon: 'pulse-outline', label: 'Health Records', sub: 'Vitals & history', target: 'health-records' },
];

const KIND_BREAKDOWN = [
    { kind: 'consultation', label: 'Consults', icon: 'videocam-outline' },
    { kind: 'service', label: 'Services', icon: 'storefront-outline' },
    { kind: 'plan', label: 'Plans', icon: 'heart-circle-outline' },
    { kind: 'recovery', label: 'Recovery', icon: 'thermometer-outline' },
    { kind: 'follow_up', label: 'Follow-ups', icon: 'add-circle-outline' },
];

const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning,';
    if (h < 17) return 'Good afternoon,';
    return 'Good evening,';
};

const NewLookHome = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const { user } = useSelector((state) => state.auth);

    const { rows, byView, counts, pendingSplit, isLoading, isError, failed } = useNewLookBookings();
    const { data: credits } = useGetCreditsQuery();
    const { data: products = [] } = useBrowseMarketplaceQuery(undefined, {
        skip: !hasFeature('clinic.marketplace'),
    });
    const familyEnabled = hasFeature('patient.family');
    const { data: minors = [] } = useGetMinorsQuery(undefined, { skip: !familyEnabled });
    const { data: scopes = { linked: [], granted: [] } } = useGetFamilyScopesQuery(undefined, {
        skip: !familyEnabled,
    });
    const { data: notifs = [] } = useGetNLNotificationsQuery();
    const unread = notifs.filter((n) => !n.read).length;
    const { data: fdLink } = useGetMyFamilyDoctorQuery();
    const { data: recoShelves = [] } = useGetNLRecommendationsQuery();
    const { data: nlWallet } = useGetNLWalletQuery();
    const { data: soTable } = useGetMySecondOpinionBookingsQuery();
    const secondOpinions = (soTable?.bookings || []).filter((b) => b.prescription).length;

    const firstName = (user?.full_name || user?.first_name || user?.name || 'there')
        .split(' ')[0];
    const linked = scopes.granted || [];
    const canOpen = scopes.linked || [];
    const familyCount = minors.length + linked.length + canOpen.length;
    const creditBalance = credits?.available || 0;

    const go = (target) => navigate(`${basePath}/${target}`);
    const goBookings = (view) => navigate(`${basePath}/newlook/bookings?view=${view}`);

    // The mobile Home's shelf is its eight product categories — each opens its
    // category page (config in data/categories.js; items from assumed #11).
    const bookingOptions = useMemo(() => NL_CATEGORIES.map((c) => ({
        id: c.key,
        title: c.name,
        subtitle: c.short,
        icon: c.icon,
        tint: c.tint,
    })), []);

    const shortcuts = useMemo(
        () => SHORTCUTS.filter((s) => !s.feature || hasFeature(s.feature)),
        [hasFeature],
    );

    /** Real catalogue in place of the mobile's invented recommendations. */
    /** One catalogue product as a shelf card. */
    const productCard = (p, badge) => ({
        id: String(p.id),
        title: p.product_name || 'Service',
        subtitle: p.doctor_name ? `Dr. ${p.doctor_name}` : 'Provider',
        meta: p.doctor_price != null ? inr(p.doctor_price) : undefined,
        badge: badge ?? (p.offering_type === 'group' ? 'Group service' : 'Service'),
        icon: 'storefront-outline',
        tint: colors.secondary,
    });

    // The family-doctor and favourite-provider shelves are shared with the
    // Book Appointments sub-heads — one derivation, two surfaces.
    const { fdShelf, favourite, favShelf } = useProviderShelves();


    // ── Recommendations — ASSUMED endpoint #8; the live catalogue stands in,
    // labelled as the catalogue, until the service ships.
    const recoItems = useMemo(() => {
        const fromApi = recoShelves.flatMap((sh) => sh.items || []).slice(0, 12);
        if (fromApi.length) {
            return fromApi.map((it) => ({
                id: String(it.id),
                title: it.name,
                subtitle: it.provider,
                meta: it.price != null ? `${it.price === 0 ? 'Free' : inr(it.price)}${it.meta ? ` · ${it.meta}` : ''}` : it.meta,
                badge: it.reason,
                icon: 'sparkles-outline',
                tint: colors.primary,
            }));
        }
        return products.slice(0, 12).map((p) => productCard(p));
    }, [recoShelves, products]);
    const recoPersonalised = recoShelves.some((sh) => (sh.items || []).length);

    /** Shelf card press: ``book:<doctorId>`` starts a booking, else marketplace. */
    const openShelfCard = (id) => {
        if (String(id).startsWith('book:')) go(`newlook/book/consult/${String(id).slice(5)}`);
        else go('marketplace');
    };

    const breakdownFor = (view) => KIND_BREAKDOWN
        .map((k) => ({
            label: k.label,
            icon: k.icon,
            count: (byView[view] || []).filter((r) => r.kind === k.kind).length,
        }))
        .filter((b) => b.count > 0);

    // The four stages a booking passes through, in order, plus the mobile
    // Home's fifth tile — Second Opinion — with its real count. Cancelled isn't
    // a stage: a rejected or expired booking sits in Completed wearing a tag.
    const trackTiles = [
        { view: 'pending', sub: 'Awaiting approval or payment', icon: 'time-outline' },
        { view: 'upcoming', sub: 'Accepted and scheduled', icon: 'calendar-outline' },
        { view: 'in_progress', sub: 'Care underway', icon: 'hourglass-outline' },
        { view: 'free_follow_up', sub: 'Offered by your doctor', icon: 'add-circle-outline' },
        { view: 'completed', sub: 'Finished, cancelled or expired', icon: 'checkmark-done-outline' },
        {
            key: 'second_opinion',
            label: 'Second Opinion',
            sub: 'From your family doctor',
            icon: 'medical-outline',
            tint: colors.secondary,
            count: secondOpinions,
            target: 'newlook/second-opinion',
        },
    ];

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            {/* ── Greeting ─────────────────────────────────────────────── */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={typography.bodyMuted}>{greeting()}</Typography>
                    <Typography sx={typography.h1}>{firstName}</Typography>
                </Box>
                {familyEnabled ? (
                    <Tooltip title="Family">
                        <IconButton onClick={() => go('family')} aria-label="Family">
                            <Badge
                                badgeContent={familyCount}
                                color="secondary"
                                invisible={familyCount === 0}
                            >
                                <NLIcon name="people-outline" size={22} color={colors.textPrimary} />
                            </Badge>
                        </IconButton>
                    </Tooltip>
                ) : null}
                {/* Bell with unread count — persistent entry point, as on mobile. */}
                <Tooltip title="Notifications">
                    <IconButton
                        onClick={() => go('newlook/notifications')}
                        aria-label="Notifications"
                    >
                        <Badge badgeContent={unread} color="error" invisible={unread === 0}>
                            <NLIcon name="notifications-outline" size={22} color={colors.textPrimary} />
                        </Badge>
                    </IconButton>
                </Tooltip>
                <Tooltip title="Profile settings">
                    <ButtonBase
                        onClick={() => go('profile')}
                        sx={{ borderRadius: '50%' }}
                        aria-label="Profile settings"
                    >
                        <Avatar
                            src={user?.profile_image || undefined}
                            sx={{ width: 44, height: 44 }}
                        >
                            {firstName[0]}
                        </Avatar>
                    </ButtonBase>
                </Tooltip>
            </Box>

            {failed.length && !isError ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Couldn’t load your {failed.join(' and ')} just now — the counts below
                    exclude them.
                </Alert>
            ) : null}

            {/* Each tile opens a cross-category list of exactly those bookings —
                consultations, services and health plans together. Pending leads:
                it's the only stage with something outstanding, and an unpaid
                booking loses its slot if it's left there. */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
                    gap: '10px',
                    mb: 3,
                }}
            >
                <NLStatTile
                    icon="time-outline"
                    label={pendingSplit.payment
                        ? `Pending · ${pendingSplit.payment} to pay`
                        : 'Pending'}
                    value={isLoading ? '—' : String(counts.pending)}
                    tint={VIEW_TINT.pending}
                    onClick={() => goBookings('pending')}
                />
                <NLStatTile
                    icon="calendar-outline"
                    label="Upcoming"
                    value={isLoading ? '—' : String(counts.upcoming)}
                    onClick={() => goBookings('upcoming')}
                />
                <NLStatTile
                    icon="hourglass-outline"
                    label="In progress"
                    value={isLoading ? '—' : String(counts.in_progress)}
                    tint={colors.warning}
                    onClick={() => goBookings('in_progress')}
                />
                <NLStatTile
                    icon="wallet-outline"
                    label={nlWallet ? 'Wallet' : 'Health credits'}
                    value={inr(nlWallet ? nlWallet.balance : creditBalance)}
                    tint={colors.secondary}
                    onClick={() => go(nlWallet ? 'newlook/wallet' : 'spending')}
                />
            </Box>

            {/* Agent sits beside the heading — an alternative to the manual tiles
                below for anyone who'd rather be guided than browse. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}>
                <Typography sx={{ ...typography.h2, flex: 1 }}>Quick actions</Typography>
                <ButtonBase
                    onClick={() => go('newlook/agent')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        bgcolor: colors.primary,
                        color: colors.white,
                        px: '13px',
                        py: '8px',
                        borderRadius: `${radius.pill}px`,
                        fontSize: 12.5,
                        fontWeight: 700,
                    }}
                >
                    <NLIcon name="sparkles" size={14} color={colors.white} />
                    Ask Agent
                </ButtonBase>
            </Box>

            {/* Book Appointments — a shelf that slides, so every way to start a
                booking fits in a few lines instead of a wall of tiles. "See all"
                opens the same options as a form for anyone who'd rather decide
                than swipe. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.25 }}>
                <Typography sx={{ ...typography.label, flex: 1 }}>BOOK APPOINTMENTS</Typography>
                <ButtonBase
                    onClick={() => go('newlook/book')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        color: colors.primary,
                        fontSize: 13,
                        fontWeight: 700,
                    }}
                >
                    See all
                    <NLIcon name="chevron-forward" size={13} color={colors.primary} />
                </ButtonBase>
            </Box>
            <NLTwoRowSlider
                variant="tile"
                rows={3}
                intervalSec={15}
                items={bookingOptions}
                onPress={(key) => go(`newlook/category/${key}`)}
            />

            {/* Track your care — jump straight to a booking state. */}
            <Typography sx={{ ...typography.label, mt: 3, mb: 1 }}>TRACK YOUR CARE</Typography>
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' },
                    gap: '10px',
                    mb: 2.25,
                }}
            >
                {trackTiles.map((t) => {
                    const count = t.view ? (isLoading ? 0 : counts[t.view]) : t.count;
                    const tone = t.tint || VIEW_TINT[t.view];
                    return (
                        <ButtonBase
                            key={t.view || t.key}
                            onClick={() => (t.view ? goBookings(t.view) : go(t.target))}
                            sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'stretch',
                                textAlign: 'left',
                                p: '12px',
                                borderRadius: `${radius.md}px`,
                                border: `1px solid ${colors.border}`,
                                bgcolor: colors.surface,
                                '&:hover': { boxShadow: '0 6px 18px rgba(15, 27, 45, 0.10)' },
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    mb: '9px',
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: '50%',
                                        bgcolor: tint(tone, 0.1),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <NLIcon name={t.icon} size={19} color={tone} />
                                </Box>
                                {count > 0 ? (
                                    <Box
                                        sx={{
                                            minWidth: 19,
                                            height: 19,
                                            px: '5px',
                                            borderRadius: '10px',
                                            bgcolor: tone,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Typography
                                            sx={{ fontSize: 10.5, fontWeight: 800, color: colors.white }}
                                        >
                                            {count}
                                        </Typography>
                                    </Box>
                                ) : null}
                            </Box>
                            <Typography
                                sx={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: colors.textPrimary,
                                    ...clamp(2),
                                }}
                            >
                                {t.view ? VIEW_TITLE[t.view] : t.label}
                            </Typography>
                            <Typography
                                sx={{ fontSize: 10.5, color: colors.textMuted, mt: '2px', ...clamp(2) }}
                            >
                                {t.sub}
                            </Typography>
                        </ButtonBase>
                    );
                })}
            </Box>

            {/* Shortcuts use the same shelf as Book Appointments, so the two read
                as one pattern rather than two layouts. */}
            <Typography sx={{ ...typography.label, mb: 1 }}>SHORTCUTS</Typography>
            <NLTwoRowSlider
                variant="tile"
                intervalSec={18}
                items={shortcuts.map((s) => ({
                    id: s.target,
                    title: s.label,
                    subtitle: s.sub,
                    icon: s.icon,
                    tint: colors.primary,
                }))}
                onPress={(target) => go(target)}
            />

            {/* The strips read the same source as the status views, so a count here
                always matches what "See all" opens. Pending goes first — it's the
                only one of the three where something is outstanding. */}
            <NLBookingStrip
                title="Waiting to be accepted"
                subtitle="Bookings the doctor or care team hasn't confirmed yet, and anything still unpaid"
                items={byView.pending || []}
                emptyText={isLoading ? 'Loading…' : 'Nothing waiting — every booking has been accepted.'}
                breakdown={breakdownFor('pending')}
                intervalSec={20}
                onSeeAll={() => goBookings('pending')}
                onItemPress={() => goBookings('pending')}
            />

            <NLBookingStrip
                title="Upcoming appointments"
                subtitle="Scheduled and waiting to start"
                items={byView.upcoming || []}
                emptyText={isLoading ? 'Loading…' : 'No upcoming bookings yet.'}
                breakdown={breakdownFor('upcoming')}
                intervalSec={22}
                onSeeAll={() => goBookings('upcoming')}
                onItemPress={() => goBookings('upcoming')}
            />

            <NLBookingStrip
                title="In progress"
                subtitle="Care that has already begun"
                items={byView.in_progress || []}
                emptyText={isLoading ? 'Loading…' : 'Nothing in progress right now.'}
                breakdown={breakdownFor('in_progress')}
                intervalSec={28}
                onSeeAll={() => goBookings('in_progress')}
                onItemPress={() => goBookings('in_progress')}
            />

            {/* ── The three recommendation shelves, as on mobile ──────────
                Each hides entirely when it has nothing to show — an empty
                shelf is just a heading with a hole under it. */}

            {/* Your family doctor's services — everything they offer, led by a
                consultation tile. Real: their marketplace catalogue. */}
            {fdShelf.length ? (
                <Box sx={{ mt: 3 }}>
                    <NLSectionHeader
                        title="Your Family Doctor's services"
                        subtitle={fdLink?.doctor_name
                            ? `Everything Dr. ${fdLink.doctor_name} offers`
                            : 'Everything your family doctor offers'}
                        actionLabel="Second opinion"
                        onAction={() => go('newlook/second-opinion')}
                    />
                    <NLTwoRowSlider
                        items={fdShelf}
                        intervalSec={20}
                        onPress={openShelfCard}
                    />
                </Box>
            ) : fdLink === null ? (
                <ButtonBase
                    onClick={() => go('newlook/second-opinion')}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        width: '100%',
                        textAlign: 'left',
                        mt: 3,
                        p: '13px',
                        borderRadius: `${radius.md}px`,
                        border: `1px dashed ${colors.border}`,
                        bgcolor: colors.surface,
                    }}
                >
                    <NLIcon name="medical-outline" size={18} color={colors.primary} />
                    <Typography sx={{ ...typography.bodyMuted, flex: 1 }}>
                        Link a family doctor to see their services here — and to ask for
                        second opinions.
                    </Typography>
                    <NLIcon name="chevron-forward" size={15} color={colors.textMuted} />
                </ButtonBase>
            ) : null}

            {/* Recommendations for you — assumed endpoint; the catalogue stands
                in until it ships, and says so in the subtitle. Each shelf the
                service returns renders with its own heading and view switcher,
                exactly as the mobile Home stacks its shelves. */}
            {recoPersonalised ? recoShelves.map((sh, i) => (
                <NLRecoShelf
                    key={sh.key || sh.title}
                    title={i === 0 ? 'Recommendations for you' : sh.title}
                    subtitle={i === 0 ? sh.subtitle || 'Picked from what you browse and book' : sh.subtitle}
                    icon="sparkles-outline"
                    intervalSec={18 + i * 4}
                    showPrice={false}
                    items={(sh.items || []).map((it) => ({
                        id: String(it.id),
                        title: it.name,
                        subtitle: it.provider,
                        meta: it.price != null ? `${it.price === 0 ? 'Free' : inr(it.price)}${it.meta ? ` · ${it.meta}` : ''}` : it.meta,
                        note: it.reason,
                        price: null,
                        icon: 'sparkles-outline',
                        tint: colors.primary,
                    }))}
                    onPress={openShelfCard}
                    onSeeAll={() => go('newlook/discover')}
                />
            )) : recoItems.length ? (
                <Box sx={{ mt: 3 }}>
                    <NLSectionHeader
                        title="Recommendations for you"
                        subtitle="From the live catalogue — personalised picks arrive with the recommendations service"
                        actionLabel="See all"
                        onAction={() => go('newlook/discover')}
                    />
                    <NLTwoRowSlider
                        items={recoItems}
                        intervalSec={24}
                        onPress={openShelfCard}
                    />
                </Box>
            ) : null}

            {/* Your favourite provider — derived from real booking history. */}
            {favShelf.length ? (
                <Box sx={{ mt: 3 }}>
                    <NLSectionHeader
                        title="Your favourite doctor, clinic & hospital services"
                        subtitle={`From the provider you book most${favourite?.name ? ` — Dr. ${favourite.name}` : ''}`}
                        actionLabel="Find care"
                        onAction={() => go('newlook/find-care')}
                    />
                    <NLTwoRowSlider
                        items={favShelf}
                        intervalSec={26}
                        onPress={openShelfCard}
                    />
                </Box>
            ) : null}

            {/* Every recommendation in one place — the mobile Discover page. */}
            <ButtonBase
                onClick={() => go('newlook/discover')}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '7px',
                    width: '100%',
                    mt: 3,
                    py: '13px',
                    borderRadius: `${radius.sm}px`,
                    border: `1.5px dashed ${colors.primary}`,
                    color: colors.primary,
                    fontSize: 12.5,
                    fontWeight: 700,
                }}
            >
                <NLIcon name="grid-outline" size={15} color={colors.primary} />
                See every recommendation in one place
                <NLIcon name="chevron-forward" size={14} color={colors.primary} />
            </ButtonBase>

            {/* Who else's care this account covers. */}
            {familyEnabled && (minors.length || linked.length || canOpen.length) ? (
                <Box sx={{ mt: 3 }}>
                    <NLSectionHeader
                        title="Family"
                        subtitle="Profiles you manage and accounts shared with you"
                        actionLabel="Manage"
                        onAction={() => go('family')}
                    />
                    {minors.map((m) => (
                        <FamilyRow
                            key={`minor-${m.id}`}
                            name={m.full_name}
                            sub={`${m.relation || 'Minor'} · minor · full access`}
                            onClick={() => go('family')}
                        />
                    ))}
                    {/* Family scopes are keyed by ``member_id`` (not ``id``) and only
                        the grantee side carries a role name — the owner side stores
                        ``role_id`` and resolves the name from the roles list, so
                        don't assert a role here that the payload may not have. */}
                    {linked.map((l) => (
                        <FamilyRow
                            key={`granted-${l.member_id}`}
                            name={l.name}
                            sub={`${l.relation || 'Family member'} · ${l.role_name || l.role || (l.role_id ? 'role assigned' : 'no role yet')}`}
                            onClick={() => go('family')}
                        />
                    ))}
                    {canOpen.map((s) => (
                        <FamilyRow
                            key={`open-${s.member_id}`}
                            name={s.name}
                            sub={`${s.relation || 'Family member'} · account you can open${s.role ? ` · ${s.role}` : ''}`}
                            onClick={() => go('family')}
                        />
                    ))}
                </Box>
            ) : null}

            <Box sx={{ mt: 3 }}>
                <NLSectionHeader
                    title="Your care team"
                    actionLabel="Manage"
                    onAction={() => go('support-staff')}
                />
                <NLCard>
                    <Typography sx={typography.body}>
                        Give a caregiver their own login with exactly the access you choose —
                        appointments, records, billing, or any part of it.
                    </Typography>
                </NLCard>
            </Box>
        </Box>
    );
};

const FamilyRow = ({ name, sub, onClick }) => (
    <ButtonBase
        onClick={onClick}
        sx={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            borderRadius: `${radius.md}px`,
            mb: '10px',
        }}
    >
        <NLCard sx={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <Avatar sx={{ width: 40, height: 40 }}>{(name || '?')[0]}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ ...typography.h3, ...clamp(1) }}>{name}</Typography>
                <Typography sx={{ ...typography.bodyMuted, ...clamp(1) }}>{sub}</Typography>
            </Box>
            <NLIcon name="chevron-forward" size={16} color={colors.textMuted} />
        </NLCard>
    </ButtonBase>
);

export default NewLookHome;
