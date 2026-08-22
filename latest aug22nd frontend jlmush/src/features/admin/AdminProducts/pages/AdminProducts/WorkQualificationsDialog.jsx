/**
 * WorkQualificationsDialog — manage the work-qualification list.
 *
 * One list, shared by every doctor in the tenant: doctors pick from it on their
 * About-me profile, and products gate on it. It lives beside Add Product
 * because it is catalog-level reference data, not a per-product setting.
 *
 * Entries are deactivated rather than deleted — a doctor may already have one
 * selected, and removing it outright would silently rewrite their profile.
 * Deactivating hides it from new pickers while leaving existing choices intact.
 */
import React, { useState } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField,
    Stack, Typography, Table, TableContainer, TableHead, TableRow, TableCell, TableBody,
    Chip, Switch, Box, CircularProgress, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import {
    useGetWorkQualificationsQuery,
    useCreateWorkQualificationMutation,
    useUpdateWorkQualificationMutation,
} from '../../../api/marketplaceEndpoints';

const WorkQualificationsDialog = ({ open, onClose, onNotify }) => {
    const { data: rows = [], isLoading } = useGetWorkQualificationsQuery(undefined, { skip: !open });
    const [createWorkQualification, { isLoading: creating }] = useCreateWorkQualificationMutation();
    const [updateWorkQualification] = useUpdateWorkQualificationMutation();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');

    const notify = (message, severity) => onNotify && onNotify(message, severity);

    const handleAdd = async () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        try {
            await createWorkQualification({ name: trimmed, description: description.trim() }).unwrap();
            setName('');
            setDescription('');
            notify('Work qualification added', 'success');
        } catch (err) {
            // The backend rejects duplicates by name (409) — surface that reason
            // rather than a generic failure.
            notify(err?.data?.error || err?.data?.message || 'Could not add work qualification', 'error');
        }
    };

    const handleToggleActive = async (row) => {
        try {
            await updateWorkQualification({ qualificationId: row.id, is_active: !row.is_active }).unwrap();
            notify(row.is_active ? `"${row.name}" deactivated` : `"${row.name}" reactivated`, 'success');
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not update', 'error');
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Work Qualifications</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    One shared list for every doctor. Doctors pick one on their profile, and
                    products can require it.
                </Typography>

                <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 2 }}>
                    <TextField
                        size="small" label="Name" value={name} sx={{ flex: 1 }}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                    />
                    <TextField
                        size="small" label="Description (optional)" value={description} sx={{ flex: 1 }}
                        onChange={(e) => setDescription(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
                    />
                    <Button
                        variant="contained" startIcon={<AddIcon />} sx={{ mt: 0.25 }}
                        onClick={handleAdd} disabled={!name.trim() || creating}
                    >
                        Add
                    </Button>
                </Stack>

                {isLoading && (
                    <Box display="flex" justifyContent="center" py={3}><CircularProgress size={26} /></Box>
                )}

                {!isLoading && !rows.length && (
                    <Alert severity="info">
                        No work qualifications yet. Add one above and it becomes selectable by every doctor.
                    </Alert>
                )}

                {!isLoading && !!rows.length && (
                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Description</TableCell>
                                <TableCell sx={{ fontWeight: 700 }} align="center">Status</TableCell>
                                <TableCell sx={{ fontWeight: 700 }} align="center">Selectable</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {rows.map((row) => (
                                <TableRow key={row.id} hover>
                                    <TableCell>{row.name}</TableCell>
                                    <TableCell sx={{ color: 'text.secondary' }}>{row.description || '—'}</TableCell>
                                    <TableCell align="center">
                                        <Chip
                                            label={row.is_active ? 'Active' : 'Inactive'}
                                            size="small"
                                            color={row.is_active ? 'success' : 'default'}
                                        />
                                    </TableCell>
                                    <TableCell align="center">
                                        <Switch
                                            size="small" checked={!!row.is_active}
                                            onChange={() => handleToggleActive(row)}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    </TableContainer>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default WorkQualificationsDialog;
