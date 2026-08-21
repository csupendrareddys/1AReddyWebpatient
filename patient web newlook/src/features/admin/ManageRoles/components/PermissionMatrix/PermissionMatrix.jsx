/**
 * PermissionMatrix — Full permission matrix grid with checkboxes
 * Pure UI — data and handlers come through props
 * Groups modules by category, supports Full Access toggle, column-level select-all
 */
import { useState, useCallback, useMemo } from 'react';
import {
    Box, Typography, Checkbox, Button, Select, MenuItem,
    Paper, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Alert, CircularProgress,
    IconButton, Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';

const ACTION_COLUMNS = [
    { key: 'full_access', label: 'Full Access' },
    { key: 'can_view', label: 'View' },
    { key: 'can_create', label: 'Create' },
    { key: 'can_edit', label: 'Edit' },
    { key: 'can_update', label: 'Update' },
    { key: 'can_delete', label: 'Delete' },
    { key: 'can_l1_verify', label: 'L1 Verify' },
    { key: 'can_l2_verify', label: 'L2 Verify' },
    { key: 'can_l3_verify', label: 'L3 Verify' },
    { key: 'can_lock', label: 'Lock' },
    { key: 'can_unlock', label: 'Unlock' },
];

const PermissionMatrix = ({
    role,
    groupedPermissions,
    dataRanges,
    isSystemRole,
    isLoading,
    isSaving,
    onSave,
    onBack,
}) => {
    // Local editable state — initialized from props
    const [editedPerms, setEditedPerms] = useState(() => {
        const map = {};
        groupedPermissions.forEach((group) => {
            group.modules.forEach((mod) => {
                map[mod.module] = { ...mod };
            });
        });
        return map;
    });

    // Reset local state when permissions data changes
    useMemo(() => {
        const map = {};
        groupedPermissions.forEach((group) => {
            group.modules.forEach((mod) => {
                map[mod.module] = { ...mod };
            });
        });
        setEditedPerms(map);
    }, [groupedPermissions]);

    const handleToggle = useCallback((moduleKey, field) => {
        if (isSystemRole) return;
        setEditedPerms((prev) => {
            const mod = { ...prev[moduleKey] };
            if (field === 'full_access') {
                const newVal = !mod.full_access;
                mod.full_access = newVal;
                // Full access toggles all other fields
                ACTION_COLUMNS.slice(1).forEach((col) => {
                    mod[col.key] = newVal;
                });
            } else {
                mod[field] = !mod[field];
                // If unchecking any field, uncheck full_access
                if (!mod[field]) mod.full_access = false;
            }
            return { ...prev, [moduleKey]: mod };
        });
    }, [isSystemRole]);

    const handleDataRangeChange = useCallback((moduleKey, value) => {
        if (isSystemRole) return;
        setEditedPerms((prev) => ({
            ...prev,
            [moduleKey]: { ...prev[moduleKey], data_range: value },
        }));
    }, [isSystemRole]);

    const handleColumnSelectAll = useCallback((field) => {
        if (isSystemRole) return;
        setEditedPerms((prev) => {
            const allModules = Object.keys(prev);
            const allChecked = allModules.every((m) => prev[m][field]);
            const newPerms = { ...prev };
            allModules.forEach((m) => {
                newPerms[m] = { ...newPerms[m], [field]: !allChecked };
                if (field === 'full_access') {
                    ACTION_COLUMNS.slice(1).forEach((col) => {
                        newPerms[m][col.key] = !allChecked;
                    });
                } else if (!newPerms[m][field]) {
                    newPerms[m].full_access = false;
                }
            });
            return newPerms;
        });
    }, [isSystemRole]);

    const handleSave = useCallback(() => {
        const permissionsArray = Object.entries(editedPerms).map(([module, perm]) => ({
            module,
            full_access: perm.full_access || false,
            can_view: perm.can_view || false,
            can_create: perm.can_create || false,
            can_edit: perm.can_edit || false,
            can_update: perm.can_update || false,
            can_delete: perm.can_delete || false,
            can_l1_verify: perm.can_l1_verify || false,
            can_l2_verify: perm.can_l2_verify || false,
            can_l3_verify: perm.can_l3_verify || false,
            can_lock: perm.can_lock || false,
            can_unlock: perm.can_unlock || false,
            data_range: perm.data_range || 'ALL',
        }));
        onSave(permissionsArray);
    }, [editedPerms, onSave]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title="Back to Roles">
                        <IconButton onClick={onBack}>
                            <ArrowBackIcon />
                        </IconButton>
                    </Tooltip>
                    <Typography variant="h6" fontWeight={600}>
                        Permissions: {role?.name}
                    </Typography>
                </Box>
                {!isSystemRole && (
                    <Button
                        variant="contained"
                        startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
                        onClick={handleSave}
                        disabled={isSaving}
                        sx={{
                            bgcolor: '#16a34a',
                            '&:hover': { bgcolor: '#15803d' },
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        Save Permissions
                    </Button>
                )}
            </Box>

            {isSystemRole && (
                <Alert severity="info" sx={{ mb: 2 }}>
                    System role — permissions can be viewed but not modified.
                </Alert>
            )}

            {/* Matrix Table */}
            <TableContainer component={Paper} sx={{ borderRadius: 2, maxHeight: '70vh', overflowY: 'auto' }}>
                <Table stickyHeader size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700, minWidth: 50, bgcolor: '#f8f9fa' }}>#</TableCell>
                            <TableCell sx={{ fontWeight: 700, minWidth: 200, bgcolor: '#f8f9fa' }}>Module</TableCell>
                            {ACTION_COLUMNS.map((col) => (
                                <TableCell
                                    key={col.key}
                                    align="center"
                                    sx={{
                                        fontWeight: 700,
                                        bgcolor: '#f8f9fa',
                                        minWidth: 70,
                                        cursor: isSystemRole ? 'default' : 'pointer',
                                        '&:hover': isSystemRole ? {} : { bgcolor: '#e9ecef' },
                                    }}
                                    onClick={() => handleColumnSelectAll(col.key)}
                                >
                                    {col.label}
                                </TableCell>
                            ))}
                            <TableCell sx={{ fontWeight: 700, minWidth: 140, bgcolor: '#f8f9fa' }}>Data Range</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {groupedPermissions.map((group) => (
                            <>
                                {/* Group Header */}
                                <TableRow key={`header-${group.label}`}>
                                    <TableCell
                                        colSpan={ACTION_COLUMNS.length + 3}
                                        sx={{
                                            bgcolor: '#f0f4ff',
                                            fontWeight: 700,
                                            color: '#3b5998',
                                            py: 1,
                                            fontSize: '0.85rem',
                                        }}
                                    >
                                        {group.label}
                                    </TableCell>
                                </TableRow>
                                {/* Module Rows */}
                                {group.modules.map((mod, idx) => {
                                    const perm = editedPerms[mod.module] || mod;
                                    return (
                                        <TableRow key={mod.module} hover>
                                            <TableCell sx={{ color: '#6b7280' }}>{idx + 1}</TableCell>
                                            <TableCell sx={{ fontWeight: 500 }}>
                                                {mod.module.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                                            </TableCell>
                                            {ACTION_COLUMNS.map((col) => (
                                                <TableCell key={col.key} align="center">
                                                    <Checkbox
                                                        size="small"
                                                        checked={!!perm[col.key]}
                                                        onChange={() => handleToggle(mod.module, col.key)}
                                                        disabled={isSystemRole || (perm.full_access && col.key !== 'full_access')}
                                                        sx={{
                                                            p: 0.5,
                                                            color: col.key === 'full_access' ? '#7c3aed' : undefined,
                                                            '&.Mui-checked': {
                                                                color: col.key === 'full_access' ? '#7c3aed' : '#2563eb',
                                                            },
                                                        }}
                                                    />
                                                </TableCell>
                                            ))}
                                            <TableCell>
                                                <Select
                                                    size="small"
                                                    value={perm.data_range || 'ALL'}
                                                    onChange={(e) => handleDataRangeChange(mod.module, e.target.value)}
                                                    disabled={isSystemRole}
                                                    sx={{ fontSize: '0.8rem', minWidth: 120 }}
                                                >
                                                    {(dataRanges || []).map((dr) => (
                                                        <MenuItem key={dr.value} value={dr.value} sx={{ fontSize: '0.8rem' }}>
                                                            {dr.label}
                                                        </MenuItem>
                                                    ))}
                                                    {(!dataRanges || dataRanges.length === 0) && (
                                                        <MenuItem value="ALL">All</MenuItem>
                                                    )}
                                                </Select>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
        </Box>
    );
};

export default PermissionMatrix;
