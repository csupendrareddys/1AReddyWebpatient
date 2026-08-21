/**
 * VerticalTypesSection — PLATFORM_OWNER CRUD for the marketplace verticals.
 *
 * Deliberately the same furniture as the Plan Types section on ``PlansAdmin``
 * (icon column, code/name/description, audience chip, edit + delete icons, an
 * xs dialog with an ``IconKeyField``), so the operator moves between the two
 * without relearning anything. The two are different axes though — plan types
 * classify the SaaS subdomain catalog at /pricing, vertical types classify the
 * marketplace funnels — hence separate rows, separate endpoints.
 *
 * Lives on ``MembershipPlansAdmin`` for the same reason plan types live on
 * PlansAdmin: right under the plans they classify, and the vertical picker in
 * that page's plan dialog is populated from exactly these rows.
 *
 * Self-contained (own dialog state + mutations) rather than threaded through
 * ``useMembershipAdmin`` — it shares no state with the plan editor beyond the
 * list, which its host reads from the same query.
 */
import { useState } from 'react';
import {
    Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, FormControlLabel, IconButton, Paper, Stack, Switch, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useDispatch } from 'react-redux';

import MuiIcon from '../../../../common/components/MuiIcon/MuiIcon';
import IconKeyField from '../../../../common/components/IconKeyField/IconKeyField';
import { setSnackbar } from '../../redux/adminSharedUiSlice';
import {
    useListVerticalTypesQuery,
    useCreateVerticalTypeMutation,
    useUpdateVerticalTypeMutation,
    useDeleteVerticalTypeMutation,
} from '../../api/verticalTypeEndpoints';

const INITIAL_FORM = {
    code: '',
    name: '',
    description: '',
    icon_key: '',
    // Marks the vertical as service-RECEIVER (patient) rather than provider.
    // Defaults off so a new vertical is provider-facing unless the operator
    // opts in — the same default plan types have.
    is_receiver: false,
};

