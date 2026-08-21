/**
 * StaffTeamPage — the practice's staff directory, seen by one of its own staff.
 *
 * The same ``SupportStaffSection`` the practice sees on My Link, with access
 * management taken out: a staff member here can keep the list of who works
 * here current, but cannot mint a login or assign a role. Those two are the
 * only ways to widen what an account can do, so they stay with the practice —
 * otherwise "can edit the staff directory" would silently be a grant of every
 * other permission, via the colleague whose password you reset or the role you
 * hand yourself.
 *
 * The backend refuses those writes for a staff caller whatever the UI does
 * (``app/api/provider_staff/routes.py``); hiding the fields is so the form
 * doesn't offer something that will be rejected.
 */
import { Box, Typography } from '@mui/material';

import SupportStaffSection from
    '../../../service-provider/MyLink/components/SupportStaffSection';
import useStaffAccess, { verticalLabel } from '../../hooks/useStaffAccess';

export default function StaffTeamPage() {
    const { provider } = useStaffAccess();

    return (
        <Box>
            <Typography variant="h5" sx={{ mb: 0.5 }}>Staff Directory</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Everyone who works at {provider?.name || 'your practice'}
                {provider?.type ? ` · ${verticalLabel(provider.type)}` : ''}
            </Typography>
            <SupportStaffSection
                providerLabel={provider?.type || 'practice'}
                canManageAccess={false}
            />
        </Box>
    );
}
