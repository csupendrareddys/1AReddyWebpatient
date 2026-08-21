/**
 * BrandsTab — admin CRUD for the "Trusted by global brands" logo strip.
 *
 * Mounted as a tab inside ``LandingConfigEditor``. Each brand has a name
 * (used as alt text), a logo upload, and an optional click-through URL.
 * Renders as a logo-only sliding strip immediately above the footer on
 * the public landing page.
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
    useListLandingTrustedBrandsQuery,
    useCreateLandingTrustedBrandMutation,
    useUpdateLandingTrustedBrandMutation,
    useDeleteLandingTrustedBrandMutation,
    useReorderLandingTrustedBrandsMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import LogoUploader from '../../../../components/LogoUploader/LogoUploader';

const EMPTY = {
    name: '', logo_asset_id: null, logo_url: null, link_url: '', is_visible: true,
};

const URL_RE = /^https?:\/\/[^\s]+$/;

export default function BrandsTab({ canEdit, canCreate, canDelete }) {
    const { data: items = [], isLoading } = useListLandingTrustedBrandsQuery();
    const [createItem, createState] = useCreateLandingTrustedBrandMutation();
    const [updateItem, updateState] = useUpdateLandingTrustedBrandMutation();
    const [deleteItem] = useDeleteLandingTrustedBrandMutation();
    const [reorderItems] = useReorderLandingTrustedBrandsMutation();

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
            name: item.name || '',
            logo_asset_id: item.logo_asset_id || null,
            logo_url: item.logo_url || null,
            link_url: item.link_url || '',
            is_visible: item.is_visible !== false,
        });
        setEditorOpen(true);
    };

    const handleSave = async () => {
        const payload = {
            name: form.name.trim(),
            logo_asset_id: form.logo_asset_id || null,
            link_url: form.link_url.trim() || null,
            is_visible: !!form.is_visible,
        };
        try {
            if (editing) {
                await updateItem({ brandId: editing.id, data: payload }).unwrap();
            } else {
                await createItem({ ...payload, display_order: sorted.length }).unwrap();
            }
            setEditorOpen(false);
        } catch { /* surfaced below */ }
    };

    const handleToggleVisible = async (item) => {
        try {
            await updateItem({
                brandId: item.id,
                data: { is_visible: !item.is_visible },
            }).unwrap();
        } catch { /* swallow */ }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`Delete brand "${item.name}"?`)) return;
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
        const t = form.name.trim();
        if (!t) return 'Brand name is required (used as logo alt-text).';
        const url = form.link_url.trim();
        if (url && !URL_RE.test(url)) return 'Link URL must start with http:// or https://';
        return null;
    })();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card>
                <CardContent>
                    <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                        <Typography variant="h6">Trusted by global brands</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="contained" startIcon={<AddIcon />}
                            onClick={openCreate} disabled={!canCreate}
                        >
                            New brand
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                        Logo-only sliding strip immediately above the footer. Set the
                        section heading via <code>brands_section_title</code> in the
                        Editor tab's Page Configuration.
                    </Typography>

                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={110}>Order</TableCell>
                                <TableCell width={100}>Logo</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Link</TableCell>
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
                                        No brands yet — click "New brand" to add one.
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
                                        {item.logo_url ? (
                                            <Box component="img" src={item.logo_url} alt={item.name}
                                                sx={{
                                                    width: 80, height: 40, objectFit: 'contain',
                                                    bgcolor: 'grey.50', p: 0.5, borderRadius: 1,
                                                    border: '1px solid', borderColor: 'grey.200',
                                                }} />
                                        ) : (
                                            <Box sx={{
                                                width: 80, height: 40, borderRadius: 1,
                                                bgcolor: 'grey.100',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'text.disabled', fontSize: '0.7rem',
                                            }}>—</Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography fontWeight={600}>{item.name}</Typography>
                                    </TableCell>
                                    <TableCell>
                                        {item.link_url ? (
                                            <Typography variant="caption" color="primary.main"
                                                sx={{ wordBreak: 'break-all', maxWidth: 240, display: 'inline-block' }}>
                                                {item.link_url}
                                            </Typography>
                                        ) : (
                                            <Typography variant="caption" color="text.disabled">—</Typography>
                                        )}
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
                <DialogTitle>{editing ? 'Edit brand' : 'New brand'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2.5}>
                        <LogoUploader
                            currentUrl={form.logo_url}
                            onChange={(assetId) => setForm((p) => ({
                                ...p, logo_asset_id: assetId,
                                logo_url: assetId ? p.logo_url : null,
                            }))}
                            label="Brand logo"
                            assetType="brand_logo"
                        />
                        <TextField
                            fullWidth size="small" label="Brand name" required
                            placeholder="Used as alt-text on the logo"
                            value={form.name}
                            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                        />
                        <TextField
                            fullWidth size="small" label="Link URL (optional)"
                            placeholder="https://www.acme.com"
                            value={form.link_url}
                            onChange={(e) => setForm((p) => ({ ...p, link_url: e.target.value }))}
                            helperText="Where to send users when they click the logo."
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
