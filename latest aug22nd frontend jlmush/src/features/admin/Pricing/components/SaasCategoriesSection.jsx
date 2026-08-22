/**
 * SaasCategoriesSection — platform-console manager for the vendor site's
 * industry segments (healthcare, legal, ...).
 *
 * Each category drives one public pricing page: bare ``/pricing`` renders
 * the default category, ``/pricing/<code>`` the rest — with the hero copy
 * authored here and only that category's plan types/plans below it.
 * Self-contained (own RTK hooks + dialog state) so PlansAdmin just mounts
 * it above the Plan Types table.
 */
import { useState } from 'react';
import {
    Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, FormControlLabel, IconButton, Paper, Stack,
    Switch, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import StarIcon from '@mui/icons-material/Star';

import {
    useListSaasCategoriesQuery,
    useCreateSaasCategoryMutation,
    useUpdateSaasCategoryMutation,
    useDeleteSaasCategoryMutation,
} from '../../api/pricingEndpoints';

const EMPTY_FORM = {
    code: '', name: '', tagline: '', headline: '', subheadline: '',
    display_order: 0, is_active: true, is_default: false,
};

export default function SaasCategoriesSection({ notify }) {
    const { data: categories = [], isLoading } = useListSaasCategoriesQuery();
    const [createCategory, { isLoading: creating }] = useCreateSaasCategoryMutation();
    const [updateCategory, { isLoading: updating }] = useUpdateSaasCategoryMutation();
    const [deleteCategory] = useDeleteSaasCategoryMutation();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);

    const openDialog = (existing) => {
        if (existing) {
            setEditingId(existing.id);
            setForm({
                code: existing.code || '',
                name: existing.name || '',
                tagline: existing.tagline || '',
                headline: existing.headline || '',
                subheadline: existing.subheadline || '',
                display_order: existing.display_order ?? 0,
                is_active: !!existing.is_active,
                is_default: !!existing.is_default,
            });
        } else {
            setEditingId(null);
            setForm(EMPTY_FORM);
        }
        setDialogOpen(true);
    };

    const handleSave = async () => {
        try {
            if (editingId) {
                await updateCategory({ id: editingId, data: form }).unwrap();
                notify?.('success', `Category "${form.code}" updated`);
            } else {
                await createCategory(form).unwrap();
                notify?.('success', `Category "${form.code}" created`);
            }
            setDialogOpen(false);
        } catch (err) {
            notify?.('error', err?.data?.error || 'Could not save category');
        }
    };

    const handleDelete = async (cat) => {
        if (!window.confirm(
            `Delete category "${cat.code}"? Only possible when no plan types belong to it.`
        )) return;
        try {
            await deleteCategory(cat.id).unwrap();
            notify?.('success', `Category "${cat.code}" deleted`);
        } catch (err) {
            notify?.('error', err?.data?.error || 'Could not delete category');
        }
    };

    return (
        <Box sx={{ mt: 4, mb: 2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                    <Typography variant="h5">Market Categories</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Industry segments of the pricing site — each gets its own page
                        (/pricing/&lt;code&gt;) with its own hero copy and plan types.
                    </Typography>
                </Box>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog(null)}>
                    New category
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
                                <TableCell>Code</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Tagline</TableCell>
                                <TableCell>Headline</TableCell>
                                <TableCell align="center">Status</TableCell>
                                <TableCell align="right">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {categories.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6}>
                                        <Typography variant="body2" color="text.secondary">
                                            No categories yet.
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            )}
                            {categories.map((cat) => (
                                <TableRow key={cat.id} hover>
                                    <TableCell><code>{cat.code}</code></TableCell>
                                    <TableCell>{cat.name}</TableCell>
                                    <TableCell>{cat.tagline}</TableCell>
                                    <TableCell sx={{ maxWidth: 260 }}>
                                        <Typography variant="body2" noWrap>{cat.headline}</Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Stack direction="row" spacing={0.5} justifyContent="center">
                                            {cat.is_default && (
                                                <Chip size="small" icon={<StarIcon />} label="Default" color="primary" />
                                            )}
                                            {!cat.is_active && (
                                                <Chip size="small" label="Inactive" />
                                            )}
                                        </Stack>
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Edit">
                                            <IconButton size="small" onClick={() => openDialog(cat)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title={cat.is_default ? 'The default category cannot be deleted' : 'Delete'}>
                                            <span>
                                                <IconButton
                                                    size="small"
                                                    color="error"
                                                    disabled={cat.is_default}
                                                    onClick={() => handleDelete(cat)}
                                                >
                                                    <DeleteOutlineIcon fontSize="small" />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="sm">
                <DialogTitle>{editingId ? `Edit category: ${form.code}` : 'New category'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Code"
                                helperText={editingId
                                    ? 'Permanent — this is the page URL (/pricing/<code>)'
                                    : 'URL segment: /pricing/<code> — permanent once created'}
                                value={form.code}
                                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
                                disabled={Boolean(editingId)}
                                fullWidth
                            />
                            <TextField
                                label="Name"
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                fullWidth
                            />
                        </Stack>
                        <TextField
                            label="Tagline (hero chip)"
                            placeholder="For healthcare organizations"
                            value={form.tagline}
                            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
                            fullWidth
                        />
                        <TextField
                            label="Headline"
                            value={form.headline}
                            onChange={(e) => setForm({ ...form, headline: e.target.value })}
                            fullWidth
                        />
                        <TextField
                            label="Subheadline"
                            value={form.subheadline}
                            onChange={(e) => setForm({ ...form, subheadline: e.target.value })}
                            fullWidth
                            multiline
                            minRows={3}
                        />
                        <Stack direction="row" spacing={2} alignItems="center">
                            <TextField
                                label="Display order"
                                type="number"
                                value={form.display_order}
                                onChange={(e) => setForm({ ...form, display_order: e.target.value })}
                                sx={{ width: 140 }}
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={form.is_active}
                                        disabled={form.is_default}
                                        onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                                    />
                                }
                                label="Active"
                            />
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={form.is_default}
                                        onChange={(e) => setForm({
                                            ...form,
                                            is_default: e.target.checked,
                                            is_active: e.target.checked ? true : form.is_active,
                                        })}
                                    />
                                }
                                label="Default (bare /pricing)"
                            />
                        </Stack>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={creating || updating || !form.code || !form.name}
                    >
                        {editingId ? 'Save' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