export default function VerticalTypesSection() {
    const dispatch = useDispatch();
    const { data: verticalTypes = [], isLoading } = useListVerticalTypesQuery();

    const [createVerticalType, { isLoading: isCreating }] = useCreateVerticalTypeMutation();
    const [updateVerticalType, { isLoading: isUpdating }] = useUpdateVerticalTypeMutation();
    const [deleteVerticalType] = useDeleteVerticalTypeMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(INITIAL_FORM);

    const notify = (severity, message) => dispatch(setSnackbar({ open: true, severity, message }));

    const openDialog = (existing) => {
        setEditingId(existing?.id ?? null);
        setForm(existing
            ? {
                code: existing.code || '',
                name: existing.name || '',
                description: existing.description || '',
                icon_key: existing.icon_key || '',
                is_receiver: !!existing.is_receiver,
            }
            : INITIAL_FORM);
        setDialogOpen(true);
    };

    const closeDialog = () => {
        setDialogOpen(false);
        setEditingId(null);
    };

    const handleSave = async () => {
        try {
            if (editingId) {
                await updateVerticalType({ id: editingId, data: form }).unwrap();
                notify('success', `Vertical "${form.code}" updated`);
            } else {
                await createVerticalType(form).unwrap();
                notify('success', `Vertical "${form.code}" created`);
            }
            closeDialog();
        } catch (err) {
            // Flat {error} on a 409 (duplicate code), same as plan types.
            notify('error', err?.data?.error || 'Save failed');
        }
    };

    // Reorder a vertical up/down the list and persist the new order to the
    // backend — the same up/down-arrow pattern the module editor uses. Each
    // vertical is its own row (unlike the module editor's buffered array), so
    // we reassign a clean sequential ``sort_order`` and PUT only the rows whose
    // value actually changed. The public /register tiles and Login / Register
    // dropdowns read the same ``sort_order``, so the operator's order flows
    // straight through to the funnels.
    const move = async (index, dir) => {
        const target = index + dir;
        if (target < 0 || target >= verticalTypes.length) return;

        const next = [...verticalTypes];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);

        const changed = next
            .map((vt, i) => ({ vt, i }))
            .filter(({ vt, i }) => vt.sort_order !== i);

        try {
            await Promise.all(changed.map(({ vt, i }) =>
                updateVerticalType({ id: vt.id, data: { sort_order: i } }).unwrap()));
            notify('success', 'Order updated');
        } catch (err) {
            notify('error', err?.data?.error || 'Reorder failed');
        }
    };

    const handleDelete = async (vt) => {
        if (!window.confirm(
            `Delete vertical "${vt.code}"? This only works if no membership plan is currently using it.`
        )) return;
        try {
            await deleteVerticalType(vt.id).unwrap();
            notify('success', `Vertical "${vt.code}" deleted`);
        } catch (err) {
            // 409 when a live plan still references this vertical.
            notify('error', err?.data?.error || 'Delete failed');
        }
    };

    return (
        <Box sx={{ mt: 4, mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="h5">Verticals</Typography>
                    <Typography variant="caption" color="text.secondary">
                        The registration funnels. Each one gets a tile on <b>/register</b>, a tab on
                        its join page, and can have membership plans authored against it above.
                    </Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog(null)}>
                    New vertical
                </Button>
            </Stack>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                    <CircularProgress size={24} />
                </Box>
            ) : (
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell align="center" width={60}>Icon</TableCell>
                                <TableCell>Code</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Description</TableCell>
                                <TableCell>Audience</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {verticalTypes.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        <Typography variant="body2" color="text.secondary">
                                            No verticals yet — /register has nothing to offer until
                                            one exists.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {verticalTypes.map((vt, index) => (
                                <TableRow key={vt.id} hover>
                                    <TableCell align="center">
                                        {/* An unset or unrecognised key renders the em dash
                                            rather than a gap, so the column reads as "no
                                            icon" instead of "still loading". */}
                                        <MuiIcon
                                            name={vt.icon_key}
                                            fontSize="small"
                                            color="action"
                                            fallback={
                                                <Typography variant="body2" color="text.disabled">—</Typography>
                                            }
                                        />
                                    </TableCell>
                                    <TableCell><code>{vt.code}</code></TableCell>
                                    <TableCell>{vt.name}</TableCell>
                                    <TableCell>{vt.description}</TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={vt.is_receiver ? 'Receiver' : 'Provider'}
                                            color={vt.is_receiver ? 'info' : 'default'}
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Move up">
                                            <span>
                                                <IconButton
                                                    size="small"
                                                    disabled={index === 0 || isUpdating}
                                                    onClick={() => move(index, -1)}
                                                >
                                                    <ArrowUpwardIcon fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title="Move down">
                                            <span>
                                                <IconButton
                                                    size="small"
                                                    disabled={index === verticalTypes.length - 1 || isUpdating}
                                                    onClick={() => move(index, 1)}
                                                >
                                                    <ArrowDownwardIcon fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title="Edit">
                                            <IconButton size="small" onClick={() => openDialog(vt)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <IconButton size="small" color="error" onClick={() => handleDelete(vt)}>
                                                <DeleteIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <Dialog open={dialogOpen} onClose={closeDialog} fullWidth maxWidth="xs">
                <DialogTitle>
                    {editingId ? `Edit vertical: ${form.code}` : 'New vertical'}
                </DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Code"
                            value={form.code}
                            onChange={(e) => setForm({ ...form, code: e.target.value })}
                            helperText="Stable identifier — becomes ?vertical=clinic and the signup URL."
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Name"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            helperText="Display copy — the tab and the /register tile."
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Description"
                            value={form.description}
                            onChange={(e) => setForm({ ...form, description: e.target.value })}
                            helperText="Shown under the tile and as the join page's sub-heading."
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                        />
                        {/* Remounts per dialog open so the local text state
                            re-seeds from whichever vertical is being edited. */}
                        <IconKeyField
                            key={editingId || 'new'}
                            value={form.icon_key}
                            onChange={(next) => setForm({ ...form, icon_key: next })}
                        />
                        <Box>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!!form.is_receiver}
                                        onChange={(e) => setForm({ ...form, is_receiver: e.target.checked })}
                                    />
                                }
                                label="Service-receiver (patient) vertical"
                            />
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                On, the /register tile leads to <b>/join_receiver</b> — patients buy a
                                plan without joining the network. Off, it leads to the <b>/join</b>
                                {' '}marketplace funnel and its provider signup. Both pages filter on
                                this flag, so a vertical shows on exactly one of them.
                            </Typography>
                        </Box>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeDialog}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={isCreating || isUpdating || !form.code || !form.name}
                    >
                        {editingId ? 'Save changes' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
