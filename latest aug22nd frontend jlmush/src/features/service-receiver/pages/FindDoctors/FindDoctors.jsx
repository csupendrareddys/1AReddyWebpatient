/**
 * FindDoctors — the patient's browse-and-book roster.
 *
 * Two modes, chosen by the consultation-type rail at the top:
 *
 *   ALL   — every type a doctor offers, one compact priced row each. The
 *           overview: "who is here, and what do they do".
 *   FOCUS — one type picked, so each card speaks only about that type and can
 *           afford to be specific: the duration slots, what each costs, and
 *           exactly what the viewer's membership takes off THIS doctor's THIS
 *           consultation.
 *
 * That last number is the reason the focus mode exists. ``member_discount_pct``
 * is a per-offering figure — a tier's headline % is only a ceiling, and
 * ``DisplayPricingRule.plan_discounts`` dials individual offerings below it —
 * so "your plan gives 30%" is a claim that can be false for the specific slot
 * a patient is about to book. Hence no card-level discount chip and no
 * post-membership figure anywhere: every price on this page is the
 * pre-membership one, and the reduction is stated per offering (and per slot
 * length) as the resolved percentage that settles at billing.
 */
import React, { useState, useMemo } from 'react';
import {
    Box, Container, Typography, TextField, InputAdornment,
    Card, CardContent, CardActions, Button, Avatar, Chip,
    CircularProgress, Alert, Stack, Divider, Pagination, Badge, Tooltip,
    Paper,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PersonIcon from '@mui/icons-material/Person';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import WorkIcon from '@mui/icons-material/Work';
import FilterListIcon from '@mui/icons-material/FilterList';
import TranslateIcon from '@mui/icons-material/Translate';
import AppsIcon from '@mui/icons-material/Apps';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import LoyaltyIcon from '@mui/icons-material/Loyalty';
import { useNavigate } from 'react-router-dom';
import { useGetDoctorsListQuery, useGetSlotAvailabilitySummaryQuery } from '../../api/scopedBookingApi';
import { CONSULTATION_TYPES, CONSULTATION_TYPE_MAP } from '../../../service-provider/ProfileSetting/constants/consultationTypes';
import {
    SLOT_RANGES, slotRangeLabel, tierRangeKey,
} from '../../../service-provider/ProfileSetting/constants/slotRanges';
import FiltersDialog, { countActiveFilters, filtersToQueryParams } from '../BookByType/dialogs/FiltersDialog';
import useMemberDiscount from '../../../../common/hooks/useMemberDiscount';
import { offeringMemberDiscount } from '../../../../common/components/PlanCard/MemberDiscountBadge';
import DiscountedPrice, { formatMoney } from '../../../../common/components/Price/DiscountedPrice';
import { usePatientScope } from '../../ProfileSetting/context/PatientScopeContext';

const SPECIALIZATION_FILTERS = [
    'General Medicine', 'Cardiology', 'Dermatology', 'Neurology',
    'Orthopedics', 'Pediatrics', 'Psychiatry', 'Gynecology', 'ENT',
];

// Same set the Book-a-Consultation landing offers — bookable, slot-backed
// types only (no camp, no marketplace).
const BOOKABLE_TYPES = CONSULTATION_TYPES.filter(
    (ct) => ['audio', 'video', 'chat', 'complete', 'home_visit'].includes(ct.value)
);

/** The "no type picked" sentinel. Empty string so it drops out of the query. */
const ALL = '';

/** What the page opens on. Video is the type most patients are here for, and
 *  landing in focus mode puts a doctor's real price for it on screen without a
 *  click; All is one chip away for anyone who wants the whole roster. */
const DEFAULT_TYPE = 'video';

const formatPrice = (min, max) => (
    min === max ? formatMoney(min) : `${formatMoney(min)} – ${formatMoney(max)}`
);

// What this type was priced at before the admin's markdown, ready to slash.
// ``original_price_min`` / ``_max`` are only sent when the overlay actually
// discounts something, so an undiscounted type returns null and the row
// renders exactly as it always has.
const formatOriginalPrice = (ct) => (
    ct?.original_price_min != null
        ? formatPrice(ct.original_price_min, ct.original_price_max)
        : null
);

const numbersIn = (tiers, key) => tiers
    .map((t) => Number(t?.[key]))
    .filter((n) => Number.isFinite(n));

/**
 * One consultation type, restricted to the slot lengths the patient asked for.
 *
 * Server-side the length filter decides which DOCTORS are listed — a doctor is
 * in if any of their tiers sits on a wanted rung. That is the right rule for
 * the roster but the wrong thing to then render: a doctor kept for their 20-min
 * slot would still show their 10-min and 40-min rows, so the page would answer
 * a filter with prices it excludes.
 *
 * Every card-level figure is recomputed from the surviving tiers rather than
 * carried over, because each one summarises the set: the price range, the
 * struck original, and the membership band all describe tiers that may no
 * longer be on screen. ``member_discount_pct_min`` in particular is what makes
 * the chip say "30% off" instead of "up to 30% off", and a filter that leaves
 * one uniform tier standing should collapse the hedge.
 *
 * ``null`` when nothing survives — this type has nothing at these lengths and
 * belongs off the card entirely.
 */
const narrowToLengths = (ct, lengths) => {
    if (!ct) return null;
    if (!lengths?.length) return ct;
    const wanted = new Set(lengths);
    const tiers = (ct.price_range || []).filter(
        (t) => wanted.has(tierRangeKey(t)),
    );
    const prices = numbersIn(tiers, 'price');
    if (!prices.length) return null;

    // A tier with no markdown carries no ``original_price``; its own price IS
    // its list price and still has to weigh in, or an undiscounted slot would
    // vanish from the struck range. Mirrors ``markdown_range`` server-side.
    const originals = tiers.map((t) => {
        const original = Number(t?.original_price);
        return Number.isFinite(original) ? original : Number(t?.price);
    }).filter((n) => Number.isFinite(n));
    const listTotal = originals.reduce((sum, n) => sum + n, 0);
    const paidTotal = prices.reduce((sum, n) => sum + n, 0);

    // Absent means this tier grants nothing, which still counts against the
    // set — one slot at 0 is exactly what makes the benefit non-uniform.
    const memberPcts = tiers.map((t) => {
        const pct = Number(t?.member_discount_pct);
        return Number.isFinite(pct) ? pct : 0;
    });
    const memberFlats = tiers.map((t) => {
        const flat = Number(t?.member_discount_amount);
        return Number.isFinite(flat) ? flat : 0;
    });

    const narrowed = {
        ...ct,
        price_range: tiers,
        price_min: Math.min(...prices),
        price_max: Math.max(...prices),
        // Availability is counted per length server-side, so the type's
        // headline count narrows with the filter too.
        available_slots: tiers.reduce(
            (sum, t) => sum + (Number(t?.available_slots) || 0), 0,
        ),
    };

    // Each summary key is dropped rather than zeroed when it no longer applies:
    // ``offeringMemberDiscount`` and the price block both read "absent" as
    // "nothing to show", and a leftover key from the unfiltered set would
    // quote a discount none of the remaining slots grant.
    delete narrowed.original_price_min;
    delete narrowed.original_price_max;
    delete narrowed.discount_pct;
    delete narrowed.member_discount_pct;
    delete narrowed.member_discount_pct_min;
    delete narrowed.member_discount_amount;

    if (listTotal > paidTotal) {
        narrowed.original_price_min = Math.min(...originals);
        narrowed.original_price_max = Math.max(...originals);
        narrowed.discount_pct = Math.round(
            ((listTotal - paidTotal) / listTotal) * 100,
        );
    }
    if (Math.max(...memberPcts) > 0) {
        narrowed.member_discount_pct = Math.max(...memberPcts);
        narrowed.member_discount_pct_min = Math.min(...memberPcts);
    }
    if (Math.max(...memberFlats) > 0) {
        narrowed.member_discount_amount = Math.max(...memberFlats);
    }
    return narrowed;
};

const FindDoctors = () => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [selectedSpec, setSelectedSpec] = useState('');
    const [selectedType, setSelectedType] = useState(DEFAULT_TYPE);
    // Slot lengths, multi-select: "I have 20 minutes" is really "20 or less",
    // and a patient who can take either of two lengths shouldn't have to run
    // the search twice. Empty = every length, same as the type rail's All.
    const [selectedLengths, setSelectedLengths] = useState([]);
    const [filters, setFilters] = useState({});
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [page, setPage] = useState(1);

    // Slot counts per consultation type, for the availability badge on each
    // bubble. Same endpoint the Book-a-Consultation landing uses, so the two
    // screens can't advertise different availability for the same type.
    const { data: availability } = useGetSlotAvailabilitySummaryQuery();
    const { planName } = useMemberDiscount();
    const { basePath } = usePatientScope();

    const filterParams = useMemo(() => filtersToQueryParams(filters), [filters]);

    const { data, isLoading, isFetching, isError } = useGetDoctorsListQuery({
        ...filterParams,
        name: search || undefined,
        // The chip row is the primary specialisation control; the dialog only
        // exposes one when an admin has configured that field, so the chip
        // wins when both are set.
        specialization: selectedSpec || filterParams.specialization || undefined,
        consultation_type: selectedType || undefined,
        // Comma-joined so the server can whitelist doctor ids before
        // paginating — narrowing the page after the fact would report page
        // counts that don't match what's on it.
        duration: selectedLengths.length ? selectedLengths.join(',') : undefined,
        page,
        per_page: 12,
    });

    const doctors = data?.doctors || [];
    const totalPages = data?.pagination?.pages || 1;
    const activeFilterCount = countActiveFilters(filters);
    const focusMeta = selectedType ? CONSULTATION_TYPE_MAP[selectedType] : null;

    const handleSearchKeyDown = (e) => {
        if (e.key === 'Enter') {
            setSearch(searchInput);
            setPage(1);
        }
    };

    const handleSpecClick = (spec) => {
        setSelectedSpec(prev => prev === spec ? '' : spec);
        setPage(1);
    };

    // Picking a type is idempotent rather than a toggle: there's an explicit
    // All chip to get back, and a second click landing the patient on the
    // whole roster again reads as the filter having failed.
    const handleTypeClick = (type) => {
        setSelectedType(type);
        setPage(1);
    };

    // Lengths toggle, unlike the type rail: they're a set, and un-picking the
    // last one is the way back to "any length".
    const handleLengthClick = (range) => {
        setSelectedLengths((prev) => (
            prev.includes(range)
                ? prev.filter((r) => r !== range)
                : [...prev, range]
        ));
        setPage(1);
    };

    const handleApplyFilters = (next) => {
        setFilters(next);
        setPage(1);
        setFiltersOpen(false);
    };

    // Picking a doctor with a consultation type already chosen skips the
    // "which type?" screen and lands straight on that type's calendar —
    // the type is the whole reason they filtered.
    const handleBook = (doctorId, type) => {
        const chosen = type || selectedType;
        navigate(
            chosen
                ? `${basePath}/book/${doctorId}/${chosen}`
                : `${basePath}/book/${doctorId}`
        );
    };

    return (
        <Container maxWidth="lg" sx={{ py: 4 }}>
            {/* ── Header ── */}
            <Box mb={4}>
                <Typography variant="h4" fontWeight="bold" gutterBottom>
                    Find a Doctor
                </Typography>
                <Typography variant="body1" color="text.secondary">
                    Browse doctors with available appointment slots and book instantly.
                </Typography>
            </Box>

            {/* ── Search Bar ── */}
            <Box mb={2}>
                <TextField
                    fullWidth
                    placeholder="Search by doctor name… (press Enter)"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon color="action" />
                            </InputAdornment>
                        ),
                    }}
                    size="medium"
                    sx={{ bgcolor: 'background.paper', borderRadius: 2 }}
                />
            </Box>

            {/* ── Filters (same dialog as the Book-a-Consultation flow) ── */}
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap mb={3}>
                <Badge badgeContent={activeFilterCount} color="primary">
                    <Button
                        variant="outlined"
                        startIcon={<FilterListIcon />}
                        onClick={() => setFiltersOpen(true)}
                        sx={{ textTransform: 'none' }}
                    >
                        Filters
                    </Button>
                </Badge>
                {activeFilterCount > 0 && (
                    <Button size="small" onClick={() => { setFilters({}); setPage(1); }}>
                        Clear filters
                    </Button>
                )}
            </Stack>

            {/* ── Consultation Type Bubbles ── */}
            <Box mb={3}>
                <Typography variant="subtitle2" color="text.secondary" mb={1}>
                    Consultation type
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                    {/* All — the overview. Leads the rail because a patient
                        who landed in a focused type needs an obvious way out
                        to the whole roster. */}
                    <Chip
                        icon={<AppsIcon sx={{ fontSize: 18 }} />}
                        label="All"
                        onClick={() => handleTypeClick(ALL)}
                        variant={selectedType === ALL ? 'filled' : 'outlined'}
                        sx={{
                            cursor: 'pointer',
                            fontWeight: selectedType === ALL ? 700 : 500,
                            borderWidth: selectedType === ALL ? 0 : 1.5,
                            color: selectedType === ALL ? '#fff' : 'text.secondary',
                            bgcolor: selectedType === ALL ? 'text.primary' : 'transparent',
                            '& .MuiChip-icon': {
                                color: selectedType === ALL ? '#fff' : 'text.secondary',
                            },
                            '&:hover': {
                                bgcolor: selectedType === ALL ? 'text.primary' : 'action.hover',
                            },
                        }}
                    />
                    {BOOKABLE_TYPES.map((ct) => {
                        const slotInfo = availability?.[ct.value];
                        const isSelected = selectedType === ct.value;
                        return (
                            <Chip
                                key={ct.value}
                                label={
                                    slotInfo?.count
                                        ? `${ct.icon} ${ct.label} · ${slotInfo.count}`
                                        : `${ct.icon} ${ct.label}`
                                }
                                onClick={() => handleTypeClick(ct.value)}
                                variant={isSelected ? 'filled' : 'outlined'}
                                sx={{
                                    cursor: 'pointer',
                                    fontWeight: isSelected ? 700 : 500,
                                    borderColor: ct.color,
                                    borderWidth: isSelected ? 0 : 1.5,
                                    color: isSelected ? '#fff' : ct.color,
                                    bgcolor: isSelected ? ct.color : 'transparent',
                                    '&:hover': {
                                        bgcolor: isSelected ? ct.color : `${ct.color}15`,
                                    },
                                }}
                            />
                        );
                    })}
                </Box>

                {/* The focus banner. Replaces the old one-line caption: with a
                    type picked the whole page is about that type, so it gets a
                    header rather than a footnote. */}
                {focusMeta && (
                    <Paper
                        variant="outlined"
                        sx={{
                            mt: 2, p: 2, borderRadius: 3,
                            borderColor: `${focusMeta.color}55`,
                            bgcolor: `${focusMeta.color}0A`,
                        }}
                    >
                        <Stack direction="row" spacing={1.5} alignItems="flex-start">
                            <Box
                                sx={{
                                    width: 40, height: 40, borderRadius: 2, flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    bgcolor: `${focusMeta.color}1F`, fontSize: '1.25rem',
                                }}
                            >
                                {focusMeta.icon}
                            </Box>
                            <Box minWidth={0}>
                                <Typography variant="subtitle1" fontWeight={700} sx={{ color: focusMeta.color }}>
                                    {focusMeta.label}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {/* The shared constant's description has no
                                        trailing stop, so one is added here
                                        rather than in the constant — the
                                        doctor's own Pricing tab renders it as a
                                        standalone label where a full stop would
                                        be wrong. */}
                                    {focusMeta.description
                                        ? `${focusMeta.description}.`
                                        : 'Showing only what each doctor charges for this consultation.'}
                                    {planName && (
                                        <> Prices below show what your <strong>{planName}</strong>{' '}
                                            membership takes off each doctor's {focusMeta.shortLabel?.toLowerCase()
                                                || 'consultation'}.
                                        </>
                                    )}
                                </Typography>
                            </Box>
                        </Stack>
                    </Paper>
                )}
            </Box>

            {/* ── Slot Length Bubbles ── */}
            <Box mb={3}>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                    <Typography variant="subtitle2" color="text.secondary">
                        Slot length
                    </Typography>
                    {selectedLengths.length > 0 && (
                        <Button
                            size="small"
                            onClick={() => { setSelectedLengths([]); setPage(1); }}
                            sx={{ textTransform: 'none', minWidth: 0, py: 0 }}
                        >
                            Any length
                        </Button>
                    )}
                </Stack>
                <Box display="flex" flexWrap="wrap" gap={1}>
                    {/* Any — the unfiltered state, first for the same reason
                        All leads the type rail: a patient deep in a length
                        needs the obvious way back out. */}
                    <Chip
                        icon={<TimerOutlinedIcon sx={{ fontSize: 17 }} />}
                        label="Any"
                        onClick={() => { setSelectedLengths([]); setPage(1); }}
                        variant={selectedLengths.length === 0 ? 'filled' : 'outlined'}
                        sx={{
                            cursor: 'pointer',
                            fontWeight: selectedLengths.length === 0 ? 700 : 500,
                            borderWidth: selectedLengths.length === 0 ? 0 : 1.5,
                            color: selectedLengths.length === 0 ? '#fff' : 'text.secondary',
                            bgcolor: selectedLengths.length === 0 ? 'text.primary' : 'transparent',
                            '& .MuiChip-icon': {
                                color: selectedLengths.length === 0 ? '#fff' : 'text.secondary',
                            },
                            '&:hover': {
                                bgcolor: selectedLengths.length === 0 ? 'text.primary' : 'action.hover',
                            },
                        }}
                    />
                    {SLOT_RANGES.map((slot) => {
                        const isSelected = selectedLengths.includes(slot.range);
                        return (
                            <Chip
                                key={slot.range}
                                label={`${slot.short} min`}
                                onClick={() => handleLengthClick(slot.range)}
                                variant={isSelected ? 'filled' : 'outlined'}
                                color={isSelected ? 'primary' : 'default'}
                                sx={{
                                    cursor: 'pointer',
                                    fontWeight: isSelected ? 700 : 500,
                                    borderWidth: isSelected ? 0 : 1.5,
                                }}
                            />
                        );
                    })}
                </Box>
                {selectedLengths.length > 0 && (
                    <Typography variant="caption" color="text.secondary" display="block" mt={1}>
                        Showing doctors who offer{' '}
                        {selectedLengths.map(slotRangeLabel).join(' or ')} appointments,
                        priced for those lengths only.
                    </Typography>
                )}
            </Box>

            {/* ── Specialization Filter Chips ── */}
            <Box mb={4}>
                <Typography variant="subtitle2" color="text.secondary" mb={1}>
                    Speciality
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                    {SPECIALIZATION_FILTERS.map(spec => (
                        <Chip
                            key={spec}
                            label={spec}
                            onClick={() => handleSpecClick(spec)}
                            color={selectedSpec === spec ? 'primary' : 'default'}
                            variant={selectedSpec === spec ? 'filled' : 'outlined'}
                            sx={{ cursor: 'pointer' }}
                        />
                    ))}
                </Box>
            </Box>

            {/* ── Loading / Error States ── */}
            {(isLoading || isFetching) && (
                <Box display="flex" justifyContent="center" mt={6}>
                    <CircularProgress />
                </Box>
            )}
            {isError && (
                <Alert severity="error">Failed to load doctors. Please try again.</Alert>
            )}

            {/* ── Doctor Cards ── */}
            {!isLoading && !isError && (
                <>
                    {doctors.length === 0 ? (
                        <Box textAlign="center" mt={8}>
                            <MedicalServicesIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                            <Typography variant="h6" color="text.secondary">
                                No doctors found.
                            </Typography>
                            <Typography variant="body2" color="text.disabled" mt={1}>
                                Try a different search, consultation type, or clear your filters.
                            </Typography>
                        </Box>
                    ) : (
                        <Box
                            display="grid"
                            gridTemplateColumns={{
                                xs: '1fr',
                                sm: '1fr 1fr',
                                // Focused cards carry a priced slot table, so
                                // they get two columns of room instead of three.
                                md: selectedType ? '1fr 1fr' : '1fr 1fr 1fr',
                            }}
                            gap={3}
                        >
                            {doctors.map((doctor) => (
                                <DoctorCard
                                    key={doctor.id}
                                    doctor={doctor}
                                    selectedType={selectedType}
                                    selectedLengths={selectedLengths}
                                    planName={planName}
                                    onBook={(type) => handleBook(doctor.id, type)}
                                    onViewProfile={() => navigate(`${basePath}/doctor/${doctor.id}`)}
                                />
                            ))}
                        </Box>
                    )}

                    {/* ── Pagination ── */}
                    {totalPages > 1 && (
                        <Box display="flex" justifyContent="center" mt={5}>
                            <Pagination
                                count={totalPages}
                                page={page}
                                onChange={(_, v) => { setPage(v); window.scrollTo(0, 0); }}
                                color="primary"
                            />
                        </Box>
                    )}
                </>
            )}

            <FiltersDialog
                open={filtersOpen}
                onClose={() => setFiltersOpen(false)}
                initialFilters={filters}
                onApply={handleApplyFilters}
            />
        </Container>
    );
};

