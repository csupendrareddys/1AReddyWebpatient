/**
 * StaffRolesPage — the practice's roles, read-only, for a staff member granted
 * ``staff.staff_roles``.
 *
 * Read-only is the whole design, not a limitation waiting to be lifted. A role
 * is the thing that decides what someone may do; letting a staff member edit
 * one lets them edit the one they hold. So this shows exactly what each role
 * grants — useful for a practice manager who has to explain to a new
 * receptionist why a screen isn't there — and nothing more.
 */
import { Box, Typography } from '@mui/material';

import StaffRolesSection from
    '../../../service-provider/MyLink/components/StaffRolesSection';
import useStaffAccess, { verticalLabel } from '../../hooks/useStaffAccess';

export default function StaffRolesPage() {
    const { provider } = useStaffAccess();

    return (
        <Box>
            <Typography variant="h5" sx={{ mb: 0.5 }}>Staff Roles</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                What each role at {provider?.name || 'your practice'} grants
                {provider?.type ? ` · ${verticalLabel(provider.type)}` : ''}
            </Typography>
            <StaffRolesSection
                providerLabel={provider?.type || 'practice'}
                canEdit={false}
            />
        </Box>
    );
}
