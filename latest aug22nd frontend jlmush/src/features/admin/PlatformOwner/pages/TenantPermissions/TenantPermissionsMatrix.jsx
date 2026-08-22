/**
 * TenantPermissionsMatrix — module × action grid for the
 * landing-page permission allocation flow. Extracted out of the
 * standalone page so the new ``TenantEntitlements`` tabbed page
 * can render it as the "Permissions" tab.
 *
 * The standalone page (``TenantPermissions.jsx``) is now a thin
 * wrapper for back-compat with the old
 * ``/dashboard/platform/tenants/<id>/permissions`` route.
 */
import { useEffect, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Paper, Snackbar, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';

import {
    useListTenantPermissionsQuery,
    useUpsertTenantPermissionsMutation,
} from '../../../api/platformEndpoints';

const MODULES = [
    { key: 'landing_config', label: 'Landing configuration (tenant-wide)' },
    { key: 'landing_module', label: 'Landing modules (all modules)' },
    { key: 'landing_hero', label: 'Landing hero & theme (legacy)' },
    { key: 'landing_nav', label: 'Landing navigation (legacy)' },
    { key: 'landing_features', label: 'Landing features (legacy)' },
];
const ACTIONS = ['view', 'create', 'edit', 'delete'];


const TenantPermissionsMatrix = ({ tenantId }) => {
    const { data: rows = [], isLoading } = useListTenantPermissionsQuery(tenantId);
    const [upsert, upsertState] = useUpsertTenantPermissionsMutation();

    const [grid, setGrid] = useState({});
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });

    useEffect(() => {
        const next = {};
        MODULES.forEach((m) => {
            next[m.key] = {};
            ACTIONS.forEach((a) => { next[m.key][a] = false; });
        });
        rows.forEach((r) => {
            if (next[r.module]) {
                next[r.module][r.action] = !!r.allowed;
            }
        });
        setGrid(next);
    }, [rows]);

    const toggle = (mod, act) => {
        setGrid((prev) => ({
            ...prev,
            [mod]: { ...prev[mod], [act]: !prev[mod][act] },
        }));
    };

    const handleSave = async () => {
        const allocations = [];
        Object.entries(grid).forEach(([module, acts]) => {
            Object.entries(acts).forEach(([action, allowed]) => {
                allocations.push({ module, action, allowed });
            });
        });
        try {
            await upsert({ tenantId, allocations }).unwrap();
            setSnack({ open: true, severity: 'success', message: 'Allocations updated.' });
        } catch (err) {
            setSnack({
                open: true,
                severity: 'error',
                message: err?.data?.error || 'Failed to save allocations.',
            });
        }
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Toggle which landing modules this tenant&#39;s super-admin can see and modify.
                Changes apply immediately after saving.
            </Typography>

            <TableContainer component={Paper}>
                <Table>
                    <TableHead>
                        <TableRow>
                            <TableCell>Module</TableCell>
                            {ACTIONS.map((a) => (
                                <TableCell key={a} align="center">{a}</TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading && (
                            <TableRow>
                                <TableCell colSpan={ACTIONS.length + 1}>Loading…</TableCell>
                            </TableRow>
                        )}
                        {!isLoading && MODULES.map((m) => (
                            <TableRow key={m.key} hover>
                                <TableCell>{m.label}</TableCell>
                                {ACTIONS.map((a) => (
                                    <TableCell key={a} align="center">
                                        <Checkbox
                                            checked={!!grid[m.key]?.[a]}
                                            onChange={() => toggle(m.key, a)}
                                        />
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    variant="contained" startIcon={<SaveIcon />}
                    disabled={upsertState.isLoading}
                    onClick={handleSave}
                >
                    Save allocations
                </Button>
            </Box>

            <Snackbar
                open={snack.open}
                autoHideDuration={4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert severity={snack.severity}>{snack.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default TenantPermissionsMatrix;
