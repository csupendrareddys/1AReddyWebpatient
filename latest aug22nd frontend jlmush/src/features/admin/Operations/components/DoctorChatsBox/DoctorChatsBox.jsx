/**
 * DoctorChatsBox — the doctor's own "Service Chats" page, mounted inside the
 * admin Operations detail page and pointed at one specific doctor.
 *
 * The conversations attached to communication-enabled services this doctor
 * delivers: the thread, the scheduled calls, the files shared in it. Support
 * is regularly asked to settle "what did they actually agree?", and until now
 * the only way to answer was to ask the doctor to read it out.
 *
 * Reads AND writes: the viewer can reply, schedule or cancel a call, and share
 * a file, all on the doctor's behalf. What they post stays on the doctor's
 * side of the thread, but the message is stamped with whoever really typed it
 * and renders with a marker naming them, to the patient AND the doctor — the
 * audit log is no longer the only trace.
 *
 * Mounted by two surfaces now, which is why the banner below names the author
 * kind from the payload rather than asserting one: Operations stamps
 * "Admin staff", and a clinic running an employed doctor from My Link
 * (``LinkOperationDialog``) stamps "Employer". Wording that named only the
 * first would have been quietly wrong on the second.
 *
 * The exception is JOINING a live call. That admits someone to an A/V room
 * with a patient, which is presence rather than paperwork — the same line the
 * appointment box draws around joining a consultation. ``ScheduledCallsPanel``
 * hides the button and the proxy allowlist refuses ``calls/<id>/join``, so it
 * would fail even if the button were shown.
 *
 * ``MyServiceChannels`` is the same component the patient's own
 * ``/my-services`` page uses — it is role-agnostic and reads "which side am I"
 * off each channel, so it needs nothing said to it here beyond the scope.
 */
import { lazy, Suspense } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';

const MyServiceChannels = lazy(() => import(
    '../../../../communication/pages/MyServiceChannels'));

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

export default function DoctorChatsBox() {
    return (
        <>
            <Alert severity="warning" sx={{ mb: 2 }}>
                You&apos;re acting <b>on this doctor&apos;s behalf</b> — a reply you
                send here lands on the doctor&apos;s side of the thread, tagged with
                who you are and your name, visible to the patient and the doctor.
                Joining a live call stays with the doctor.
            </Alert>
            <Suspense fallback={<Loading />}>
                <MyServiceChannels />
            </Suspense>
        </>
    );
}
