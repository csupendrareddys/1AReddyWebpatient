/**
 * SupportStaffSection — the provider's own staff, on My Link.
 *
 * Why here. My Link already models professional affiliations, classified as
 * Partner / Associate / **Employee**. But every one of those connections is
 * between two accounts that already exist on the platform — a doctor linking
 * to a clinic. A receptionist has no account, so there was no way to record
 * them at all, and "Employee" quietly meant "employee who happens to be a
 * registered practitioner".
 *
 * This is the other half: the employees who aren't platform users. Same page,
 * because from the provider's side it's the same question — who works with me,
 * and in what capacity — and splitting it across two pages would mean learning
 * that a colleague's platform account decides which screen they live on.
 *
 * Roles come from the tenant admin's curated list per vertical (Operations →
 * Manage Roles & Permissions). A provider assigns one; they don't author it.
 */
import { useState } from 'react';
import {
    Alert, Box, Paper, Snackbar, Typography,
} from '@mui/material';

import ProviderStaffPanel from
    '../../../admin/Operations/permissions/components/ProviderStaffPanel/ProviderStaffPanel';
import useProviderCan from '../../../staff/hooks/useProviderCan';
import { useGetMyPlanLimitsQuery } from '../../Membership/api/myMembershipEndpoints';
import { limitCount } from '../../../../utils/planLimits';
import {
    useGetMyStaffQuery,
    useGetMyStaffRolesQuery,
    useCreateMyStaffMutation,
    useUpdateMyStaffMutation,
    useDeleteMyStaffMutation,
    useSetMyStaffRolesMutation,
    useSetMyStaffBranchesMutation,
} from '../api/providerStaffEndpoints';
import { useGetClinicBranchesQuery } from '../../Branches/api/clinicBranchEndpoints';

const M_DIRECTORY = 'staff.staff_directory';

export default function SupportStaffSection({
    providerLabel = 'practice', canManageAccess = true, showBranches = false,
}) {
    const { data: staff = [], isLoading, error } = useGetMyStaffQuery({ per_page: 100 });
    const { data: roles = [] } = useGetMyStaffRolesQuery();
    // Branch clinics (clinic providers only) — the granular "which branches" a
    // staff member may act on. Skipped for doctor/hospital, who have none.
    const { data: branches = [] } = useGetClinicBranchesQuery(undefined, { skip: !showBranches });
    const [setBranches] = useSetMyStaffBranchesMutation();

    // A staff member reading their own practice's directory gets only what
    // their role grants; the practice itself gets everything.
    const { can } = useProviderCan();

    const [createStaff, { isLoading: creating }] = useCreateMyStaffMutation();
    const [updateStaff, { isLoading: updating }] = useUpdateMyStaffMutation();
    const [deleteStaff] = useDeleteMyStaffMutation();
    const [setRoles] = useSetMyStaffRolesMutation();

    const [snack, setSnack] = useState(null);

    // How many seats the practice's membership tier includes. A 404 means the
    // caller has no provider profile at all — the same case the 403 branch
    // below already covers — so an absent snapshot reads as "no cap", which is
    // also what a practice with no subscription gets.
    const { data: planLimits } = useGetMyPlanLimitsQuery();
    const seats = planLimits?.support_staff || null;
    const atSeatLimit = !!seats?.at_limit;

    // The endpoints are gated to doctor / clinic / hospital. Anyone else
    // reaching this section is a routing mistake rather than a server problem,
    // so say what happened instead of rendering an empty roster.
    if (error?.status === 403) {
        return (
            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" gutterBottom>Support Staff</Typography>
                <Alert severity="info">
                    Only doctors, clinics and hospitals can have support staff.
                </Alert>
            </Paper>
        );
    }

    const remove = async (member) => {
        try {
            await deleteStaff(member.id).unwrap();
            setSnack({ severity: 'success', message: `${member.full_name} removed` });
        } catch (err) {
            setSnack({
                severity: 'error',
                message: err?.data?.message || 'Could not remove this staff member',
            });
        }
    };

    return (
        <Box>
            {/* Shown only once a tier actually caps this. On an uncapped
                practice a meter reading "3 / ∞" is a number nobody needs. */}
            {seats && !seats.unlimited && (
                <Alert
                    severity={atSeatLimit ? 'warning' : 'info'}
                    sx={{ mb: 2 }}
                >
                    <b>{limitCount(seats.used, seats.limit)}</b> staff seats used
                    {planLimits?.plan?.name ? ` on the ${planLimits.plan.name} plan` : ''}.
                    {atSeatLimit
                        ? ' Upgrade your membership to add more — nobody already here is'
                          + ' affected.'
                        : ` You can add ${seats.remaining} more.`}
                </Alert>
            )}
            <ProviderStaffPanel
                providerLabel={providerLabel}
                // Truthy so the panel renders its full-CRUD form. The server
                // resolves the actual provider from the session — this side
                // never names one, which is what stops it being spoofable.
                providerId="self"
                canManageAccess={canManageAccess}
                // Two different reasons the form can be closed, and they read
                // the same here on purpose: the server refuses either way, and
                // the banner above says which one it is. Only *adding* is
                // capped — editing and removing stay open, or an over-limit
                // practice could not get back under its cap.
                canCreate={can(M_DIRECTORY, 'can_create') && !atSeatLimit}
                canEdit={can(M_DIRECTORY, 'can_edit')}
                canDelete={can(M_DIRECTORY, 'can_delete')}
                staff={staff}
                roles={roles}
                isLoading={isLoading}
                busy={creating || updating}
                onCreate={async (form) => {
                    await createStaff(form).unwrap();
                    setSnack({ severity: 'success', message: 'Staff member added' });
                }}
                onUpdate={(member, form) => updateStaff({ staffId: member.id, ...form }).unwrap()}
                onSetRoles={(member, roleIds) => setRoles({ staffId: member.id, roleIds }).unwrap()}
                onDelete={remove}
                // Per-branch access — only surfaces for a clinic that has branches.
                showBranches={showBranches && branches.length > 0}
                branches={branches}
                onSetBranches={(member, branchIds) => setBranches({ staffId: member.id, branchIds }).unwrap()}
            />
            <Snackbar
                open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snack?.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
                    {snack?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
