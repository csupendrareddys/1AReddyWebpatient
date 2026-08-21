/**
 * StaffDoctorProfilePage — the doctor's Profile & Schedule page, for their
 * assistant.
 *
 * Unlike a facility's Entity Details, this page IS the right one to mount: it
 * is the doctor's profile and the assistant is acting for the doctor, so the
 * doctor-shaped fetches underneath resolve correctly (see
 * ``provider_access.acting_doctor``).
 *
 * What differs is which tabs appear. Each top-tab is its own catalog leaf, and
 * a role granting Working Hours doesn't grant Bank Details — so the tab list is
 * filtered by grant rather than shown whole with most of it 403ing on open.
 */
import { Box, Typography } from '@mui/material';

import ProfileSetting from
    '../../../service-provider/ProfileSetting/pages/ProfileSetting/ProfileSetting';
import useStaffAccess from '../../hooks/useStaffAccess';

// Top-tab index → the catalog leaf that opens it. Index order is the one
// ProfileSetting declares; see the ``labels`` array there.
const TAB_MODULES = {
    0: [
        'profile.profile_details.personal_professional',
        'profile.profile_details.signatures_pricing',
        'profile.profile_details.about_me',
        'profile.profile_details.education',
        'profile.profile_details.bank_details',
        'profile.profile_details.declaration_documents',
    ],
    1: ['profile.account_status'],
    2: ['profile.slot_visibility'],
    3: ['profile.working_hours'],
    4: ['profile.consultation_pricing'],
    5: ['profile.analytics'],
    6: ['profile.attendance'],
    7: ['profile.treatable_symptoms'],
};

export default function StaffDoctorProfilePage() {
    const { provider, can } = useStaffAccess();

    const allowTab = (index) => (TAB_MODULES[index] || [])
        .some((leaf) => can(leaf, 'can_view'));

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ px: 3, pt: 2 }}>
                Acting for {provider?.name || 'the practice'}
            </Typography>
            <ProfileSetting allowTab={allowTab} />
        </Box>
    );
}
