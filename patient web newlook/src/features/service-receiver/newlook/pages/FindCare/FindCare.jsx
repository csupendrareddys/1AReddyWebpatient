/**
 * Find Care (new look) — port of the mobile MVP's ``app/(tabs)/find-care.tsx``:
 * one search box across everything a patient can look for, with a category
 * switcher carrying live result counts.
 *
 * Wired to REAL endpoints — doctors (``/doctor/list``), symptoms, the
 * marketplace catalogue and health plans. The mobile app's fourth category was
 * Recovery Plans, which has no backend product yet, so that category routes to
 * the assumed-endpoint Recovery Plans page (and shows 0 until it ships).
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Avatar, Box, Button, ButtonBase, CircularProgress, InputAdornment,
    TextField, Typography,
} from '@mui/material';
import NLCard from '../../components/NLCard';
import NLBadge from '../../components/NLBadge';
import NLIcon from '../../components/NLIcon';
import NLEmptyState from '../../components/NLEmptyState';
import {
    useGetDoctorsListQuery,
    useGetSymptomsQuery,
    useBrowseMarketplaceQuery,
    useBrowseGroupOfferingsQuery,
} from '../../../api/scopedBookingApi';
// ASSUMED endpoint (#10) — the doctor list filters on role == DOCTOR, so
// clinics and hospitals have no patient-facing directory yet.
import { useGetNLFacilitiesQuery } from '../../api/assumedEndpoints';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { inr } from '../../utils/format';

/** All the things a patient can search for, in one place — as on mobile. */
const CATEGORIES = [
    { key: 'doctors', label: 'Find a Doctor', icon: 'person-outline' },
    { key: 'clinics', label: 'Find a Clinic', icon: 'business-outline' },
    { key: 'hospitals', label: 'Find a Hospital', icon: 'medkit-outline' },
    { key: 'services', label: 'Services', icon: 'storefront-outline' },
    { key: 'plans', label: 'Health Plans', icon: 'heart-circle-outline' },
];

const matches = (q, ...fields) =>
    !q || fields.some((f) => String(f || '').toLowerCase().includes(q.toLowerCase()));