// ── One consultation type, priced, as a compact row (the ALL view) ────────────
const ConsultationRow = ({ ct, isSelected, planName, onBook }) => {
    const meta = CONSULTATION_TYPE_MAP[ct.type] || {};
    const noSlots = !ct.available_slots;
    const original = formatOriginalPrice(ct);
    const member = offeringMemberDiscount(ct);

    return (
        <Tooltip
            title={
                noSlots
                    ? 'No open slots right now'
                    : [
                        `${ct.available_slots} slot${ct.available_slots !== 1 ? 's' : ''} available — click to book`,
                        // The row itself is a single cramped line, so the
                        // percentages ride along here rather than squeezing
                        // more figures in beside the price.
                        original && ct.discount_pct
                            ? `${ct.discount_pct}% off the list price`
                            : null,
                        member.pct > 0
                            ? `${member.exact ? '' : 'up to '}${member.pct}% more with your ${planName || 'membership'}`
                            : null,
                        member.flat > 0
                            ? `${formatMoney(member.flat)} voucher available on top`
                            : null,
                    ].filter(Boolean).join(' · ')
            }
        >
            <Box
                onClick={(e) => { e.stopPropagation(); onBook(ct.type); }}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    px: 1.25,
                    py: 0.75,
                    borderRadius: 2,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: isSelected ? meta.color || 'primary.main' : 'divider',
                    bgcolor: isSelected ? `${meta.color || '#1976d2'}12` : 'transparent',
                    opacity: noSlots ? 0.6 : 1,
                    transition: 'background-color 0.15s',
                    '&:hover': { bgcolor: `${meta.color || '#1976d2'}20` },
                }}
            >
                <Box display="flex" alignItems="center" gap={0.75} minWidth={0}>
                    <Typography component="span" fontSize="0.95rem">
                        {meta.icon}
                    </Typography>
                    <Typography variant="caption" noWrap fontWeight={isSelected ? 700 : 500}>
                        {meta.shortLabel || ct.type}
                    </Typography>
                    {/* The per-offering figure, not the plan's ceiling — this
                        doctor's this consultation may be dialled below it. */}
                    {member.hasDiscount && (
                        <Typography
                            variant="caption"
                            sx={{
                                // Literal tint, not 'success.50' — the theme
                                // defines success by `main` only, so MUI has no
                                // 50 shade to resolve and the fill silently
                                // dropped out.
                                fontWeight: 700, color: 'success.dark', bgcolor: 'rgba(76,175,80,0.10)',
                                border: '1px solid', borderColor: 'success.light',
                                borderRadius: 1, px: 0.5, lineHeight: 1.6, fontSize: '0.6rem',
                            }}
                        >
                            {member.exact ? '' : '≤'}{member.pct}%
                        </Typography>
                    )}
                </Box>
                <DiscountedPrice
                    price={formatPrice(ct.price_min, ct.price_max)}
                    original={original}
                    discountPct={ct.discount_pct}
                    variant="caption"
                    color={meta.color || 'text.primary'}
                    showPct={false}
                    spacing={0.5}
                    sx={{ flexWrap: 'nowrap', whiteSpace: 'nowrap' }}
                />
            </Box>
        </Tooltip>
    );
};

