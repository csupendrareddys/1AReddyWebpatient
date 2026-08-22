/**
 * MyAccessPage — Shows the logged-in admin their own permissions
 * Works for both super admins (full access banner) and sub-admins (actual permissions)
 */
import {
    Box, Typography, Chip, Paper, Alert, CircularProgress,
    Avatar, Divider,
} from '@mui/material';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import ShieldIcon from '@mui/icons-material/Shield';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import useMyAccess from '../../hooks/useMyAccess';
import EffectivePermsView from '../../../ManageSubAdmins/components/EffectivePermsView/EffectivePermsView';
import './MyAccessPage.css';

const ROLE_COLORS = [
    '#E8833A', '#16a34a', '#2563eb', '#9333ea', '#dc2626', '#0891b2',
];

const MyAccessPage = () => {
    const {
        hasFullAccess, isSuperAdmin, isPlatformOwner, permissions, assignedRoles,
        isLoading, isError,
    } = useMyAccess();
    // Strict label rendering — each literal role gets its own copy.
    // ``hasFullAccess`` is the visibility-gate boolean used elsewhere
    // on this page (banner, ∞ counts, "no roles required" text).
    const roleLabel = isPlatformOwner
        ? 'Platform Owner'
        : isSuperAdmin
            ? 'Super Admin'
            : 'Sub Admin';

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (isError) {
        return (
            <Alert severity="error" sx={{ m: 2 }}>
                Failed to load your permissions. Please refresh the page.
            </Alert>
        );
    }

    const permissionCount = Object.keys(permissions || {}).length;
    const activeModules = Object.entries(permissions || {}).filter(([, p]) =>
        ['can_view', 'can_create', 'can_edit', 'can_delete',
            'can_l1_verify', 'can_l2_verify', 'can_l3_verify', 'can_lock', 'can_unlock']
            .some(k => p[k])
    ).length;

    return (
        <Box className="my-access-page">
            {/* Page Header */}
            <Box className="my-access-header">
                <Avatar sx={{ width: 48, height: 48, bgcolor: '#E8833A', fontWeight: 700 }}>
                    <VpnKeyIcon />
                </Avatar>
                <Box>
                    <Typography variant="h5" fontWeight={700}>
                        My Access & Permissions
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        View all permissions assigned to your account
                    </Typography>
                </Box>
                <Chip
                    icon={<ShieldIcon sx={{ fontSize: 16 }} />}
                    label={roleLabel}
                    sx={{
                        ml: 'auto',
                        bgcolor: hasFullAccess ? '#1a1a2e' : '#f0fdf4',
                        color: hasFullAccess ? '#fff' : '#16a34a',
                        fontWeight: 600,
                        border: hasFullAccess ? 'none' : '1px solid #bbf7d0',
                    }}
                />
            </Box>

            {/* Full-access banner — shown for both super admins and platform owners,
                with role-aware copy so the operator doesn't see the wrong title. */}
            {hasFullAccess && (
                <Box className="my-access-super-banner" sx={{ mb: 3 }}>
                    <WorkspacePremiumIcon sx={{ fontSize: 40, color: '#fbbf24' }} />
                    <Box>
                        <Typography variant="h6" fontWeight={700} sx={{ color: '#fff' }}>
                            Full System Access
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)' }}>
                            {isPlatformOwner
                                ? 'As a Platform Owner, you have unrestricted access across every tenant — '
                                  + 'tenant CRUD, plan/add-on catalog, per-tenant entitlements, and the full '
                                  + 'admin console of any tenant.'
                                : 'As a Super Admin, you have unrestricted access to all modules and actions '
                                  + 'in the system.'}
                        </Typography>
                    </Box>
                </Box>
            )}

            {/* Stats Row */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                <Paper sx={{ flex: 1, minWidth: 140, p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <Typography variant="h4" fontWeight={700} color="primary">
                        {assignedRoles?.length || 0}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Assigned Roles</Typography>
                </Paper>
                <Paper sx={{ flex: 1, minWidth: 140, p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <Typography variant="h4" fontWeight={700} sx={{ color: '#16a34a' }}>
                        {hasFullAccess ? '∞' : activeModules}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Active Modules</Typography>
                </Paper>
                <Paper sx={{ flex: 1, minWidth: 140, p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <Typography variant="h4" fontWeight={700} sx={{ color: '#2563eb' }}>
                        {hasFullAccess ? '∞' : permissionCount}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Total Modules</Typography>
                </Paper>
            </Box>

            {/* Assigned Roles */}
            <Paper sx={{ p: 3, borderRadius: 2, mb: 3 }}>
                <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
                    Assigned Roles
                </Typography>
                <Divider sx={{ mb: 2 }} />
                {assignedRoles && assignedRoles.length > 0 ? (
                    <Box className="my-access-roles-chips">
                        {assignedRoles.map((role, idx) => (
                            <Chip
                                key={role.id || idx}
                                label={
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <span>{role.name || role.role_name || 'Unknown Role'}</span>
                                        {role.level != null && (
                                            <Typography
                                                component="span"
                                                sx={{
                                                    fontSize: '0.65rem',
                                                    bgcolor: 'rgba(255,255,255,0.25)',
                                                    px: 0.6,
                                                    py: 0.1,
                                                    borderRadius: 1,
                                                    fontWeight: 700,
                                                }}
                                            >
                                                L{role.level}
                                            </Typography>
                                        )}
                                    </Box>
                                }
                                sx={{
                                    bgcolor: ROLE_COLORS[idx % ROLE_COLORS.length],
                                    color: '#fff',
                                    fontWeight: 600,
                                    fontSize: '0.85rem',
                                    height: 32,
                                    '& .MuiChip-label': { px: 1.5 },
                                }}
                            />
                        ))}
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.secondary">
                        {isPlatformOwner
                            ? 'Platform Owners have inherent cross-tenant access — no roles required.'
                            : hasFullAccess
                                ? 'Super Admins have inherent full access — no roles required.'
                                : 'No roles have been assigned to your account yet.'}
                    </Typography>
                )}
            </Paper>

            {/* Permissions Table */}
            <Paper sx={{ p: 3, borderRadius: 2 }}>
                {hasFullAccess ? (
                    <Box>
                        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
                            Effective Permissions
                        </Typography>
                        <Divider sx={{ mb: 2 }} />
                        <Alert severity="info" icon={<WorkspacePremiumIcon />}>
                            {isPlatformOwner
                                ? <>As a Platform Owner, you have <strong>full access</strong> across every tenant — including tenant CRUD, plan/add-on catalog, and per-tenant entitlements.</>
                                : <>As a Super Admin, you have <strong>full access</strong> to every module and action in the system. All permissions are granted by default.</>}
                        </Alert>
                    </Box>
                ) : (
                    <EffectivePermsView
                        permissions={permissions}
                        isLoading={isLoading}
                    />
                )}
            </Paper>
        </Box>
    );
};

export default MyAccessPage;