const FindCare = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const go = (p) => navigate(`${basePath}/${p}`);

    const [category, setCategory] = useState('doctors');
    const [query, setQuery] = useState('');
    const [activeSymptom, setActiveSymptom] = useState(null);

    const { data: doctorsData, isLoading: doctorsLoading } = useGetDoctorsListQuery({});
    const { data: symptomsData } = useGetSymptomsQuery();
    const { data: products = [] } = useBrowseMarketplaceQuery(undefined, {
        skip: !hasFeature('clinic.marketplace'),
    });
    const { data: offeringsData } = useBrowseGroupOfferingsQuery();
    // Facilities load only when their sub-head is open — no point 404ing twice
    // on every visit while the endpoint doesn't exist.
    const { data: clinics = [], error: clinicsError } = useGetNLFacilitiesQuery('clinic', {
        skip: category !== 'clinics',
    });
    const { data: hospitals = [], error: hospitalsError } = useGetNLFacilitiesQuery('hospital', {
        skip: category !== 'hospitals',
    });

    const doctors = doctorsData?.doctors || [];
    const symptoms = (symptomsData?.symptoms || []).slice(0, 20);
    const offerings = offeringsData?.offerings || offeringsData || [];

    // The symptom chips narrow doctors by specialization the way the mobile
    // screen did — a contains-match, not a backend re-query, so it's instant.
    const filteredDoctors = useMemo(() => doctors.filter((d) => {
        const specs = (d.specializations || []).map((s) => (typeof s === 'string' ? s : s?.name || ''));
        const bySymptom = activeSymptom
            ? specs.some((s) => s.toLowerCase().includes(String(activeSymptom).split(' ')[0].toLowerCase()))
            : true;
        return matches(query, d.full_name, ...specs) && bySymptom;
    }), [doctors, query, activeSymptom]);

    const filteredServices = useMemo(
        () => products.filter((p) => matches(query, p.product_name, p.doctor_name, p.product_description)),
        [products, query],
    );
    const filteredPlans = useMemo(
        () => (Array.isArray(offerings) ? offerings : []).filter(
            (p) => matches(query, p.plan_name, p.name, p.speciality, p.description),
        ),
        [offerings, query],
    );

    const filteredClinics = useMemo(
        () => clinics.filter((f) => matches(query, f.name, f.city, ...(f.specialities || []))),
        [clinics, query],
    );
    const filteredHospitals = useMemo(
        () => hospitals.filter((f) => matches(query, f.name, f.city, ...(f.specialities || []))),
        [hospitals, query],
    );

    const counts = {
        doctors: filteredDoctors.length,
        clinics: filteredClinics.length,
        hospitals: filteredHospitals.length,
        services: filteredServices.length,
        plans: filteredPlans.length,
    };

    const placeholder = category === 'doctors'
        ? 'Search doctor or specialty'
        : category === 'clinics'
            ? 'Search clinic or city'
            : category === 'hospitals'
                ? 'Search hospital or city'
                : category === 'services'
                    ? 'Search services or providers'
                    : 'Search plan or speciality';

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Find Care</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                One search across doctors, services and health plans.
            </Typography>

            <TextField
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                size="small"
                fullWidth
                sx={{ mb: 1.75 }}
                InputProps={{
                    startAdornment: (
                        <InputAdornment position="start">
                            <NLIcon name="search-outline" size={18} color={colors.textMuted} />
                        </InputAdornment>
                    ),
                }}
            />

            {/* Category switcher — one search box across all product types. */}
            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: 1.75 }}>
                {CATEGORIES.map((c) => {
                    const active = category === c.key;
                    return (
                        <ButtonBase
                            key={c.key}
                            onClick={() => setCategory(c.key)}
                            aria-pressed={active}
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                px: '13px',
                                py: '9px',
                                borderRadius: `${radius.pill}px`,
                                border: `1px solid ${active ? colors.primary : colors.border}`,
                                bgcolor: active ? colors.primary : colors.surface,
                            }}
                        >
                            <NLIcon
                                name={c.icon}
                                size={14}
                                color={active ? colors.white : colors.textSecondary}
                            />
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    color: active ? colors.white : colors.textSecondary,
                                }}
                            >
                                {c.label}
                            </Typography>
                            <Box
                                sx={{
                                    minWidth: 18,
                                    px: '5px',
                                    borderRadius: `${radius.pill}px`,
                                    textAlign: 'center',
                                    bgcolor: active ? 'rgba(255,255,255,0.28)' : colors.background,
                                }}
                            >
                                <Typography
                                    sx={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        color: active ? colors.white : colors.textSecondary,
                                    }}
                                >
                                    {counts[c.key]}
                                </Typography>
                            </Box>
                        </ButtonBase>
                    );
                })}
            </Box>

            {/* ── Doctors ─────────────────────────────────────────────── */}
            {category === 'doctors' ? (
                <>
                    {symptoms.length ? (
                        <Box
                            sx={{
                                display: 'flex',
                                gap: '8px',
                                overflowX: 'auto',
                                pb: 1.5,
                                scrollbarWidth: 'none',
                                '&::-webkit-scrollbar': { display: 'none' },
                            }}
                        >
                            {symptoms.map((s) => {
                                const name = s.name || s;
                                const active = activeSymptom === name;
                                return (
                                    <ButtonBase
                                        key={s.id || name}
                                        onClick={() => setActiveSymptom(active ? null : name)}
                                        sx={{
                                            px: '14px',
                                            py: '8px',
                                            borderRadius: `${radius.pill}px`,
                                            flexShrink: 0,
                                            border: `1px solid ${active ? colors.secondary : colors.border}`,
                                            bgcolor: active ? colors.secondary : colors.surface,
                                            color: active ? colors.white : colors.textSecondary,
                                            fontSize: 12.5,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {name}
                                    </ButtonBase>
                                );
                            })}
                        </Box>
                    ) : null}

                    {doctorsLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                            <CircularProgress />
                        </Box>
                    ) : filteredDoctors.length ? (
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                gap: '12px',
                            }}
                        >
                            {filteredDoctors.map((d) => {
                                const specs = (d.specializations || [])
                                    .map((s) => (typeof s === 'string' ? s : s?.name || ''))
                                    .filter(Boolean);
                                return (
                                    <NLCard key={d.id} sx={{ display: 'flex', gap: 1.5 }}>
                                        <Avatar src={d.profile_image || undefined} sx={{ width: 52, height: 52 }}>
                                            {(d.full_name || '?')[0]}
                                        </Avatar>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography sx={typography.h3}>Dr. {d.full_name}</Typography>
                                            <Typography sx={{ ...typography.bodyMuted, ...clamp(1) }}>
                                                {specs.join(', ') || d.highest_qualification || 'Doctor'}
                                            </Typography>
                                            <Typography sx={typography.caption}>
                                                {[
                                                    d.experience_years ? `${d.experience_years} yrs` : null,
                                                    d.city,
                                                ].filter(Boolean).join(' · ')}
                                            </Typography>
                                            <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    onClick={() => go(`doctor/${d.id}`)}
                                                >
                                                    View profile
                                                </Button>
                                                <Button
                                                    size="small"
                                                    variant="contained"
                                                    onClick={() => go(`newlook/book/consult/${d.id}`)}
                                                >
                                                    Book
                                                </Button>
                                            </Box>
                                        </Box>
                                        {d.has_slots === false ? (
                                            <NLBadge label="No slots" tone="neutral" />
                                        ) : null}
                                    </NLCard>
                                );
                            })}
                        </Box>
                    ) : (
                        <NLEmptyState
                            icon="medkit-outline"
                            title="No doctors found"
                            subtitle="Try a different search or symptom."
                        />
                    )}
                </>
            ) : null}

            {/* ── Clinics / Hospitals (assumed directory) ─────────────── */}
            {category === 'clinics' || category === 'hospitals' ? (
                <FacilityList
                    kind={category === 'clinics' ? 'clinic' : 'hospital'}
                    rows={category === 'clinics' ? filteredClinics : filteredHospitals}
                    error={category === 'clinics' ? clinicsError : hospitalsError}
                    onOpenServices={(f) => navigate(
                        `${basePath}/marketplace?doctor=${encodeURIComponent(f.name || '')}`,
                    )}
                />
            ) : null}

            {/* ── Services ────────────────────────────────────────────── */}
            {category === 'services' ? (
                filteredServices.length ? (
                    filteredServices.map((p) => (
                        <ButtonBase
                            key={p.id}
                            onClick={() => go('marketplace')}
                            sx={{ display: 'block', width: '100%', textAlign: 'left', mb: 1.25, borderRadius: `${radius.md}px` }}
                        >
                            <NLCard sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <Box
                                    sx={{
                                        width: 38,
                                        height: 38,
                                        borderRadius: '50%',
                                        bgcolor: tint(colors.secondary, 0.1),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    <NLIcon name="storefront-outline" size={19} color={colors.secondary} />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={typography.h3}>{p.product_name}</Typography>
                                    <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>
                                        {p.doctor_description || p.product_description || (p.doctor_name ? `Dr. ${p.doctor_name}` : '')}
                                    </Typography>
                                </Box>
                                <Box sx={{ textAlign: 'right' }}>
                                    <Typography sx={{ fontSize: 14, fontWeight: 800, color: colors.textPrimary }}>
                                        {p.doctor_price != null ? inr(p.doctor_price) : ''}
                                    </Typography>
                                    <NLIcon name="chevron-forward" size={16} color={colors.textMuted} />
                                </Box>
                            </NLCard>
                        </ButtonBase>
                    ))
                ) : (
                    <NLEmptyState icon="storefront-outline" title="No services match" />
                )
            ) : null}

            {/* ── Health Plans ────────────────────────────────────────── */}
            {category === 'plans' ? (
                filteredPlans.length ? (
                    filteredPlans.map((p) => (
                        <ButtonBase
                            key={p.id}
                            onClick={() => go('health-plans')}
                            sx={{ display: 'block', width: '100%', textAlign: 'left', mb: 1.25, borderRadius: `${radius.md}px` }}
                        >
                            <NLCard>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                                    <Typography sx={{ ...typography.h3, flex: 1 }}>
                                        {p.plan_name || p.name}
                                    </Typography>
                                    {p.speciality ? <NLBadge label={p.speciality} tone="neutral" /> : null}
                                </Box>
                                <Typography sx={{ ...typography.bodyMuted, mt: 0.5, ...clamp(2) }}>
                                    {p.description}
                                </Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                                    <Typography sx={{ fontSize: 19, fontWeight: 800, color: colors.primary }}>
                                        {p.patient_price != null ? inr(p.patient_price)
                                            : p.price != null ? inr(p.price) : ''}
                                    </Typography>
                                    <NLIcon name="chevron-forward" size={16} color={colors.textMuted} />
                                </Box>
                            </NLCard>
                        </ButtonBase>
                    ))
                ) : (
                    <NLEmptyState icon="heart-circle-outline" title="No care plans match" />
                )
            ) : null}
        </Box>
    );
};

