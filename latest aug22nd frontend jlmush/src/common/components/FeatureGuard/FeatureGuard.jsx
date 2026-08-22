/**
 * FeatureGuard — wraps a route element and renders a friendly
 * "upgrade required" panel when the tenant's resolved subscription
 * plan + add-ons don't include ``featurePath``.
 *
 * Why a guard at the route level (not just at the sidebar):
 *   * Sidebar gates only hide the menu link — typing the URL
 *     directly still mounts the page.
 *   * Mounted pages fire RTK Query calls that return 403
 *     ``feature_disabled`` from ``@feature_required`` on the
 *     backend. With no error handling, the page hangs on a
 *     spinner forever.
 *   * Wrapping the route makes the page never even mount when the
 *     plan doesn't cover it. Network calls don't fire, no spinner,
 *     user gets a clear message.
 *
 * PLATFORM_OWNER and the platform-default tenant always pass — they
 * don't have plans (PO administers plans; default tenant is the
 * platform's own context). Missing ``feature_paths`` data fails open
 * (deploy-hop tolerance) — the BACKEND ``@feature_required`` is the
 * actual security boundary, this is UX gating.
 *
 * Usage::
 *
 *   <Route path="page-controls" element={
 *     <FeatureGuard featurePath="admin.page_configuration">
 *       <PageControls />
 *     </FeatureGuard>
 *   } />
 */
import { Box, Container, Typography, Alert, Button } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useNavigate } from 'react-router-dom';

import usePermissions from '../../hooks/usePermissions';

const HUMAN_LABELS = {
    'admin.landing_builder': 'Landing-page builder',
    'admin.page_configuration': 'Login / signup page editor',
    'admin.field_approval': 'Field-approval workflow',
    'admin.audit_logs': 'Audit log viewer',
    'admin.billing_config': 'Billing configuration',
    'admin.manage_users': 'Admin / sub-admin management',
    'patient.basic_info': 'Patient profile basics',
    'patient.vitals': 'Patient vitals tracking',
    'patient.documents': 'Patient document storage',
    'patient.family': 'Family / household groups',
    'patient.intake_forms': 'Intake forms',
    'patient.health_records': 'Health records',
    'doctor.profile': 'Doctor profile management',
    'doctor.calendar': 'Doctor scheduling / calendar',
    'doctor.pricing': 'Doctor pricing controls',
    'doctor.prescriptions': 'Prescription writing',
    'doctor.prescriptions_pdf': 'Prescription PDF templates',
    'doctor.follow_up': 'Follow-up scheduling',
    'doctor.attendance': 'Attendance tracking',
    'doctor.analytics': 'Doctor analytics',
    // Organization (legacy clinic.*) — same labels under either prefix.
    'organization.marketplace': 'Marketplace listings',
    'organization.multi_location': 'Multi-location support',
    'organization.feedback': 'Patient feedback / ratings',
    'organization.doctor_payouts': 'Doctor payouts',
    'clinic.marketplace': 'Marketplace listings',
    'clinic.multi_location': 'Multi-location support',
    'clinic.feedback': 'Patient feedback / ratings',
    'clinic.doctor_payouts': 'Doctor payouts',
    // Marketplace participation packs.
    'marketplace.doctor.listing': 'Doctor marketplace listing',
    'marketplace.clinic.listing': 'Clinic marketplace listing',
    'marketplace.hospital.listing': 'Hospital marketplace listing',
    'marketplace.priority_placement': 'Priority placement in search',
    'marketplace.white_label_profile': 'White-label provider profile',
    'marketplace.continuous_care_timeline': 'Continuous-care timeline',
    'marketplace.network_referrals': 'In-network referrals',
    'marketplace.ai_clinical_summaries': 'AI clinical summaries',
    'marketplace.lab_integration': 'Lab integration',
    'marketplace.pharmacy_integration': 'Pharmacy integration',
    'marketplace.multi_branch': 'Multi-branch support',
    'marketplace.cross_branch_continuous_care': 'Cross-branch continuous care',
    'marketplace.api_ecosystem': 'API ecosystem access',
};

const _label = (path) => HUMAN_LABELS[path] || path;

const FeatureGuard = ({ featurePath, children, fallbackPath = '/dashboard/admin' }) => {
    const navigate = useNavigate();
    const { hasFeature } = usePermissions();

    if (hasFeature(featurePath)) return children;

    return (
        <Container maxWidth="sm" sx={{ py: 6 }}>
            <Alert
                severity="info"
                icon={<LockIcon />}
                sx={{ mb: 3, p: 3 }}
            >
                <Typography variant="h6" fontWeight={600} gutterBottom>
                    {_label(featurePath)} isn't included on your plan
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Your tenant's subscription doesn't include this feature.
                    Ask your platform administrator to upgrade your plan or
                    attach an add-on that includes
                    <code style={{ marginLeft: 6, marginRight: 6 }}>
                        {featurePath}
                    </code>
                    .
                </Typography>
            </Alert>
            <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant="contained" onClick={() => navigate(fallbackPath)}>
                    Return to Dashboard
                </Button>
                <Button onClick={() => navigate(-1)}>Go Back</Button>
            </Box>
        </Container>
    );
};

export default FeatureGuard;
