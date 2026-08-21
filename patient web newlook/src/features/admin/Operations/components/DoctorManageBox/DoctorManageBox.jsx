/**
 * DoctorManageBox — the doctor's own "Manage Appointments / Services" page,
 * mounted inside the admin Operations detail page and pointed at one specific
 * doctor.
 *
 * Third of the three boxes on that screen, and the same bargain as the Profile
 * tab and {@link DoctorOpsBox} beside it: rather than an admin-only copy of the
 * availability editor, the service catalog and the group-offering builder —
 * three surfaces with real validation that would drift — this renders the
 * actual doctor page. The scope provider re-points every request at the
 * act-on-behalf proxy, so what an operator changes here is exactly what the
 * doctor would have changed.
 *
 * Where "My Appointments / Service List" (DoctorOpsBox) is the *tracking* view
 * — who booked what — this is the *management* one: when the doctor takes
 * appointments, which services they sell, and which groups they lead.
 *
 * Approval. Each of its three sections carries its own review queue: the
 * schedule raises one ApprovalRequest per slot, and a service listing / group
 * offering carries an ``approval_status`` column. All three now behave like the
 * profile's field-approval queue does from here — an admin senior enough to
 * approve has their change applied on submission rather than queued for
 * themselves; a junior one's still waits. The backend owns that decision
 * (``profile_audit.self_approving_admin``); this component doesn't branch on
 * it, and the save messages report whichever actually happened.
 *
 * No nested routes: unlike the booking and appointment boxes this is one page
 * that keeps its section in a ``?view=`` param, so it needs no Routes of its
 * own.
 */
import { lazy, Suspense } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';

const ManageAppointmentsServices = lazy(() => import(
    '../../../../service-provider/Appointments/pages/ManageAppointmentsServices/ManageAppointmentsServices'));

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

export default function DoctorManageBox() {
    return (
        <>
            <Alert severity="info" sx={{ mb: 2 }}>
                You&apos;re acting <b>on this doctor&apos;s behalf</b> — this is their own
                availability, service catalog and group offerings, and a change saved
                here is recorded as theirs. Co-doctors still have to accept a group
                invitation themselves.
            </Alert>
            <Suspense fallback={<Loading />}>
                <ManageAppointmentsServices embedded />
            </Suspense>
        </>
    );
}