/**
 * Clinic / hospital results. Their directory is an ASSUMED endpoint, so this
 * block owns the honest banner; "View services" reuses the marketplace's
 * existing ?doctor= search seeding, which needs no new backend.
 */
export const FacilityList = ({ kind, rows, error, onOpenServices }) => (
    <>
        <NLAssumedNotice
            error={error}
            endpoint={`GET /api/patient/facilities?type=${kind}`}
        >
            Until it ships, {kind === 'clinic' ? 'clinics' : 'hospitals'} can&apos;t be
            listed here.
        </NLAssumedNotice>
        {rows.length ? rows.map((f) => (
            <NLCard key={f.id} sx={{ display: 'flex', gap: 1.5, mb: 1.25 }}>
                <Avatar src={f.profile_image || undefined} sx={{ width: 52, height: 52 }}>
                    <NLIcon
                        name={kind === 'clinic' ? 'business-outline' : 'medkit-outline'}
                        size={22}
                        color={colors.primary}
                    />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={typography.h3}>{f.name}</Typography>
                    <Typography sx={{ ...typography.bodyMuted, ...clamp(1) }}>
                        {[f.city, f.address].filter(Boolean).join(' · ')}
                    </Typography>
                    {(f.specialities || []).length ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '5px', mt: 0.75 }}>
                            {f.specialities.slice(0, 4).map((sp) => (
                                <NLBadge key={sp} label={sp} tone="neutral" />
                            ))}
                        </Box>
                    ) : null}
                    <Box sx={{ mt: 1 }}>
                        <Button size="small" variant="outlined" onClick={() => onOpenServices(f)}>
                            View services{f.services_count ? ` (${f.services_count})` : ''}
                        </Button>
                    </Box>
                </Box>
            </NLCard>
        )) : !error ? (
            <NLEmptyState
                icon={kind === 'clinic' ? 'business-outline' : 'medkit-outline'}
                title={`No ${kind === 'clinic' ? 'clinics' : 'hospitals'} found`}
                subtitle="Try a different search."
            />
        ) : null}
    </>
);

export default FindCare;
