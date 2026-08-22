/**
 * StaffDashboard — what a provider staff member sees after signing in.
 *
 * The page is mostly one question answered honestly: *what am I allowed to
 * do here?* Their roles were assigned by their practice, they can't change
 * them, and until now they had no way to see them at all. So the access
 * section is the page, and the profile block above it is context for it.
 *
 * Only granted leaves are drawn. The ungranted rest of the tree is not shown
 * greyed out, because "not granted" and "granted but disabled" are different
 * facts and only the first one is true here.
 */
import { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
    Alert, Avatar, Box, Button, Chip, CircularProgress, Divider, Paper, Stack,
    Tooltip, Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';

import { DEFAULT_DATA_RANGE } from '../../../admin/Operations/permissions/constants/permissionTree';
import { UNBUILT_MODULES, WITHHELD_MODULES } from '../../constants/staffModules';
import ChangePasswordDialog from '../../components/ChangePasswordDialog/ChangePasswordDialog';
import useStaffAccess, {
    dataRangeLabel, grantedActions, verticalLabel,
} from '../../hooks/useStaffAccess';

const LeafRow = ({ node, screen }) => {
    const { grant } = node;
    const restricted = grant.data_range && grant.data_range !== DEFAULT_DATA_RANGE;

    return (
        <Box sx={{ py: 1, pl: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="body2" fontWeight={600}>{node.label}</Typography>
                {/* The link is the point of the row when there is one. A module
                    with no screen behind it says so plainly rather than looking
                    like a link that failed. */}
                {screen && screen.isIndex && (
                    <Chip size="small" variant="outlined" label="This page" />
                )}
                {screen && !screen.isIndex && (
                    <Button
                        size="small" endIcon={<ArrowForwardIcon />}
                        component={RouterLink} to={`/dashboard/staff/${screen.path}`}
                    >
                        Open
                    </Button>
                )}
                {/* Three different absences, and they mean different things.
                    Withheld is a decision; not-built means the practice can't
                    see it either; no-screen is the plain gap. */}
                {!screen && WITHHELD_MODULES.has(node.path) && (
                    <Tooltip title={WITHHELD_MODULES.get(node.path)}>
                        <Chip size="small" variant="outlined" color="warning" label="Not delegated" />
                    </Tooltip>
                )}
                {!screen && !WITHHELD_MODULES.has(node.path) && (
                    <Chip
                        size="small" variant="outlined"
                        label={UNBUILT_MODULES.has(node.path)
                            ? 'Not built for anyone yet'
                            : 'No screen yet'}
                    />
                )}
            </Stack>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                {/* Full access already implies all ten columns, so it prints as
                    one chip — ten chips saying the same thing reads as a longer
                    list of powers rather than a shorter one. */}
                {grant.full_access
                    ? <Chip size="small" color="secondary" label="Full access" />
                    : grantedActions(grant).map((action) => (
                        <Chip key={action.key} size="small" variant="outlined" label={action.label} />
                    ))}
                {restricted && (
                    <Chip
                        size="small" variant="outlined" color="warning"
                        label={dataRangeLabel(grant.data_range)}
                    />
                )}
            </Stack>
        </Box>
    );
};

const AccessNode = ({ node, depth, screenFor }) => {
    if (node.grant) return <LeafRow node={node} screen={screenFor(node.path)} />;

    return (
        <Box sx={{ mt: 1.5, pl: depth ? 2 : 0 }}>
            <Typography
                variant="caption"
                sx={{
                    color: 'text.secondary', fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                }}
            >
                {node.label}
            </Typography>
            {node.children.map((child) => (
                <AccessNode key={child.path} node={child} depth={depth + 1} screenFor={screenFor} />
            ))}
        </Box>
    );
};

const GroupCard = ({ group, screenFor }) => (
    <Paper sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="subtitle1" fontWeight={700}>{group.label}</Typography>
            <Chip
                size="small" variant="outlined"
                label={`${group.leaves.length} module${group.leaves.length === 1 ? '' : 's'}`}
            />
        </Stack>
        {group.grant
            ? <LeafRow node={group} screen={screenFor(group.path)} />
            : group.children.map((child) => (
                <AccessNode key={child.path} node={child} depth={0} screenFor={screenFor} />
            ))}
    </Paper>
);

export default function StaffDashboard() {
    const {
        isLoading, isError, error, refetch, staff, provider, roles, groups,
        grantedLeafCount, screens,
    } = useStaffAccess();
    const [searchParams, setSearchParams] = useSearchParams();
    const [passwordOpen, setPasswordOpen] = useState(false);

    // Which screen, if any, a given module path opens. One screen often covers
    // several modules, so this is a lookup rather than a field on the node.
    const screenFor = (path) => screens.find((screen) => screen.modules.includes(path));

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (isError || !staff) {
        return (
            <Alert
                severity="error"
                action={<Button color="inherit" size="small" onClick={refetch}>Retry</Button>}
            >
                {error?.data?.message || error?.data?.error
                    || 'We could not load your staff profile. Please try again.'}
            </Alert>
        );
    }

    // The sidebar's group entries filter this page rather than routing
    // elsewhere — see StaffLayout.
    const focusedKey = searchParams.get('view');
    const focused = groups.find((group) => group.key === focusedKey);
    const visibleGroups = focused ? [focused] : groups;

    return (
        <>
            {/* Two different truths, and conflating them is how someone ends up
                trusting a grant that isn't enforced. Say which is which. */}
            {screens.length ? (
                <Alert severity="success" sx={{ mb: 3 }}>
                    <b>{screens.length} screen{screens.length === 1 ? '' : 's'} you can open</b> —
                    they&apos;re in the sidebar, and they show {provider?.name || 'your practice'}&apos;s
                    own data. Modules below marked <i>No screen yet</i> are recorded intent: nothing
                    is built behind them, so they neither grant nor withhold anything today.
                </Alert>
            ) : (
                <Alert severity="info" sx={{ mb: 3 }}>
                    None of the modules you hold has a screen behind it yet, so there is nothing
                    here to open. What follows is what {provider?.name || 'your practice'} intends
                    you to be able to do once there is.
                </Alert>
            )}

            <Paper sx={{ p: 3, mb: 3, borderRadius: 3 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                    <Avatar sx={{ width: 64, height: 64, bgcolor: '#00695C' }}>
                        <BadgeOutlinedIcon sx={{ fontSize: 32 }} />
                    </Avatar>
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="h5">
                            {staff.full_name || `${staff.first_name || ''} ${staff.last_name || ''}`.trim() || 'Staff member'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {staff.designation || 'Staff'} at {provider?.name || 'your practice'}
                            {provider?.type ? ` · ${verticalLabel(provider.type)}` : ''}
                            {staff.employee_code ? ` · ${staff.employee_code}` : ''}
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                            <Chip
                                size="small"
                                label={`Status: ${(staff.status || 'unknown').toUpperCase()}`}
                                color={staff.status === 'active' ? 'success' : 'warning'}
                            />
                            {staff.email && <Chip size="small" variant="outlined" label={staff.email} />}
                            {staff.phone_number && (
                                <Chip size="small" variant="outlined" label={staff.phone_number} />
                            )}
                        </Stack>
                    </Box>
                    <Button
                        variant="outlined" startIcon={<LockResetIcon />}
                        onClick={() => setPasswordOpen(true)}
                    >
                        Change password
                    </Button>
                </Stack>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" gutterBottom>Your roles</Typography>
                {roles.length ? (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                        {roles.map((role) => <Chip key={role} size="small" label={role} />)}
                    </Stack>
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        No role assigned yet.
                    </Typography>
                )}
            </Paper>

            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
                <Typography variant="h6">What you can do</Typography>
                {focused && (
                    <Chip
                        size="small" label={focused.label}
                        onDelete={() => setSearchParams({})}
                    />
                )}
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="body2" color="text.secondary">
                    {grantedLeafCount} module{grantedLeafCount === 1 ? '' : 's'} granted
                </Typography>
            </Stack>

            {!grantedLeafCount && (
                <Alert severity="warning">
                    No permissions have been assigned yet — ask {provider?.name || 'your practice'} to
                    give you a role.
                </Alert>
            )}

            {/* A ``?view=`` that matches nothing means the group was in the
                sidebar when the page loaded and isn't now; say so instead of
                silently showing everything. */}
            {!!grantedLeafCount && focusedKey && !focused && (
                <Alert
                    severity="info"
                    action={(
                        <Button color="inherit" size="small" onClick={() => setSearchParams({})}>
                            Show all
                        </Button>
                    )}
                >
                    You no longer hold anything in that group.
                </Alert>
            )}

            {visibleGroups.map((group) => (
                <GroupCard key={group.key} group={group} screenFor={screenFor} />
            ))}

            <ChangePasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
        </>
    );
}