// ── One consultation type, in full (the FOCUS view) ──────────────────────────
//
// The whole point of picking a type: this doctor's price for it, the duration
// slots behind that price, and the exact membership reduction on each — the
// plan × doctor × consultation figure, which is the only one the patient will
// actually be charged.
const ConsultationFocus = ({ ct, planName, onBook }) => {
    const meta = CONSULTATION_TYPE_MAP[ct.type] || {};
    const color = meta.color || '#1976d2';
    const original = formatOriginalPrice(ct);
    const member = offeringMemberDiscount(ct);
    const tiers = (ct.price_range || []).filter((t) => t?.price != null);

    // Deliberately no post-membership figure anywhere in this block. The
    // percentage is unconditional, but the amount it lands on depends on the
    // slot the patient ends up choosing, so quoting a payable range here only
    // invites a mismatch with the number the billing screen produces. Every
    // price on this card is the pre-membership one, and the reduction is
    // stated as a percentage that settles at billing.

    return (
        <Box
            sx={{
                mt: 1.5, p: 1.75, borderRadius: 2.5,
                border: '1px solid', borderColor: `${color}44`,
                bgcolor: `${color}08`,
            }}
        >
            <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} mb={1}>
                <Stack direction="row" alignItems="center" spacing={0.75} minWidth={0}>
                    <Typography component="span" fontSize="1.05rem">{meta.icon}</Typography>
                    <Typography variant="subtitle2" fontWeight={700} noWrap sx={{ color }}>
                        {meta.label || ct.type}
                    </Typography>
                </Stack>
                <Chip
                    size="small"
                    icon={<EventAvailableIcon sx={{ fontSize: 15 }} />}
                    label={ct.available_slots
                        ? `${ct.available_slots} slot${ct.available_slots !== 1 ? 's' : ''}`
                        : 'No slots'}
                    color={ct.available_slots ? 'success' : 'default'}
                    variant="outlined"
                    sx={{ height: 22, fontSize: '0.68rem', '& .MuiChip-label': { px: 0.75 } }}
                />
            </Stack>

            {/* Headline price for the type — the admin-overlay markdown is
                already inside it, and the struck figure is what it came down
                from. The membership reduction is deliberately NOT struck here:
                it's a separate benefit that settles at billing, and two struck
                numbers on one row leave the patient unable to tell which
                discount is which. */}
            <DiscountedPrice
                price={formatPrice(ct.price_min, ct.price_max)}
                original={original}
                discountPct={ct.discount_pct}
                variant="h6"
                originalVariant="body2"
                color={color}
                showPct={false}
            />

            {/* The plan × doctor × consultation figure. */}
            {member.hasDiscount && (
                <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{
                        mt: 1, px: 1, py: 0.75, borderRadius: 2,
                        border: '1px solid', borderColor: 'success.light',
                        bgcolor: 'rgba(76,175,80,0.10)',
                    }}
                >
                    <LoyaltyIcon fontSize="small" color="success" />
                    <Box minWidth={0}>
                        {/* Guarded on the percentage, not on the block: a tier
                            can grant 0% and still carry a voucher, and "0% off
                            with Gold" is worse than saying nothing. */}
                        {member.pct > 0 && (
                            <>
                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'success.dark', display: 'block' }}>
                                    {member.exact ? `${member.pct}% off` : `Up to ${member.pct}% off`}
                                    {planName ? ` with ${planName}` : ' with your membership'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" display="block">
                                    Applied at billing
                                </Typography>
                            </>
                        )}

                    </Box>
                </Stack>
            )}

            {/* Per-slot detail. Each duration is separately priced AND
                separately discountable, so a tier that grants less than its
                neighbours says so on its own line rather than hiding behind
                the "up to" above. */}
            {tiers.length > 0 && (
                <Stack spacing={0.5} mt={1.25}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                        By slot length
                    </Typography>
                    {tiers.map((tier, i) => {
                        const tierMember = offeringMemberDiscount(tier);

                        return (
                            <Stack
                                key={`${tier.range}-${i}`}
                                direction="row"
                                alignItems="flex-start"
                                justifyContent="space-between"
                                gap={1}
                            >
                                <Typography variant="caption" color="text.secondary" noWrap>
                                    {slotRangeLabel(tier.range)}
                                    {tier.description ? ` · ${tier.description}` : ''}
                                    {/* Per-length availability. A priced row is
                                        not a bookable one — a doctor can list a
                                        40-min rate and have no 40-min slot open
                                        — and the type-level count above can't
                                        say which lengths it is made of. */}
                                    {tier.available_slots != null && (
                                        <Typography
                                            component="span"
                                            variant="caption"
                                            sx={{ ml: 0.5 }}
                                            color={tier.available_slots > 0 ? 'success.main' : 'text.disabled'}
                                        >
                                            · {tier.available_slots > 0
                                                ? `${tier.available_slots} open`
                                                : 'none open'}
                                        </Typography>
                                    )}
                                </Typography>
                                {/* The before-membership price, stated plainly,
                                    with the tier's own percentage in words
                                    beneath it. No struck figure and no payable
                                    number: the reduction is settled at billing,
                                    and a second price here is what made the row
                                    ambiguous about which discount was which. */}
                                <Stack alignItems="flex-end" sx={{ maxWidth: '55%', textAlign: 'right' }}>
                                    <Typography
                                        variant="caption"
                                        color="text.primary"
                                        fontWeight={700}
                                        whiteSpace="nowrap"
                                    >
                                        {formatMoney(tier.price)}
                                    </Typography>
                                    {tierMember.pct > 0 && (
                                        <Typography
                                            variant="caption"
                                            color="success.dark"
                                            sx={{ fontSize: '0.65rem', lineHeight: 1.3 }}
                                        >
                                            {tierMember.pct}% membership discount, applied at billing
                                        </Typography>
                                    )}
                                </Stack>
                            </Stack>
                        );
                    })}
                </Stack>
            )}

            <Button
                fullWidth
                size="small"
                variant="contained"
                onClick={(e) => { e.stopPropagation(); onBook(ct.type); }}
                disabled={!ct.available_slots}
                sx={{
                    mt: 1.5, borderRadius: 2, fontWeight: 700, textTransform: 'none',
                    bgcolor: color, '&:hover': { bgcolor: color, filter: 'brightness(0.9)' },
                }}
            >
                {ct.available_slots
                    ? `Book ${meta.shortLabel || ct.type}`
                    : 'No open slots'}
            </Button>
        </Box>
    );
};

