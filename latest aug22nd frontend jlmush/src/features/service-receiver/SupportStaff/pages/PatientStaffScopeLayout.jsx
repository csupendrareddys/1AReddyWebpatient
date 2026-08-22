/**
 * PatientStaffScopeLayout — a CAREGIVER (support staff) acting on the patient
 * who employs them.
 *
 * Everything inside runs under a PatientScopeProvider bound to
 * ``staff:<patientId>``, so the reused patient screens re-point every request at
 * ``/api/v1/patient-staff/act/<patientId>/...``. The backend enforces the role gate
 * (a non-granted action is refused 403); this shell only labels the scope and
 * offers the tabs — the same replica the family scope uses.
 */
import { Suspense, lazy } from 'react';
import {
    useParams, useNavigate, useLocation, Routes, Route, Navigate,
} from 'react-router-dom';
import {
    Box, Button, Chip, CircularProgress, Divider, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';

import { PatientScopeProvider } from '../../ProfileSetting/context/PatientScopeContext';
import { useGetPatientStaffMeQuery } from '../api/supportStaffEndpoints';

const PatientBookingBox = lazy(() => import(
    '../../../admin/Operations/components/PatientBookingBox/PatientBookingBox'));
const ProfileSetting = lazy(() => import(
    '../../ProfileSetting/pages/ProfileSetting/ProfileSetting'));
const PatientRecords = lazy(() => import(
    '../../pages/PatientRecords/PatientRecords'));
const MyServiceChannels = lazy(() => import(
    '../../../communication/pages/MyServiceChannels'));

const SECTIONS = [
    { key: 'bookings', label: 'Book & Appointments' },
    { key: 'profile', label: 'Profile Settings' },
    { key: 'records', label: 'Prescriptions & Documents' },
    { key: 'chats', label: 'Service Chats' },
];

export default function PatientStaffScopeLayout() {
    const { patientId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const base = `/dashboard/patient-staff/${patientId}`;

    // Label the scope from the caregiver's own /me (cached; no extra round-trip
    // in practice). The chips show which modules their role actually grants.
    const { data: meData = {} } = useGetPatientStaffMeQuery();
    const who = (meData.patients || []).find((p) => p.patient_id === patientId);

    const activeKey = SECTIONS.find((s) => location.pathname.includes(`/${s.key}`))?.key
        || 'bookings';

    return (
        <PatientScopeProvider staffPatientId={patientId} basePath={`${base}/bookings`}>
            <Box sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                    <Button size="small" startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/dashboard/patient-staff')}>
                        Patients
                    </Button>
                    <BadgeOutlinedIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Caring for {who?.patient_name || 'a patient'}
                    </Typography>
                    {(who?.modules || []).map((m) => (
                        <Chip key={m} size="small" label={m.replace(/_/g, ' ')} color="primary" variant="outlined" />
                    ))}
                </Stack>

                <Tabs value={activeKey} onChange={(e, v) => navigate(`${base}/${v}`)}
                    variant="scrollable" scrollButtons="auto" sx={{ mb: 1 }}>
                    {SECTIONS.map((s) => <Tab key={s.key} value={s.key} label={s.label} />)}
                </Tabs>
                <Divider sx={{ mb: 2 }} />

                <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}>
                    <Routes>
                        <Route path="bookings/*" element={<PatientBookingBox />} />
                        <Route path="profile/*" element={<ProfileSetting embedded />} />
                        <Route path="records/*" element={<PatientRecords />} />
                        <Route path="chats/*" element={<MyServiceChannels />} />
                        <Route path="*" element={<Navigate to="bookings" replace />} />
                    </Routes>
                </Suspense>
            </Box>
        </PatientScopeProvider>
    );
}
