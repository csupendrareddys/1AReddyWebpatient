/**
 * RecognitionsTab — admin CRUD for the recognitions / accreditations
 * carousel rendered directly below the hero on the public landing page.
 *
 * Mounted as a tab inside ``LandingConfigEditor``. This is the only place
 * the recognitions collection is edited — the legacy standalone manager
 * page has been removed.
 *
 * Edits go LIVE immediately — no draft / preview / publish wrapper. The
 * heavier lifecycle is reserved for hero + modules + features.
 */
import { useMemo, useState } from 'react';
import {
    Box, Card, CardContent, Typography, Button, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, TextField, Switch, Alert, Dialog,
    DialogTitle, DialogContent, DialogActions, Tooltip, Stack, CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import {
    useListLandingRecognitionsQuery,
    useCreateLandingRecognitionMutation,
    useUpdateLandingRecognitionMutation,
    useDeleteLandingRecognitionMutation,
    useReorderLandingRecognitionsMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import {
    useListPlatformLandingRecognitionsQuery,
    useCreatePlatformLandingRecognitionMutation,
    useUpdatePlatformLandingRecognitionMutation,
    useDeletePlatformLandingRecognitionMutation,
} from '../../../../../api/platformLandingEndpoints';
import LogoUploader from '../../../../components/LogoUploader/LogoUploader';

const EMPTY = {
    title: '', subtitle: '', description: '',
    logo_asset_id: null, logo_url: null, is_visible: true,
};

export default function RecognitionsTab({
    canEdit, canCreate, canDelete, mode = 'tenant', scope = 'marketing',
}) {
    const isPlatform = mode === 'platform';

    // Subscribe to both endpoint families and gate with ``skip`` so the
    // hook order stays stable across renders.
    const tenantList = useListLandingRecognitionsQuery(undefined, { skip: isPlatform });
    const platformList = useListPlatformLandingRecognitionsQuery(scope, { skip: !isPlatform });
    const items = (isPlatform ? platformList.data : tenantList.data) || [];
    const isLoading = isPlatform ? platformList.isLoading : tenantList.isLoading;

    const [createTenant, createTenantState] = useCreateLandingRecognitionMutation();
    const [updateTenant, updateTenantState] = useUpdateLandingRecognitionMutation();
    const [deleteTenant] = useDeleteLandingRecognitionMutation();
    const [reorderTenant] = useReorderLandingRecognitionsMutation();
    const [createPlatform, createPlatformState] = useCreatePlatformLandingRecognitionMutation();
    const [updatePlatform, updatePlatformState] = useUpdatePlatformLandingRecognitionMutation();
    const [deletePlatform] = useDeletePlatformLandingRecognitionMutation();

    // Platform create takes ``{ scope, data }``; tenant takes the payload
    // directly. Wrap to a uniform ``createItem(payload)`` signature so the
    // existing call sites below stay unchanged.
    const createItem = isPlatform
        ? (payload) => createPlatform({ scope, data: payload })
        : createTenant;
    const updateItem = isPlatform ? updatePlatform : updateTenant;
    const deleteItem = isPlatform ? deletePlatform : deleteTenant;
    const createState = isPlatform ? createPlatformState : createTenantState;
    const updateState = isPlatform ? updatePlatformState : updateTenantState;
    // Platform recognitions don't have a reorder endpoint (the order is
    // managed via display_order on update). Disable the up/down buttons
    // there and skip the call entirely.
    const supportsReorder = !isPlatform;

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
            title: item.title || '',
            subtitle: item.subtitle || '',
            description: item.description || '',
            logo_asset_id: item.logo_asset_id || null,
            logo_url: item.logo_url || null,
            is_visible: item.is_visible !== false,
        });
        setEditorOpen(true);
    };

    const handleSave = async () => {
        const payload = {
            title: form.title.trim(),
            subtitle: form.subtitle.trim() || null,
            description: form.description.trim() || null,
            logo_asset_id: form.logo_asset_id || null,
            is_visible: !!form.is_visible,
        };
        try {
            if (editing) {
                await updateItem({ recognitionId: editing.id, data: payload }).unwrap();
            } else {
                await createItem({ ...payload, display_order: sorted.length }).unwrap();
            }
            setEditorOpen(false);
        } catch { /* shown via mutation state */ }
    };

    const handleToggleVisible = async (item) => {
        try {
            await updateItem({
                recognitionId: item.id,
                data: { is_visible: !item.is_visible },
            }).unwrap();
        } catch { /* swallow */ }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`Delete recognition "${item.title}"?`)) return;
        try { await deleteItem(item.id).unwrap(); } catch { /* swallow */ }
    };

    const moveItem = async (index, direction) => {
        if (!supportsReorder) return;
        const target = index + direction;
        if (target < 0 || target >= sorted.length) return;
        const reordered = [...sorted];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(target, 0, moved);
        try {
            await reorderTenant(
                reordered.map((it, i) => ({ id: it.id, display_order: i })),
            ).unwrap();
        } catch { /* swallow */ }
    };

    const formError = (() => {
        const t = form.title.trim();
        if (!t) return 'Title is required.';
        if (t.length > 200) return 'Title must be 200 characters or fewer.';
        return null;
    })();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card>
                <CardContent>
                    <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                        <Typography variant="h6">Recognitions & Accreditations</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="contained" startIcon={<AddIcon />}
                            onClick={openCreate} disabled={!canCreate}
                        >
                            New recognition
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                        Carousel shown directly below the hero on the public landing page.
                        Each card has a logo, title, optional subtitle and description.
                        Edits go live immediately — no preview / publish step required.
                    </Typography>

                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={110}>Order</TableCell>
                                <TableCell width={80}>Logo</TableCell>
                                <TableCell>Title</TableCell>
                                <TableCell>Subtitle</TableCell>
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
                                        No recognitions yet — click "New recognition" to add the first one.
                                        The section won't appear on the public site until at least one is visible.
                                    </TableCell>
                                </TableRow>
                            )}
                            {sorted.map((item, idx) => (
                                <TableRow key={item.id} hover>
                                    <TableCell>
                                        <IconButton
                                            size="small"
                                            disabled={!canEdit || !supportsReorder || idx === 0}
                                            onClick={() => moveItem(idx, -1)}
                                        >
                                            <ArrowUpwardIcon fontSize="inherit" />
                                        </IconButton>
                                        <IconButton
                                            size="small"
                                            disabled={!canEdit || !supportsReorder || idx === sorted.length - 1}
                                            onClick={() => moveItem(idx, 1)}
                                        >
                                            <ArrowDownwardIcon fontSize="inherit" />
                                        </IconButton>
                                    </TableCell>
                                    <TableCell>
                                        {item.logo_url ? (
                                            <Box
                                                component="img"
                                                src={item.logo_url}
                                                alt={item.title}
                                                sx={{
                                                    width: 48, height: 48, borderRadius: 1,
                                                    objectFit: 'contain', bgcolor: 'grey.50',
                                                    p: 0.5, border: '1px solid', borderColor: 'grey.200',
                                                }}
                                            />
                                        ) : (
                                            <Box sx={{
                                                width: 48, height: 48, borderRadius: 1,
                                                bgcolor: 'grey.100',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'text.disabled', fontSize: '0.7rem',
                                            }}>—</Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography fontWeight={600}>{item.title}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary">
                                            {item.subtitle || '—'}
                                        </Typography>
                                    </TableCell>
                                    <TableCell align="center">
                                        <Switch
                                            size="small" checked={!!item.is_visible}
                                            disabled={!canEdit}
                                            onChange={() => handleToggleVisible(item)}
                                        />
                                    </TableCell>
                                    <TableCell align="right">
                                        <Tooltip title="Edit">
                                            <IconButton onClick={() => openEdit(item)} disabled={!canEdit}>
                                                <EditIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete">
                                            <span>
                                                <IconButton
                                                    color="error"
                                                    onClick={() => handleDelete(item)}
                                                    disabled={!canDelete}
                                                >
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
                <DialogTitle>
                    {editing ? 'Edit recognition' : 'New recognition'}
                </DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2.5}>
                        <LogoUploader
                            currentUrl={form.logo_url}
                            onChange={(assetId) => setForm((p) => ({
                                ...p, logo_asset_id: assetId,
                                logo_url: assetId ? p.logo_url : null,
                            }))}
                            label="Recognition logo"
                            disabled={!canEdit && !!editing}
                        />
                        <TextField
                            fullWidth size="small" label="Title" required
                            value={form.title}
                            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                            error={!!formError && !form.title.trim()}
                            helperText={formError && !form.title.trim() ? formError : ' '}
                        />
                        <TextField
                            fullWidth size="small" label="Subtitle (optional)"
                            placeholder="e.g. ISO 9001 certified"
                            value={form.subtitle}
                            onChange={(e) => setForm((p) => ({ ...p, subtitle: e.target.value }))}
                        />
                        <TextField
                            fullWidth size="small" label="Description (optional)"
                            multiline minRows={2} maxRows={4}
                            value={form.description}
                            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                        />
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch
                                size="small"
                                checked={!!form.is_visible}
                                onChange={(e) => setForm((p) => ({ ...p, is_visible: e.target.checked }))}
                            />
                            <Typography variant="body2">Visible on public landing</Typography>
                        </Stack>

                        {(createState.error || updateState.error) && (
                            <Alert severity="error">
                                {extractError(createState.error || updateState.error)}
                            </Alert>
                        )}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSave}
                        disabled={isSaving || !!formError}
                        startIcon={isSaving ? <CircularProgress size={16} /> : null}
                    >
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
