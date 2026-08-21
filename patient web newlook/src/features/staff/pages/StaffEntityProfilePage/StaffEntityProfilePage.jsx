/**
 * StaffEntityProfilePage — the practice's Entity Details, for a staff member
 * granted a leaf under ``entity_profile.entity_details``.
 *
 * The practice reaches these fields through its Settings page, which is the
 * doctor profile page with an extra tab bolted on — it fetches a doctor id, a
 * doctor's analytics config, and a doctor's education. Mounting that for a
 * receptionist would ask the server for a doctor who doesn't exist. What the
 * grant is actually about is the entity record, so that section is mounted
 * directly, standalone (it renders its own Save when there is no sticky footer
 * to drive it).
 *
 * Read-only when the roles carry view but not edit: the endpoint refuses the
 * PUT either way, and a Save button that always fails is worse than none.
 */
import { Alert, Box, Typography } from '@mui/material';

import EntityDetailsSection from
    '../../../service-provider/EntityProfile/sections/EntityDetailsSection';
import useStaffAccess, { verticalLabel } from '../../hooks/useStaffAccess';

// The four tabs of Entity Details are one record behind one endpoint, so any
// of them opens the screen — matching how the server decides.
const DETAIL_LEAVES = [
    'entity_profile.entity_details.entity_type_name',
    'entity_profile.entity_details.registration_licence',
    'entity_profile.entity_details.tax_identifiers',
    'entity_profile.entity_details.promoters',
];

export default function StaffEntityProfilePage() {
    const { provider, can } = useStaffAccess();
    const canEdit = DETAIL_LEAVES.some((leaf) => can(leaf, 'can_edit'));

    return (
        <Box>
            <Typography variant="h5" sx={{ mb: 0.5 }}>Entity Details</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {provider?.name || 'Your practice'}
                {provider?.type ? ` · ${verticalLabel(provider.type)}` : ''}
            </Typography>

            {!canEdit && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    You can read these details. Changing them needs an edit grant
                    on Entity Details — ask {provider?.name || 'your practice'}.
                </Alert>
            )}

            {/* ``registerSave`` withheld deliberately when read-only: that is
                the prop that makes the section render its own Save button. */}
            {canEdit ? <EntityDetailsSection /> : (
                <Box sx={{ pointerEvents: 'none', opacity: 0.85 }}>
                    <EntityDetailsSection registerSave={() => {}} />
                </Box>
            )}
        </Box>
    );
}