// ── Doctor Card ───────────────────────────────────────────────────────────────
const DoctorCard = ({ doctor, selectedType, selectedLengths = [], planName, onBook, onViewProfile }) => {
    const specs = doctor.specializations || [];
    const languages = doctor.languages_known || [];

    // Every type this doctor offers, restricted to the lengths the patient
    // asked for. Types left with nothing at those lengths drop out — the
    // doctor is on the page because SOME type of theirs matched, and listing
    // the ones that didn't is how a length filter ends up showing prices it
    // was asked to exclude.
    const consultationTypes = useMemo(() => (
        (doctor.consultation_types || [])
            .map((ct) => narrowToLengths(ct, selectedLengths))
            .filter(Boolean)
    ), [doctor.consultation_types, selectedLengths]);

    // The type this card is focused on, if any. A doctor missing it (the list
    // is filtered server-side, so only if the two disagree) falls back to the
    // full list rather than rendering an empty card.
    const focused = selectedType
        ? consultationTypes.find((ct) => ct.type === selectedType) || null
        : null;

    // With a type selected but no focused entry, that one still leads.
    const orderedTypes = useMemo(() => {
        if (!selectedType) return consultationTypes;
        return [...consultationTypes].sort((a, b) => {
            if (a.type === selectedType) return -1;
            if (b.type === selectedType) return 1;
            return 0;
        });
    }, [consultationTypes, selectedType]);

    // No card-level discount chip: the membership reduction varies per
    // consultation AND per slot length, so a single corner figure could only
    // ever be an "upto" that half the rows below it don't grant. Each
    // consultation states its own percentage where its own price is.

    // ``doctor.has_slots`` is the doctor's whole calendar; with a length
    // filter on it would badge "Slots Available" off 10-minute slots the
    // patient excluded. The narrowed per-length counts are the honest answer.
    const hasSlots = selectedLengths.length
        ? consultationTypes.some((ct) => ct.available_slots > 0)
        : doctor.has_slots;

    return (
        <Card
            elevation={2}
            sx={{
                position: 'relative',
                overflow: 'visible',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: 3,
                transition: 'box-shadow 0.2s',
                '&:hover': { boxShadow: 6 },
            }}
        >
            <CardContent sx={{ flex: 1 }}>
                {/* Avatar + Name */}
                <Box display="flex" gap={2} alignItems="center" mb={2}>
                    <Avatar
                        src={doctor.profile_image}
                        sx={{ width: 56, height: 56, bgcolor: 'primary.main' }}
                    >
                        <PersonIcon />
                    </Avatar>
                    <Box>
                        <Typography variant="subtitle1" fontWeight="bold" lineHeight={1.2}>
                            {doctor.full_name}
                            {doctor.highest_qualification ? (
                                <Typography component="span" variant="caption" color="text.secondary" fontWeight={600}>
                                    {' '}, {doctor.highest_qualification}
                                </Typography>
                            ) : null}
                        </Typography>
                        {specs.length > 0 && (
                            <Typography variant="caption" color="text.secondary" display="block">
                                {specs.slice(0, 2).join(' · ')}
                                {doctor.city ? ` · ${doctor.city}` : ''}
                            </Typography>
                        )}
                    </Box>
                </Box>

                <Divider sx={{ mb: 1.5 }} />

                {/* Experience */}
                {doctor.experience_years != null && (
                    <Box display="flex" alignItems="center" gap={0.75} mb={0.75}>
                        <WorkIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                            {doctor.experience_years} yr{doctor.experience_years !== 1 ? 's' : ''} experience
                        </Typography>
                    </Box>
                )}

                {/* Languages */}
                {languages.length > 0 && (
                    <Box display="flex" alignItems="center" gap={0.75} mb={1}>
                        <TranslateIcon fontSize="small" color="action" />
                        <Typography variant="body2" color="text.secondary">
                            {languages.slice(0, 3).join(', ')}
                            {languages.length > 3 ? ` +${languages.length - 3}` : ''}
                        </Typography>
                    </Box>
                )}

                {focused ? (
                    <ConsultationFocus ct={focused} planName={planName} onBook={onBook} />
                ) : orderedTypes.length > 0 ? (
                    /* Consultation types offered, with what each one costs.
                       Each row books that specific type directly. */
                    <Box mt={1.5}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600}>
                            Consultations offered
                        </Typography>
                        <Stack spacing={0.75} mt={0.75}>
                            {orderedTypes.map((ct) => (
                                <ConsultationRow
                                    key={ct.type}
                                    ct={ct}
                                    isSelected={selectedType === ct.type}
                                    planName={planName}
                                    onBook={onBook}
                                />
                            ))}
                        </Stack>
                    </Box>
                ) : (
                    <Typography variant="caption" color="text.disabled" display="block" mt={1.5}>
                        No consultation pricing published yet.
                    </Typography>
                )}

                {/* Slots available badge. In focus mode the availability that
                    matters is this type's own, and it's already on the block
                    above — a second "Slots Available" counting every type
                    would contradict it. */}
                {!focused && (
                    <Box mt={1.5}>
                        <Chip
                            label={hasSlots ? 'Slots Available' : 'No Slots Available'}
                            color={hasSlots ? 'success' : 'error'}
                            size="small"
                            variant="outlined"
                        />
                    </Box>
                )}
            </CardContent>

            {/* Actions: View Profile is always available; the focus block
                carries its own Book button for the chosen type, so a second
                generic Book below would only lose the type just picked. */}
            <CardActions sx={{ px: 2, pb: 2, gap: 1 }}>
                <Button
                    variant="outlined"
                    fullWidth={focused}
                    onClick={onViewProfile}
                    sx={{ borderRadius: 2, fontWeight: 600 }}
                >
                    View Profile
                </Button>
                {!focused && (
                    <Button
                        variant="contained"
                        fullWidth
                        onClick={() => onBook()}
                        sx={{ borderRadius: 2, fontWeight: 'bold' }}
                    >
                        {selectedType
                            ? `Book ${CONSULTATION_TYPE_MAP[selectedType]?.shortLabel || selectedType}`
                            : 'Book Now'}
                    </Button>
                )}
            </CardActions>
        </Card>
    );
};

export default FindDoctors;
