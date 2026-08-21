/**
 * DoctorOpsBox — the doctor's own "My Appointments / Service List" page,
 * mounted inside the admin Operations detail page and pointed at one specific
 * doctor.
 *
 * Same bargain as the doctor Profile tab next door, and as the patient's
 * booking box: rather than a second set of admin-only appointment tables that
 * drift from the real ones, this renders the actual doctor pages. The scope
 * provider re-points every request at the act-on-behalf proxy
 * (``service-provider/api/doctorScope``), so what an operator sees and changes
 * here is exactly what the doctor sees and changes.
 *
 * All three of that page's buckets, not just the first: consultations
 * (Appointments), incoming service orders (Service List) and paid plan
 * bookings on teams the doctor leads (My Group Offering). Support fields "the
 * patient paid and nobody has responded" for all three, and the two order
 * buckets were the half an operator previously had to ask the doctor to check.
 * Its management counterpart — the catalog and availability behind those
 * orders — is {@link DoctorManageBox} on the tab beside this one.
 *
 * What it deliberately does NOT carry: joining a consultation and writing a
 * prescription. Both are the doctor personally showing up, not support acting
 * for them — ``AppointmentsPage`` hides those controls when the scope is an
 * ops one, and the backend allowlist doesn't proxy the endpoints behind them
 * either, so neither side depends on the other for the guarantee.
 *
 * Routing mirrors PatientBookingBox: real nested routes under the
 * member-detail splat (React Router forbids a Router inside a Router, so a
 * MemoryRouter isn't an option). This subtree is mounted at
 * ``<basePath>/appointments``, which is the same shape the doctor's own app
 * uses — so ``PatientContextPanel`` builds one URL from
 * {@link useDoctorScope}'s ``basePath`` and it resolves in both.
 */
import { lazy, Suspense } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Alert, Button } from '@mui/material';

import { useDoctorScope } from
    '../../../../service-provider/ProfileSetting/context/DoctorScopeContext';

const AppointmentsServiceList = lazy(() => import(
    '../../../../service-provider/Appointments/pages/AppointmentsServiceList/AppointmentsServiceList'));
const PatientContextPage = lazy(() => import(
    '../../../../service-provider/Appointments/pages/PatientContextPage/PatientContextPage'));

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

/**
 * A destination this subtree doesn't carry — the prescription writer, the
 * video room, the doctor's marketplace. Says so rather than bouncing silently,
 * because a button that appears to do nothing reads as a bug.
 */
function OutsideTheBox() {
    const navigate = useNavigate();
    const { basePath } = useDoctorScope();
    const { pathname } = useLocation();
    return (
        <Box sx={{ p: 3 }}>
            <Alert
                severity="info"
                action={
                    <Button size="small" color="inherit"
                        onClick={() => navigate(`${basePath}/appointments`)}>
                        Back to appointments
                    </Button>
                }
            >
                <b>{pathname.replace(basePath, '') || '/'}</b> is part of the doctor's
                own app and isn't available from Operations — this view covers their
                appointments, service orders and group offerings.
            </Alert>
        </Box>
    );
}

export default function DoctorOpsBox() {
    return (
        <>
            <Alert severity="info" sx={{ mb: 2 }}>
                You're acting <b>on this doctor's behalf</b> — these are their own
                appointment, service-order and group-offering screens, and accepting
                or rejecting a request here is recorded as the doctor's decision.
                Joining a consultation and writing a prescription stay with the
                doctor.
            </Alert>
            <Suspense fallback={<Loading />}>
                {/* Relative to ``<basePath>/appointments``, where the parent
                    route mounts this box. */}
                <Routes>
                    <Route index element={<AppointmentsServiceList embedded />} />
                    <Route path=":appointmentId/patient-context"
                        element={<PatientContextPage />} />
                    <Route path="*" element={<OutsideTheBox />} />
                </Routes>
            </Suspense>
        </>
    );
}
