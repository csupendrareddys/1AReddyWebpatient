/**
 * DoctorRecordsBox — the doctor's own "Prescriptions / Documents" hub and the
 * form / preview / view pages behind it, mounted inside the admin Operations
 * detail page and pointed at one specific doctor.
 *
 * Same bargain as the tabs beside it: rather than an admin-only rebuild of two
 * seven-state lifecycle tables plus a clinical form with medicine search,
 * banned-drug checks and a template renderer, this renders the actual doctor
 * pages with the scope provider re-pointing every request at the
 * act-on-behalf proxy.
 *
 * These pages WRITE, which makes this the sharpest surface in Operations. A
 * prescription authored here is issued in the doctor's name and the patient
 * has no way to tell an operator wrote it — the ``OperatiosAuditLog`` row the
 * proxy stamps on every non-GET is the only record. That was a deliberate
 * product decision; the banner below says so to whoever is using it.
 *
 * Routing. The doctor addresses these pages as
 * ``/dashboard/doctor/prescriptions/<id>/edit``; here they live under this
 * tab's own ``/records`` segment so the tab stays selected while you're inside
 * one. Both resolve ``<recordsPath>/prescriptions/<id>/edit`` — see
 * {@link useDoctorScope}, which is what each page builds its links from. The
 * bare ``prescriptions`` / ``documents`` routes exist for exactly that reason:
 * a sub-page's "back to the list" targets them on both surfaces.
 */
import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Box, CircularProgress, Alert } from '@mui/material';

const MyRecords = lazy(() => import(
    '../../../../service-provider/Prescriptions/pages/MyRecords'));
const PrescriptionFormPage = lazy(() => import(
    '../../../../service-provider/Prescriptions/pages/PrescriptionFormPage'));
const PrescriptionPreviewPage = lazy(() => import(
    '../../../../service-provider/Prescriptions/pages/PrescriptionPreviewPage'));
const PrescriptionViewPage = lazy(() => import(
    '../../../../service-provider/Prescriptions/pages/PrescriptionViewPage'));
const DocumentFormPage = lazy(() => import(
    '../../../../service-provider/Documents/pages/DocumentFormPage'));
const DocumentPreviewPage = lazy(() => import(
    '../../../../service-provider/Documents/pages/DocumentPreviewPage'));
const DocumentViewPage = lazy(() => import(
    '../../../../service-provider/Documents/pages/DocumentViewPage'));

const Loading = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
    </Box>
);

export default function DoctorRecordsBox() {
    return (
        <>
            <Alert severity="warning" sx={{ mb: 2 }}>
                You&apos;re acting <b>on this doctor&apos;s behalf</b> — a prescription
                or document written, revised or published here is issued in their name,
                and the patient sees no difference. Only the Operations audit log
                records that you, not the doctor, produced it.
            </Alert>
            <Suspense fallback={<Loading />}>
                {/* Relative to ``<basePath>/records``, where the parent route
                    mounts this box — i.e. the scope's ``recordsPath``. */}
                <Routes>
                    <Route index element={<MyRecords embedded />} />
                    <Route path="prescriptions"
                        element={<MyRecords embedded initialView="prescriptions" />} />
                    <Route path="prescriptions/new" element={<PrescriptionFormPage />} />
                    <Route path="prescriptions/:id" element={<PrescriptionViewPage />} />
                    <Route path="prescriptions/:id/edit" element={<PrescriptionFormPage />} />
                    <Route path="prescriptions/:id/preview"
                        element={<PrescriptionPreviewPage />} />
                    <Route path="documents"
                        element={<MyRecords embedded initialView="documents" />} />
                    <Route path="documents/new" element={<DocumentFormPage />} />
                    <Route path="documents/:id" element={<DocumentViewPage />} />
                    <Route path="documents/:id/edit" element={<DocumentFormPage />} />
                    <Route path="documents/:id/preview" element={<DocumentPreviewPage />} />
                </Routes>
            </Suspense>
        </>
    );
}
