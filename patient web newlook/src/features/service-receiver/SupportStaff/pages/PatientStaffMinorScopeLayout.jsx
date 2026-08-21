/**
 * PatientStaffMinorScopeLayout — a CAREGIVER acting on a MINOR they were granted
 * (via ``PatientStaffMinorScope``).
 *
 * Same 4-tab replica as ``PatientStaffScopeLayout`` / ``FamilyScopeLayout``, but
 * bound to ``staff-family:<memberId>`` so every reused patient screen re-points
 * its requests at ``/api/patient-staff/act-minor/<memberId>/...``. The backend
 * enforces the per-minor grant + role (a non-granted minor or action is 403);
 * this shell only labels the scope and offers the tabs. Payment stays with the
 * parent — a caregiver never charges (see PatientScopeContext / usePatientCheckout).
 */
import { Suspense, lazy } from 'react';
import {
    useParams, useNavigate, useLocation, Routes, Route, Navigate,
} from 'react-router-dom';
import {
    Box, Button, Chip, CircularProgress, Divider, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChildCareIcon from '@mui/icons-material/ChildCare';

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

export default function PatientStaffMinorScopeLayout() {
    const { memberId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const base = `/dashboard/patient-staff/minor/${memberId}`;

    // Label the minor from the caregiver's own /me — granted minors are nested
    // under each supported patient.
    const { data: meData = {} } = useGetPatientStaffMeQuery();
    const minor = (meData.patients || [])
        .flatMap((p) => p.minors || [])
        .find((m) => m.member_id === memberId);

    const activeKey = SECTIONS.find((s) => location.pathname.includes(`/${s.key}`))?.key
        || 'bookings';

    return (
        <PatientScopeProvider staffFamilyMemberId={memberId} basePath={`${base}/bookings`}>
            <Box sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                    <Button size="small" startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/dashboard/patient-staff')}>
                        Patients
                    </Button>
                    <ChildCareIcon color="secondary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Caring for {minor?.name || 'a child'}
                    </Typography>
                    {minor && (
                        <Chip size="small"
                            label={minor.whole ? 'Whole account' : 'Limited access'}
                            color="secondary" variant="outlined" />
                    )}
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
