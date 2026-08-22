/**
 * BranchScopeLayout — a clinic operating one of its login-less BRANCHES as a
 * full mini-dashboard.
 *
 * Everything inside runs under a FacilityScopeProvider bound to
 * ``{ id: branchId, vertical: 'clinic', kind: 'branch' }``, so the reused clinic
 * screens re-point every request at ``/api/v1/clinic/branches/<id>/act/...`` (see
 * facilityScope.js). The backend enforces parentage and, for a support-staff
 * caller, the per-branch grant + their role's module. Tabs mirror the clinic
 * dashboard: Profile (Entity details), Manage Doctors (the branch's roster),
 * and a Bills placeholder — same as the main clinic.
 */
import { Suspense, lazy } from 'react';
import {
    useParams, useNavigate, useLocation, Routes, Route, Navigate,
} from 'react-router-dom';
import {
    Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
    Stack, Tab, Tabs, Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ApartmentIcon from '@mui/icons-material/Apartment';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';

import { FacilityScopeProvider } from '../../EntityProfile/context/FacilityScopeContext';
import { useGetClinicBranchesQuery } from '../api/clinicBranchEndpoints';

const FacilityOpsBox = lazy(() => import(
    '../../../admin/Operations/components/FacilityOpsBox/FacilityOpsBox'));
const BranchMyLink = lazy(() => import('./BranchMyLink'));

const SECTIONS = [
    { key: 'profile', label: 'Profile' },
    { key: 'mylink', label: 'My Link' },
    { key: 'bills', label: 'Bills' },
];

const VERIF = {
    verified: { label: 'Verified', color: 'success' },
    pending: { label: 'Pending verification', color: 'warning' },
    rejected: { label: 'Rejected', color: 'error' },
    suspended: { label: 'Suspended', color: 'default' },
};

function BillsPlaceholder() {
    return (
        <Card variant="outlined" sx={{ maxWidth: 640, mx: 'auto', mt: 3 }}>
            <CardContent sx={{ textAlign: 'center', py: 5 }}>
                <ReceiptLongIcon color="disabled" sx={{ fontSize: 44, mb: 1 }} />
                <Typography variant="h6" gutterBottom>Bills &amp; Revenue</Typography>
                <Typography variant="body2" color="text.secondary">
                    This branch's platform-fee deductions and payouts will appear here —
                    same as the main clinic.
                </Typography>
            </CardContent>
        </Card>
    );
}

export default function BranchScopeLayout() {
    const { branchId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const base = `/dashboard/clinic/branches/${branchId}`;

    const { data: branches = [] } = useGetClinicBranchesQuery();
    const who = branches.find((b) => b.id === branchId);
    const v = who && (VERIF[who.verification_status] || VERIF.pending);

    const activeKey = SECTIONS.find((s) => location.pathname.includes(`/${s.key}`))?.key
        || 'profile';

    return (
        <FacilityScopeProvider facilityId={branchId} vertical="clinic" kind="branch">
            <Box sx={{ p: { xs: 1.5, md: 2 } }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                    <Button size="small" startIcon={<ArrowBackIcon />}
                        onClick={() => navigate('/dashboard/clinic/branches')}>
                        Branches
                    </Button>
                    <ApartmentIcon color="primary" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={700}>
                        Managing {who?.name || 'a branch'}
                    </Typography>
                    {v && <Chip size="small" label={v.label} color={v.color} variant="outlined" />}
                </Stack>

                <Tabs value={activeKey} onChange={(e, val) => navigate(`${base}/${val}`)}
                    variant="scrollable" scrollButtons="auto" sx={{ mb: 1 }}>
                    {SECTIONS.map((s) => <Tab key={s.key} value={s.key} label={s.label} />)}
                </Tabs>
                <Divider sx={{ mb: 2 }} />

                <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}>
                    <Routes>
                        <Route path="profile" element={<FacilityOpsBox vertical="clinic" />} />
                        <Route path="mylink" element={<BranchMyLink />} />
                        {/* Old direct-doctors link → the affiliations tab inside My Link. */}
                        <Route path="doctors" element={<Navigate to={`${base}/mylink`} replace />} />
                        <Route path="bills" element={<BillsPlaceholder />} />
                        <Route path="*" element={<Navigate to="profile" replace />} />
                    </Routes>
                </Suspense>
            </Box>
        </FacilityScopeProvider>
    );
}
