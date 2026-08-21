/**
 * DiscountBook — the CRUD table for one discount book (vouchers OR coupons).
 *
 * Rendered twice below the pricing table, once per book. They are separate
 * server-side tables and separate components on screen for the same reason:
 * an admin manages a voucher book and a coupon book as two distinct things.
 *
 * Every row is a flat ₹ amount. An admin creates them here and then picks
 * which ones apply to a given doctor × offering in the pricing table above;
 * each picked row subtracts its amount straight off that Display Price.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Stack,
    Switch, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import {
    useListDiscountsQuery,
    useCreateDiscountMutation,
    useUpdateDiscountMutation,
    useDeleteDiscountMutation,
} from '../../api/displayPricingEndpoints';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const BLANK = { code: '', label: '', amount: '' };

/**
 * @param {'vouchers'|'coupons'} kind
 * @param {string} title     heading shown above the table
 * @param {string} blurb     one-line explanation
 * @param {Function} onToast (severity, message) => void
 */
const DiscountBook = ({ kind, title, blurb, onToast }) => {
    const { data: rows = [], isFetching } = useListDiscountsQuery(kind);
    const [createDiscount, { isLoading: creating }] = useCreateDiscountMutation();
    const [updateDiscount] = useUpdateDiscountMutation();
    const [deleteDiscount] = useDeleteDiscountMutation();

    // `draft` is the new-row form; `editId`/`editDraft` is the inline editor.
    const [draft, setDraft] = useState(BLANK);
    const [editId, setEditId] = useState(null);
    const [editDraft, setEditDraft] = useState(BLANK);

    const report = (err, fallback) => onToast?.(
        'error', err?.data?.error || err?.data?.message || err?.message || fallback,
    );

    const handleCreate = async () => {
        if (!draft.code.trim()) return onToast?.('error', 'Code is required.');
        try {
            await createDiscount({
                kind,
                body: {
                    code: draft.code.trim(),
                    label: draft.label.trim(),
                    amount: Number(draft.amount) || 0,
                    is_active: true,
                },
            }).unwrap();
            setDraft(BLANK);
            onToast?.('success', `${title} added.`);
        } catch (err) {
            report(err, 'Could not add.');
        }
    };

    const handleSaveEdit = async (row) => {
        try {
            await updateDiscount({
                kind,
                id: row.id,
                body: {
                    code: editDraft.code.trim(),
                    label: editDraft.label.trim(),
                    amount: Number(editDraft.amount) || 0,
                    is_active: row.is_active,
                },
            }).unwrap();
            setEditId(null);
            onToast?.('success', 'Saved.');
        } catch (err) {
            report(err, 'Could not save.');
        }
    };

    // Toggling active is a one-click action rather than an edit-mode field:
    // it's the switch an admin reaches for to pull a discount out of every
    // price at once.
    const handleToggleActive = async (row) => {
        try {
            await updateDiscount({
                kind,
                id: row.id,
                body: {
                    code: row.code,
                    label: row.label,
                    amount: row.amount,
                    is_active: !row.is_active,
                },
            }).unwrap();
        } catch (err) {
            report(err, 'Could not update.');
        }
    };

    const handleDelete = async (row) => {
        try {
            await deleteDiscount({ kind, id: row.id }).unwrap();
            onToast?.('success', `${row.code} deleted.`);
        } catch (err) {
            report(err, 'Could not delete.');
        }
    };

    const startEdit = (row) => {
        setEditId(row.id);
        setEditDraft({ code: row.code, label: row.label || '', amount: row.amount });
    };

    return (
        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Typography variant="subtitle1" fontWeight={700}>{title}</Typography>
                <Chip size="small" variant="outlined" label={rows.length} />
                {isFetching && <CircularProgress size={14} />}
            </Stack>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1.5 }}>
                {blurb}
            </Typography>

            <TableContainer sx={{ maxHeight: 320 }}>
                <Table size="small" stickyHeader>
                    <TableHead>
                        <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'action.hover' } }}>
                            <TableCell>Code</TableCell>
                            <TableCell>Label</TableCell>
                            <TableCell align="right">Amount</TableCell>
                            <TableCell align="center">Active</TableCell>
                            <TableCell align="right" />
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {rows.length === 0 && !isFetching && (
                            <TableRow>
                                <TableCell colSpan={5}>
                                    <Typography variant="body2" color="text.secondary">
                                        None yet — add one below.
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {rows.map((row) => {
                            const editing = editId === row.id;
                            return (
                                <TableRow key={row.id} hover
                                    sx={{ opacity: row.is_active ? 1 : 0.55 }}>
                                    <TableCell>
                                        {editing ? (
                                            <TextField
                                                size="small" value={editDraft.code}
                                                onChange={(e) => setEditDraft(
                                                    (d) => ({ ...d, code: e.target.value }))}
                                                sx={{ width: 110 }}
                                            />
                                        ) : <strong>{row.code}</strong>}
                                    </TableCell>
                                    <TableCell>
                                        {editing ? (
                                            <TextField
                                                size="small" value={editDraft.label}
                                                onChange={(e) => setEditDraft(
                                                    (d) => ({ ...d, label: e.target.value }))}
                                                sx={{ width: 150 }}
                                            />
                                        ) : (row.label || <Typography variant="caption"
                                            color="text.disabled">—</Typography>)}
                                    </TableCell>
                                    <TableCell align="right">
                                        {editing ? (
                                            <TextField
                                                size="small" type="number" value={editDraft.amount}
                                                onChange={(e) => setEditDraft(
                                                    (d) => ({ ...d, amount: e.target.value }))}
                                                inputProps={{ min: 0, style: { textAlign: 'right' } }}
                                                sx={{ width: 100 }}
                                            />
                                        ) : inr(row.amount)}
                                    </TableCell>
                                    <TableCell align="center">
                                        <Tooltip title={row.is_active
                                            ? 'Applied to every row that selects it'
                                            : 'Selected but not applied'}>
                                            <Switch
                                                size="small"
                                                checked={row.is_active}
                                                onChange={() => handleToggleActive(row)}
                                            />
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                        {editing ? (
                                            <>
                                                <IconButton size="small"
                                                    onClick={() => handleSaveEdit(row)}>
                                                    <SaveIcon fontSize="small" />
                                                </IconButton>
                                                <IconButton size="small"
                                                    onClick={() => setEditId(null)}>
                                                    <CloseIcon fontSize="small" />
                                                </IconButton>
                                            </>
                                        ) : (
                                            <>
                                                <IconButton size="small"
                                                    onClick={() => startEdit(row)}>
                                                    <EditIcon fontSize="small" />
                                                </IconButton>
                                                <IconButton size="small" color="error"
                                                    onClick={() => handleDelete(row)}>
                                                    <DeleteOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </TableContainer>

            <Box sx={{ mt: 1.5 }}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    <TextField
                        size="small" label="Code" placeholder="WELCOME50"
                        value={draft.code}
                        onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                        sx={{ width: 130 }}
                    />
                    <TextField
                        size="small" label="Label" placeholder="Welcome offer"
                        value={draft.label}
                        onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                        sx={{ flex: 1, minWidth: 140 }}
                    />
                    <TextField
                        size="small" label="₹ off" type="number"
                        value={draft.amount}
                        onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
                        inputProps={{ min: 0 }}
                        sx={{ width: 100 }}
                    />
                    <Button
                        variant="outlined" size="small" startIcon={<AddIcon />}
                        onClick={handleCreate} disabled={creating}
                    >
                        Add
                    </Button>
                </Stack>
            </Box>

            {rows.some((r) => !r.is_active) && (
                <Alert severity="info" sx={{ mt: 1.5, py: 0 }}>
                    Inactive rows stay selected on pricing rows but are not subtracted.
                </Alert>
            )}
        </Paper>
    );
};

export default DiscountBook;
