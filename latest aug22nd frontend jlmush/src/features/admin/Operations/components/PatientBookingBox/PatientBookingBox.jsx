/**
 * PatientBookingBox — the patient's own booking screens, mounted inside the
 * admin Operations detail page and pointed at one specific patient.
 *
 * Same bargain as the Profile tab: rather than a second set of admin-only
 * booking forms that drift from the real ones, this renders the actual patient
 * booking pages. The scope provider re-points every request at the
 * act-on-behalf proxy (``api/scopedBookingApi``) and swaps the Razorpay step
 * for an audited offline settlement (``api/usePatientCheckout``).
 *
 * Routing
 * -------
 * The consultation flow is genuinely multi-page — pick a type, match doctors,
 * then a slot on ``book/:doctorId/:consultationType`` — so it needs real
 * routes. They are nested under the member-detail route's splat, and the pages
 * navigate between each other via ``basePath`` from {@link usePatientScope},
 * which the provider sets to this subtree. So the same components resolve to
 * ``/dashboard/patient/...`` for a patient and to
 * ``/dashboard/admin/operations/patient/<op>/<id>/book/...`` here.
 *
 * (A nested MemoryRouter would have avoided the base-path plumbing entirely,
 * which is why it was tried first — but React Router throws
 * "You cannot render a <Router> inside another <Router>", so that isn't an
 * option. Real routes also mean the admin's Back button and URL work.)
 */
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
    Box, Paper, CircularProgress, Tabs, Tab, Alert, Button, ToggleButton,
    ToggleButtonGroup, Typography, Stack,
} from '@mui/material';

import { usePatientScope } from
    '../../../../service-receiver/ProfileSetting/context/PatientScopeContext';

const ConsultationTypeLanding = lazy(() => import(
    '../../../../service-receiver/pages/BookByType/ConsultationTypeLanding'));
const DoctorMatchPage = lazy(() => import(
    '../../../../service-receiver/pages/BookByType/DoctorMatchPage'));
const ChooseConsultationType = lazy(() => import(
    '../../../../service-receiver/pages/BookAppointment/ChooseConsultationType'));
const BookAppointment = lazy(() => import(
    '../../../../service-receiver/pages/BookAppointment/BookAppointment'));
const FindDoctors = lazy(() => import(
    '../../../../service-receiver/pages/FindDoctors/FindDoctors'));
const DoctorProfile = lazy(() => import(
    '../../../../service-receiver/pages/DoctorProfile/DoctorProfile'));
const BrowseMarketplace = lazy(() => import(
    '../../../../service-receiver/Marketplace/pages/BrowseMarketplace/BrowseMarketplace'));
const HealthPlans = lazy(() => import(
    '../../../../service-receiver/HealthPlans/pages/HealthPlans/HealthPlans'));
const MyAppointments = lazy(() => import(
    '../../../../service-receiver/pages/MyAppointments/MyAppointments'));
const PatientSpending = lazy(() => import(
    '../../../../service-receiver/pages/PatientSpending/PatientSpending'));

// The four entry points, in the order an operator reaches for them. `match`
// takes the path RELATIVE to basePath and decides which one the nav
// highlights.
const SECTIONS = [
    { key: 'appointments', label: 'Appointment', to: 'book-by-type',
      match: (p) => p.startsWith('book') || p.startsWith('find-doctors')
                 || p.startsWith('doctor/') },
    { key: 'services', label: 'Service / Product', to: 'marketplace',
      match: (p) => p.startsWith('marketplace') },
    { key: 'plans', label: 'Health Plan (group)', to: 'health-plans',
      match: (p) => p.startsWith('health-plans') },
    { key: 'existing', label: 'Existing bookings', to: 'my-appointments',
      match: (p) => p.startsWith('my-appointments') },
    // "Did they actually pay?" — the ledger behind everything above, and the
    // question support asks right after settling a booking offline.
    { key: 'spending', label: 'Spending', to: 'spending',
      match: (p) => p.startsWith('spending') },
];

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

/**
 * A destination this subtree doesn't carry — the patient's records hub, a
 * video room, the services chat. Says so rather than bouncing silently,
 * because a button that appears to do nothing reads as a bug.
 */
