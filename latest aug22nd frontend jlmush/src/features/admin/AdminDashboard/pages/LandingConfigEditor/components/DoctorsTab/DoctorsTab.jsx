/**
 * DoctorsTab — admin CRUD for the "Meet our doctors" carousel.
 *
 * Mounted as a tab inside ``LandingConfigEditor``. Edits go LIVE
 * immediately. Each doctor has photo + name + specialty + qualifications
 * + bio. The public landing renders these in a slow auto-rotating
 * carousel above the reviews section.
 *
 * Section title comes from ``LandingConfig.doctors_section_title`` (set
 * in the Editor tab's Page Configuration table) — empty → falls back to
 * "Meet Our Doctors" on the public side.
 */
import { useMemo, useState } from 'react';
import {
    Box, Card, CardContent, Typography, Button, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, TextField, Switch, Alert, Dialog,
    DialogTitle, DialogContent, DialogActions, Tooltip, Stack, CircularProgress,
    Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import {
    useListLandingDoctorsQuery,
    useCreateLandingDoctorMutation,
    useUpdateLandingDoctorMutation,
    useDeleteLandingDoctorMutation,
    useReorderLandingDoctorsMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import {
    useGetDoctorsQuery,
    useUpdateDoctorLandingPopularMutation,
} from '../../../../../api/doctorsEndpoints';
import LogoUploader from '../../../../components/LogoUploader/LogoUploader';

const EMPTY = {
    name: '', specialty: '', qualifications: '', bio: '',
    photo_asset_id: null, photo_url: null, is_visible: true,
};

export default function DoctorsTab({ canEdit, canCreate, canDelete }) {
    const { data: items = [], isLoading } = useListLandingDoctorsQuery();
    const [createItem, createState] = useCreateLandingDoctorMutation();
    const [updateItem, updateState] = useUpdateLandingDoctorMutation();
    const [deleteItem] = useDeleteLandingDoctorMutation();
    const [reorderItems] = useReorderLandingDoctorsMutation();

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
            specialty: item.specialty || '',
            qualifications: item.qualifications || '',
            bio: item.bio || '',
            photo_asset_id: item.photo_asset_id || null,
            photo_url: item.photo_url || null,
            is_visible: item.is_visible !== false,
        });
        setEditorOpen(true);
    };

    const handleSave = async () => {
        const payload = {
            name: form.name.trim(),
            specialty: form.specialty.trim() || null,
            qualifications: form.qualifications.trim() || null,
            bio: form.bio.trim() || null,
            photo_asset_id: form.photo_asset_id || null,
            is_visible: !!form.is_visible,
        };
        try {
            if (editing) {
                await updateItem({ doctorId: editing.id, data: payload }).unwrap();
            } else {
                await createItem({ ...payload, display_order: sorted.length }).unwrap();
            }
            setEditorOpen(false);
        } catch { /* surfaced via mutation state below */ }
    };

    const handleToggleVisible = async (item) => {
        try {
            await updateItem({
                doctorId: item.id,
                data: { is_visible: !item.is_visible },
            }).unwrap();
        } catch { /* swallow */ }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`Delete doctor "${item.name}"?`)) return;
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
        if (!t) return 'Name is required.';
        if (t.length > 200) return 'Name must be 200 characters or fewer.';
        return null;
    })();

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Card>
                <CardContent>
                    <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                        <Typography variant="h6">Meet our doctors</Typography>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            variant="contained" startIcon={<AddIcon />}
                            onClick={openCreate} disabled={!canCreate}
                        >
                            New doctor
                        </Button>
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                        Slow auto-rotating carousel rendered above the Reviews section.
                        To rename the section heading, edit
                        <code> doctors_section_title </code> in the Editor tab's Page Configuration.
                    </Typography>

                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={110}>Order</TableCell>
                                <TableCell width={80}>Photo</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Specialty</TableCell>
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
                                        No doctors yet — click "New doctor" to add one. The section
                                        won't appear on the public site until at least one is visible.
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
                                        {item.photo_url ? (
                                            <Box component="img" src={item.photo_url} alt={item.name}
                                                sx={{
                                                    width: 48, height: 48, borderRadius: '50%',
                                                    objectFit: 'cover', bgcolor: 'grey.50',
                                                    border: '1px solid', borderColor: 'grey.200',
                                                }} />
                                        ) : (
                                            <Box sx={{
                                                width: 48, height: 48, borderRadius: '50%',
                                                bgcolor: 'grey.100',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'text.disabled', fontSize: '0.7rem',
                                            }}>—</Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography fontWeight={600}>{item.name}</Typography>
                                        {item.qualifications && (
                                            <Typography variant="caption" color="text.secondary">
                                                {item.qualifications}
                                            </Typography>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="body2" color="text.secondary">
                                            {item.specialty || '—'}
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

            <BookingDoctorsSection canEdit={canEdit} />

            <Dialog open={editorOpen} onClose={() => setEditorOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>{editing ? 'Edit doctor' : 'New doctor'}</DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2.5}>
                        <LogoUploader
                            currentUrl={form.photo_url}
                            onChange={(assetId) => setForm((p) => ({
                                ...p, photo_asset_id: assetId,
                                photo_url: assetId ? p.photo_url : null,
                            }))}
                            label="Doctor photo"
                            assetType="photo"
                        />
                        <TextField
                            fullWidth size="small" label="Name" required
                            value={form.name}
                            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                            error={!!formError && !form.name.trim()}
                            helperText={formError && !form.name.trim() ? formError : ' '}
                        />
                        <TextField
                            fullWidth size="small" label="Specialty (optional)"
                            placeholder="e.g. Cardiology"
                            value={form.specialty}
                            onChange={(e) => setForm((p) => ({ ...p, specialty: e.target.value }))}
                        />
                        <TextField
                            fullWidth size="small" label="Qualifications (optional)"
                            placeholder="e.g. MBBS, MD"
                            value={form.qualifications}
                            onChange={(e) => setForm((p) => ({ ...p, qualifications: e.target.value }))}
                        />
                        <TextField
                            fullWidth size="small" label="Bio (optional)"
                            multiline minRows={2} maxRows={5}
                            value={form.bio}
                            onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
                        />
                        <Stack direction="row" alignItems="center" spacing={1}>
                            <Switch size="small" checked={!!form.is_visible}
                                onChange={(e) => setForm((p) => ({ ...p, is_visible: e.target.checked }))} />
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

/**
 * BookingDoctorsSection — curate which REAL doctors appear in the public
 * "Book a slot" widget. Distinct from the marketing "Meet our doctors"
 * carousel above: these are actual bookable Doctor accounts, toggled via
 * the ``is_popular`` flag. Only doctors that are BOTH published (active)
 * AND toggled on here surface on the landing; the full published directory
 * stays bookable after login. The doctor never sees this flag.
 */
function BookingDoctorsSection({ canEdit }) {
    const { data, isLoading } = useGetDoctorsQuery({ per_page: 100 });
    const [updatePopular] = useUpdateDoctorLandingPopularMutation();
    const doctors = data?.doctors || [];

    const toggle = async (doc, checked) => {
        try {
            await updatePopular({ doctorId: doc.id, isPopular: checked }).unwrap();
        } catch { /* swallow — RTK cache reverts on error */ }
    };

    return (
        <Card>
            <CardContent>
                <Typography variant="h6">Booking widget — featured doctors</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
                    Choose which doctors appear in the public "Book a slot" widget. Only doctors
                    that are <strong>published (active)</strong> AND toggled on here show up; the
                    full directory stays bookable after login. Doctors don't see this setting.
                </Typography>
                <TableContainer>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>Publish status</TableCell>
                            <TableCell align="center" width={130}>Show in booking</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading && (
                            <TableRow>
                                <TableCell colSpan={3} align="center">
                                    <CircularProgress size={24} sx={{ my: 2 }} />
                                </TableCell>
                            </TableRow>
                        )}
                        {!isLoading && doctors.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                                    No doctors in this tenant yet.
                                </TableCell>
                            </TableRow>
                        )}
                        {doctors.map((doc) => (
                            <TableRow key={doc.id} hover>
                                <TableCell>
                                    <Typography fontWeight={600}>
                                        {doc.first_name} {doc.last_name}
                                    </Typography>
                                    {doc.email && (
                                        <Typography variant="caption" color="text.secondary">
                                            {doc.email}
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <Chip
                                        size="small"
                                        label={doc.publish_status || 'inactive'}
                                        color={doc.publish_status === 'active' ? 'success' : 'default'}
                                        variant={doc.publish_status === 'active' ? 'filled' : 'outlined'}
                                    />
                                </TableCell>
                                <TableCell align="center">
                                    <Tooltip
                                        title={doc.publish_status === 'active'
                                            ? ''
                                            : 'Not published — won\'t show until publish status is active'}
                                    >
                                        <span>
                                            <Switch
                                                size="small"
                                                checked={!!doc.is_popular}
                                                disabled={!canEdit}
                                                onChange={(e) => toggle(doc, e.target.checked)}
                                            />
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
