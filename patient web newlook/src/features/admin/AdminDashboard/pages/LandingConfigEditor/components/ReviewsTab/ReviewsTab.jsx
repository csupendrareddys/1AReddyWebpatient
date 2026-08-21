/**
 * ReviewsTab — admin CRUD for the Play-Store-style reviews carousel.
 *
 * Mounted as a tab inside ``LandingConfigEditor``. Each review has a
 * reviewer name + role + rating (1–5) + content + optional avatar.
 * Renders as a revolving carousel of cards above the trusted-brands
 * strip on the public landing page.
 */
import { useMemo, useState } from 'react';
import {
    Box, Card, CardContent, Typography, Button, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, TextField, Switch, Alert, Dialog,
    DialogTitle, DialogContent, DialogActions, Tooltip, Stack, CircularProgress,
    Rating, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import {
    useListLandingReviewsQuery,
    useCreateLandingReviewMutation,
    useUpdateLandingReviewMutation,
    useDeleteLandingReviewMutation,
    useReorderLandingReviewsMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import LogoUploader from '../../../../components/LogoUploader/LogoUploader';

const EMPTY = {
    reviewer_name: '', reviewer_role: '', rating: 5, content: '',
    avatar_asset_id: null, avatar_url: null, is_visible: true,
};

export default function ReviewsTab({ canEdit, canCreate, canDelete }) {
    const { data: items = [], isLoading } = useListLandingReviewsQuery();
    const [createItem, createState] = useCreateLandingReviewMutation();
    const [updateItem, updateState] = useUpdateLandingReviewMutation();
    const [deleteItem] = useDeleteLandingReviewMutation();
    const [reorderItems] = useReorderLandingReviewsMutation();

    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState(EMPTY);

    const isSaving = createState.isLoading || updateState.isLoading;

    const sorted = useMemo(
        () => [...items].sort((a, b) => (a.display_order || 0) - (b.display_order || 0)),
        [items],
    );

    const openCreate = () => {
        setEditing(null);
        setForm(EMPTY);
        setEditorOpen(true);
    };

    const openEdit = (item) => {
        setEditing(item);
        setForm({
            reviewer_name: item.reviewer_name || '',
            reviewer_role: item.reviewer_role || '',
            rating: item.rating ?? 5,
            content: item.content || '',
            avatar_asset_id: item.avatar_asset_id || null,
            avatar_url: item.avatar_url || null,
            is_visible: item.is_visible !== false,
        });
        setEditorOpen(true);
    };

    const handleSave = async () => {
        const payload = {
            reviewer_name: form.reviewer_name.trim(),
            reviewer_role: form.reviewer_role.trim() || null,
            // ``rating`` is null when the admin explicitly cleared it via
            // the dropdown — preserves "no stars on this card" on the
            // public render.
            rating: form.rating ?? null,
            content: form.content.trim(),
            avatar_asset_id: form.avatar_asset_id || null,
            is_visible: !!form.is_visible,
        };
        try {
            if (editing) {
                await updateItem({ reviewId: editing.id, data: payload }).unwrap();
            } else {
                await createItem({ ...payload, display_order: sorted.length }).unwrap();
            }
            setEditorOpen(false);
        } catch { /* surfaced below */ }
    };

    const handleToggleVisible = async (item) => {
        try {
            await updateItem({
                reviewId: item.id,
                data: { is_visible: !item.is_visible },
            }).unwrap();
        } catch { /* swallow */ }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`Delete review by "${item.reviewer_name}"?`)) return;
        try { await deleteItem(item.id).unwrap(); } catch { /* swallow */ }
    };

    const moveItem = async (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= sorted.length) return;
        const reordered = [...sorted];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(target, 0, moved);
        try {
            await reorderItems(
                reordered.map((it, i) => ({ id: it.id, display_order: i })),
            ).unwrap();
        } catch { /* swallow */ }
    };

    const formError = (() => {
        if (!form.reviewer_name.trim()) return 'Reviewer name is required.';
        if (!form.content.trim()) return 'Review content is required.';
        if (form.reviewer_name.trim().length > 200) return 'Reviewer name must be 200 chars or fewer.';
        return null;
    })();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card>
                <CardContent>
                    <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                        <Typography variant="h6">Client reviews</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="contained" startIcon={<AddIcon />}
                            onClick={openCreate} disabled={!canCreate}
                        >
                            New review
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                        Revolving carousel of review cards (Play-Store-style) above the
                        trusted-brands strip. Set the section heading via
                        <code> reviews_section_title </code> in the Editor tab.
                    </Typography>

                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={110}>Order</TableCell>
                                <TableCell>Reviewer</TableCell>
                                <TableCell width={120}>Rating</TableCell>
                                <TableCell>Content</TableCell>
                                <TableCell align="center" width={90}>Visible</TableCell>
                                <TableCell align="right" width={120}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {isLoading && (
                                <TableRow>
                                    <TableCell colSpan={6} align="center">
                                        <CircularProgress size={24} sx={{ my: 2 }} />
                                    </TableCell>
                                </TableRow>
                            )}
                            {!isLoading && sorted.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} sx={{ color: 'text.secondary', py: 4 }} align="center">
                                        No reviews yet — click "New review" to add one.
                                    </TableCell>
                                </TableRow>
                            )}
                            {sorted.map((item, idx) => (
                                <TableRow key={item.id} hover>
                                    <TableCell>
                                        <IconButton size="small" disabled={!canEdit || idx === 0}
                                            onClick={() => moveItem(idx, -1)}>
                                            <ArrowUpwardIcon fontSize="inherit" />
                                        </IconButton>
                                        <IconButton size="small" disabled={!canEdit || idx === sorted.length - 1}
                                            onClick={() => moveItem(idx, 1)}>
                                            <ArrowDownwardIcon fontSize="inherit" />
                                        </IconButton>
                                    </TableCell>
                                    <TableCell>
                                        <Typography fontWeight={600}>{item.reviewer_name}</Typography>
                                        {item.reviewer_role && (
                                            <Typography variant="caption" color="text.secondary">
                                                {item.reviewer_role}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {item.rating ? (
                                            <Rating value={item.rating} readOnly size="small" />
                                        ) : (
                                            <Typography variant="caption" color="text.disabled">no rating</Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary"
                                            sx={{
                                                display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                maxWidth: 360,
                                            }}>
                                            {item.content}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Switch size="small" checked={!!item.is_visible}
                                            disabled={!canEdit} onChange={() => handleToggleVisible(item)} />
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Edit">
                                            <IconButton onClick={() => openEdit(item)} disabled={!canEdit}>
                                                <EditIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <span>
                                                <IconButton color="error"
                                                    onClick={() => handleDelete(item)}
                                                    disabled={!canDelete}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    </TableContainer>
                </CardContent>
            </Card>

            <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? 'Edit review' : 'New review'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2.5}>
                        <LogoUploader
                            currentUrl={form.avatar_url}
                            onChange={(assetId) => setForm((p) => ({
                                ...p, avatar_asset_id: assetId,
                                avatar_url: assetId ? p.avatar_url : null,
                            }))}
                            label="Reviewer avatar (optional)"
                            assetType="avatar"
                        />
                        <TextField
                            fullWidth size="small" label="Reviewer name" required
                            value={form.reviewer_name}
                            onChange={(e) => setForm((p) => ({ ...p, reviewer_name: e.target.value }))}
                        />
                        <TextField
                            fullWidth size="small" label="Reviewer role / location (optional)"
                            placeholder="e.g. Patient, Bangalore"
                            value={form.reviewer_role}
                            onChange={(e) => setForm((p) => ({ ...p, reviewer_role: e.target.value }))}
                        />
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                Star rating
                            </Typography>
                            <Stack direction="row" spacing={1.5} alignItems="center">
                                <Rating
                                    value={form.rating ?? 0}
                                    onChange={(_, v) => setForm((p) => ({ ...p, rating: v || null }))}
                                />
                                <Button
                                    size="small" variant="text"
                                    onClick={() => setForm((p) => ({ ...p, rating: null }))}
                                    disabled={form.rating == null}
                                >
                                    No rating
                                </Button>
                            </Stack>
                        </Box>
                        <TextField
                            fullWidth size="small" label="Review content" required
                            multiline minRows={3} maxRows={6}
                            value={form.content}
                            onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                        />
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch size="small" checked={!!form.is_visible}
                                onChange={(e) => setForm((p) => ({ ...p, is_visible: e.target.checked }))} />
                            <Typography variant="body2">Visible on public landing</Typography>
                        </Stack>
                        {formError && <Alert severity="warning">{formError}</Alert>}
                        {(createState.error || updateState.error) && (
                            <Alert severity="error">
                                {extractError(createState.error || updateState.error)}
                            </Alert>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSave}
                        disabled={isSaving || !!formError}
                        startIcon={isSaving ? <CircularProgress size={16} /> : null}>
                        {editing ? 'Save changes' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

function extractError(rtkError) {
    if (!rtkError) return 'Save failed.';
    const env = rtkError.data || rtkError;
    if (env?.errors && typeof env.errors === 'object') {
        return Object.entries(env.errors)
            .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`)
            .join(' • ');
    }
    if (typeof env?.error === 'string') return env.error;
    if (typeof env?.message === 'string') return env.message;
    return `Save failed (${rtkError.status || 'unknown'}).`;
}
