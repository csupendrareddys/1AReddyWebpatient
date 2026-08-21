/**
 * StaffPracticePage — the practice's own record, for staff granted something
 * under ``entity_profile``.
 *
 * Two tabs, because the group has two kinds of thing in it and only one is
 * editable. Entity Details is the registration/tax/promoter record. Account
 * Status is the practice's standing on the platform, which nobody edits from
 * here — it is the outcome of admin review, so it is shown and not offered.
 *
 * The group's third leaf, Verification Documents, has no screen — not for
 * staff and not for the practice either; nothing in the app renders it yet.
 * Rather than invent one, it stays marked "No screen yet" on the dashboard.
 */
import { useState } from 'react';
import { useSelector } from 'react-redux';
import {
    Alert, Box, Chip, Paper, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import ApartmentIcon from '@mui/icons-material/Apartment';

import StaffEntityProfilePage from '../StaffEntityProfilePage/StaffEntityProfilePage';
import useStaffAccess, { verticalLabel } from '../../hooks/useStaffAccess';

const M_STATUS = 'entity_profile.account_status';
const DETAIL_LEAVES = [
    'entity_profile.entity_details.entity_type_name',
    'entity_profile.entity_details.registration_licence',
    'entity_profile.entity_details.tax_identifiers',
    'entity_profile.entity_details.promoters',
];

export default function StaffPracticePage() {
    const { provider, staff, can } = useStaffAccess();
    const user = useSelector((state) => state.auth?.user);
    const showStatus = can(M_STATUS, 'can_view');
    // Each tab is its own grant. Someone given Account Status alone must not
    // land on Entity Details — the endpoint would refuse it, and offering the
    // tab implies they were given something they weren't.
    const showDetails = DETAIL_LEAVES.some((leaf) => can(leaf, 'can_view'));
    const [tab, setTab] = useState(0);

    // Only offer the tab strip when there is more than one tab to pick.
    const tabs = [
        ...(showDetails ? [{ key: 'details', label: 'Entity Details' }] : []),
        ...(showStatus ? [{ key: 'status', label: 'Account Status' }] : []),
    ];
    const active = tabs[Math.min(tab, tabs.length - 1)];

    return (
        <Box>
            {tabs.length > 1 && (
                <Paper sx={{ mb: 2 }}>
                    <Tabs value={Math.min(tab, tabs.length - 1)} onChange={(_, v) => setTab(v)}>
                        {tabs.map((t) => <Tab key={t.key} label={t.label} />)}
                    </Tabs>
                </Paper>
            )}

            {active?.key === 'details' && <StaffEntityProfilePage />}

            {active?.key === 'status' && (
                <Box>
                    <Typography variant="h5" sx={{ mb: 0.5 }}>Account Status</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {provider?.name || 'Your practice'}
                        {provider?.type ? ` · ${verticalLabel(provider.type)}` : ''}
                    </Typography>
                    <Paper sx={{ p: 3, borderRadius: 2 }}>
                        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                            <ApartmentIcon color="action" />
                            <Typography variant="subtitle1" fontWeight={700}>
                                {provider?.name || '—'}
                            </Typography>
                            <Chip
                                size="small"
                                label={(user?.status || 'unknown').toUpperCase()}
                                color={(user?.status || '').toLowerCase() === 'active'
                                    ? 'success' : 'warning'}
                            />
                        </Stack>
                        <Alert severity="info">
                            A practice&apos;s standing is set by platform review, not from this
                            screen — there is nothing to change here even with an edit grant.
                            {staff?.designation
                                ? ` You are recorded as ${staff.designation}.` : ''}
                        </Alert>
                    </Paper>
                </Box>
            )}
        </Box>
    );
}
