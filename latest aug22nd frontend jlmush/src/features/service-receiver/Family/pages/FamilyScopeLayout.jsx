/**
 * FamilyScopeLayout — the patient "switched into" another account in their
 * family: either one of their own MINORS (full access) or a linked ADULT who
 * granted them a role (role-bounded). Both ride the same plumbing.
 *
 * Everything inside runs under a PatientScopeProvider bound to
 * ``family:<memberId>``, so the reused patient screens re-point every request
 * at ``/api/v1/patient/family/<memberId>/act/...``. The backend proxy decides
 * minor-vs-linked and enforces the role gate — this shell only picks the right
 * label + tabs. For a MINOR the guardian gets a FULL replica: booking, the
 * whole Profile Settings (minus its Family Group tab — a minor has no family of
 * their own), Prescriptions/Documents, and Service Chats. A write a linked
 * adult's role doesn't grant is refused server-side (403).
 */
import { Suspense, lazy } from 'react';
import {
    useParams, useNavigate, useLocation, Routes, Route, Navigate,
} from 'react-router-dom';
import {
    Alert, Box, Button, Chip, CircularProgress, Divider, Link, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChildCareIcon from '@mui/icons-material/ChildCare';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';

import { PatientScopeProvider } from '../../ProfileSetting/context/PatientScopeContext';
import { useGetFamilyScopesQuery } from '../api/familyEndpoints';
import { useGetMyFamilyDoctorQuery } from '../../../family-doctor/api/familyDoctorEndpoints';
import useResilientQuery from '../../../../common/hooks/useResilientQuery';

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

/**
 * A minor's "second opinion doctor" is inherited from the guardian's own family
 * doctor — the minor's bookings sit under the guardian's account, so that doctor
 * already earns second-opinion credits on them. This is a read-only surface of
 * that coverage on the minor's view (there's nothing to assign per minor).
 */
function InheritedSecondOpinion({ minorName, onManage }) {
    // Routed through useResilientQuery: the family-doctor query is one of the
    // hooks that can wedge in isLoading under React-18 StrictMode (the query
    // 200s but the subscription never delivers), which would hide this card. The
    // resilient wrapper primes the data from an imperative refetch. ``data`` is
    // undefined until it resolves, then either the doctor object or null.
    const { data: familyDoctor } = useResilientQuery(useGetMyFamilyDoctorQuery, undefined);
    if (familyDoctor === undefined) return null;
    const who = minorName || 'this child';
    if (familyDoctor?.doctor_name) {
        return (
            <Alert severity="info" icon={<MedicalServicesIcon fontSize="inherit" />}
                sx={{ mb: 1.5, py: 0.25, alignItems: 'center' }}>
                Second opinion doctor: <strong>Dr {familyDoctor.doctor_name}</strong> — {who} is
                covered by your family doctor, who earns credits on their completed bookings.
            </Alert>
        );
    }
    return (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            No second-opinion doctor yet.{' '}
            <Link component="button" type="button" onClick={onManage} underline="hover">
                Add a family doctor
            </Link>{' '}to cover {who}.
        </Typography>
    );
}

export default function FamilyScopeLayout() {
    const { memberId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const base = `/dashboard/patient/family/${memberId}`;

    // Label the scope from the switcher payload (cached; no extra round-trip in
    // practice). Falls back to a neutral header if it hasn't loaded yet.
    const { data: scopes } = useGetFamilyScopesQuery();
    const minor = (scopes?.minors || []).find((m) => m.member_id === memberId);
    const linked = (scopes?.linked || []).find((m) => m.member_id === memberId);
    const isMinor = !!minor;
    const who = minor || linked;

    const activeKey = SECTIONS.find((s) => location.pathname.includes(`/${s.key}`))?.key
        || 'bookings';

    return (
        <PatientScopeProvider familyMemberId={memberId} basePath={`${base}/bookings`}>
            <Box sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                    <Button size="small" startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/dashboard/patient/family')}>
                        My account
                    </Button>
                    {isMinor
                        ? <ChildCareIcon color="primary" fontSize="small" />
                        : <SupervisorAccountIcon color="primary" fontSize="small" />}
                    <Typography variant="subtitle1" fontWeight={700}>
                        {isMinor
                            ? `Managing ${who?.name || 'a minor profile'}`
                            : `Acting for ${who?.name || 'a family member'}`}
                    </Typography>
                    {!isMinor && linked?.role && (
                        <Chip size="small" label={linked.role} color="primary" variant="outlined" />
                    )}
                </Stack>

                {isMinor && (
                    <InheritedSecondOpinion
                        minorName={who?.name}
                        onManage={() => navigate('/dashboard/patient/family-doctor')}
                    />
                )}

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
