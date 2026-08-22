/**
 * BranchMyLink — the branch's "My Link", mirroring the clinic's MyLinkPage so a
 * branch is managed with the same surface as its parent, not a stripped-down
 * "Manage Doctors" only.
 *
 * Three tabs, two scoping models on purpose:
 *   • Affiliations — the BRANCH's own doctor roster (add-by-affiliation: invite /
 *     accept / cancel). ``ManageDoctors`` reads the FacilityScope this layout
 *     provides and routes every call through ``/api/v1/clinic/branches/<id>/act/…``,
 *     so it lists and edits the branch's doctors, not the parent's.
 *   • Support Staff / Roles — the MAIN CLINIC's, shared across every branch
 *     (branches have no login of their own and are run centrally). These
 *     sections use the clinic's own-session endpoints and ignore the facility
 *     scope, so they show exactly what the clinic's own My Link shows. Per-branch
 *     access is granted from a staff member's row here (the branch multi-select).
 */
import { Suspense, lazy, useState } from 'react';
import { Alert, Box, CircularProgress, Paper, Tab, Tabs } from '@mui/material';
import HandshakeIcon from '@mui/icons-material/Handshake';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';

const ManageDoctors = lazy(() => import('../../Affiliation/pages/ManageDoctors'));
const SupportStaffSection = lazy(() => import('../../MyLink/components/SupportStaffSection'));
const StaffRolesSection = lazy(() => import('../../MyLink/components/StaffRolesSection'));

const Loader = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
);

export default function BranchMyLink() {
    const [tab, setTab] = useState(0);

    return (
        <Box>
            <Paper sx={{ mb: 2 }}>
                <Tabs value={tab} onChange={(_, v) => setTab(v)}
                    variant="scrollable" scrollButtons="auto">
                    <Tab label="Affiliations" icon={<HandshakeIcon />} iconPosition="start" />
                    <Tab label="Support Staff" icon={<BadgeOutlinedIcon />} iconPosition="start" />
                    <Tab label="Roles" icon={<VerifiedUserOutlinedIcon />} iconPosition="start" />
                </Tabs>
            </Paper>

            <Suspense fallback={<Loader />}>
                {/* The branch's own doctors — scoped by the surrounding
                    FacilityScopeProvider (kind: 'branch'). */}
                {tab === 0 && <ManageDoctors />}

                {/* Clinic-wide, shared across branches. */}
                {tab === 1 && (
                    <Box>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Support staff are managed for your whole clinic and shared across every
                            branch. Grant a staff member access to this branch from the branch
                            selector on their row.
                        </Alert>
                        <SupportStaffSection providerLabel="clinic" showBranches />
                    </Box>
                )}
                {tab === 2 && (
                    <Box>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Roles are defined once for your clinic and apply wherever a staff member
                            is given access — including this branch.
                        </Alert>
                        <StaffRolesSection providerLabel="clinic" />
                    </Box>
                )}
            </Suspense>
        </Box>
    );
}