function OutsideTheBox() {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { pathname } = useLocation();
    return (
        <Box sx={{ p: 3 }}>
            <Alert
                severity="info"
                action={
                    <Button size="small" color="inherit"
                        onClick={() => navigate(`${basePath}/book-by-type`)}>
                        Back to booking
                    </Button>
                }
            >
                <b>{pathname.replace(basePath, '') || '/'}</b> is part of the patient's
                own app and isn't available from Operations — this view covers booking
                and the bookings that result from it.
            </Alert>
        </Box>
    );
}

/** In-box navigation + the payment-mode switch that governs all three flows. */
function BoxChrome() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { basePath, isOps, markAsPaid, setMarkAsPaid } = usePatientScope();
    // Path relative to this subtree, e.g. 'book/<id>/video'.
    const rel = pathname.startsWith(basePath)
        ? pathname.slice(basePath.length).replace(/^\//, '')
        : '';
    const active = SECTIONS.findIndex((s) => s.match(rel));

    return (
        <Paper variant="outlined" sx={{ mb: 2 }}>
            <Tabs
                value={active === -1 ? false : active}
                onChange={(_, i) => navigate(`${basePath}/${SECTIONS[i].to}`)}
                variant="scrollable"
                scrollButtons="auto"
            >
                {SECTIONS.map((s) => <Tab key={s.key} label={s.label} />)}
            </Tabs>

            {/* Offline settlement is an ADMIN-only affordance (Operations). A
                patient guardian booking for their own minor pays through the
                real gateway like any patient, so this never shows for them. */}
            {isOps && (
                <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
                    <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Typography variant="body2" fontWeight={600}>Payment</Typography>
                        <ToggleButtonGroup
                            exclusive size="small" value={markAsPaid}
                            onChange={(_, v) => { if (v !== null) setMarkAsPaid(v); }}
                        >
                            <ToggleButton value={false}>Leave unpaid</ToggleButton>
                            <ToggleButton value={true}>Mark as paid (offline)</ToggleButton>
                        </ToggleButtonGroup>
                        <Typography variant="caption" color="text.secondary">
                            {markAsPaid
                                ? 'Records the booking as already settled offline — use this only when the patient has actually paid.'
                                : 'The booking is created unpaid; the patient completes payment from their own app.'}
                        </Typography>
                    </Stack>
                </Box>
            )}
        </Paper>
    );
}

export default function PatientBookingBox() {
    // A support-staff caregiver opening "Book & Appointments" is there to see
    // the patient's existing appointments first (their reason for being here),
    // not to land mid-booking-flow — so they default to Existing bookings. An
    // admin in Operations and a guardian keep the booking-first landing.
    const { basePath, scopeKind } = usePatientScope();
    const landing = scopeKind === 'staff' ? 'my-appointments' : 'book-by-type';
    return (
        <>
            <Alert severity="info" sx={{ mb: 2 }}>
                You're booking <b>on this patient's behalf</b> — these are their own
                booking screens, and the prices, credits and member discounts shown
                are theirs, not yours.
            </Alert>
            <BoxChrome />
            <Suspense fallback={<Loading />}>
                {/* Paths are relative to the member-detail route's splat, which
                    is exactly what `basePath` points at. */}
                <Routes>
                    {/* Consultations */}
                    <Route path="book-by-type" element={<ConsultationTypeLanding />} />
                    <Route path="book-by-type/:consultationType" element={<DoctorMatchPage />} />
                    <Route path="book/:doctorId" element={<ChooseConsultationType />} />
                    <Route path="book/:doctorId/:consultationType" element={<BookAppointment />} />
                    <Route path="find-doctors" element={<FindDoctors />} />
                    <Route path="doctor/:doctorId" element={<DoctorProfile />} />

                    {/* Services / products, and group health plans */}
                    <Route path="marketplace" element={<BrowseMarketplace />} />
                    <Route path="health-plans" element={<HealthPlans />} />

                    {/* What they already have, and what they've paid */}
                    <Route path="my-appointments" element={<MyAppointments />} />
                    <Route path="spending" element={<PatientSpending />} />

                    {/* Landing on the tab itself starts the consultation flow.
                        Absolute, not relative: relative resolution inside a
                        splat route changes in React Router v7 and this has to
                        mean the same thing either way. */}
                    <Route index element={<Navigate to={`${basePath}/${landing}`} replace />} />
                    {/* Everything else these pages can link to (records hub,
                        video room, services chat) belongs to the patient's own
                        app, not here. */}
                    <Route path="*" element={<OutsideTheBox />} />
                </Routes>
            </Suspense>
        </>
    );
}
