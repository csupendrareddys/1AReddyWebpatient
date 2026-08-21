/**
 * EntityDetailsSection — edit the account's entity type + core legal-entity
 * fields from the profile. Shown as an "Entity Details" tab for clinic/hospital
 * (and corporate patient) accounts. Registers its save handler with the parent
 * ProfileSetting so the sticky footer Save button drives it.
 *
 * Phase 1: entity type + text fields. Logos, document attachments and
 * authorized personnel are layered on later.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import {
    Box, Paper, Typography, LinearProgress, Snackbar, Alert, Button,
    Stack, Chip, Divider, Link, Avatar, CircularProgress, IconButton,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import UploadIcon from '@mui/icons-material/Upload';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';

import axiosInstance from '../../../../api/axiosConfig';
import EntityCoreFields from '../../../../common/components/EntityCoreFields/EntityCoreFields';

const DOC_VERIF_COLOR = { verified: 'success', pending: 'warning', rejected: 'error' };
const IMAGE_KINDS = [
    { kind: 'logo', label: 'Logo' },
    { kind: 'entity_logo', label: 'Entity Logo' },
    { kind: 'entity_image', label: 'Entity Image' },
];
const DOC_KINDS = [
    { kind: 'registration_license', label: 'Registration / License' },
    { kind: 'cin', label: 'CIN' },
    { kind: 'gst', label: 'GST' },
    { kind: 'pan', label: 'PAN' },
];

/** Circular image tile with an upload (camera) button. */
function ImageTile({ label, url, busy, onPick }) {
    const ref = useRef(null);
    return (
        <Stack alignItems="center" spacing={0.5}>
            <Box sx={{ position: 'relative', width: 84, height: 84 }}>
                <Avatar src={url || undefined} variant="rounded" sx={{ width: 84, height: 84, border: '1px solid #e0e0e0' }}>
                    {label[0]}
                </Avatar>
                <IconButton
                    size="small" disabled={busy}
                    onClick={() => ref.current?.click()}
                    sx={{ position: 'absolute', bottom: -6, right: -6, bgcolor: 'primary.main', color: '#fff', width: 28, height: 28, '&:hover': { bgcolor: 'primary.dark' } }}
                >
                    {busy ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PhotoCameraIcon fontSize="small" />}
                </IconButton>
                <input ref={ref} type="file" accept="image/*" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
            </Box>
            <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Stack>
    );
}
// Scoped hooks: identical behaviour for a clinic/hospital/patient editing
// their own entity, but they also honour BOTH Operations act-on-behalf scopes,
// so this same section serves the admin's view of a patient profile AND of a
// clinic or hospital. See ../api/scopedEntityApi.
import {
    useGetMyEntityProfileQuery,
    useUpdateMyEntityProfileMutation,
} from '../api/scopedEntityApi';
import {
    useGetMyEntitiesQuery,
    useCreateMyEntityMutation,
    useSetPrimaryEntityMutation,
    useDeleteMyEntityMutation,
} from '../api/entityProfileEndpoints';

const EMPTY = {
    entity_type: 'individual', entity_name: '', legal_name: '', trade_name: '',
    promoters: '', year_of_establishment: '',
    registration_license_number: '', cin_number: '', gst_number: '', pan_number: '',
};

export default function EntityDetailsSection({ registerSave }) {
    const { data, isLoading, refetch } = useGetMyEntityProfileQuery();
    const [save, { isLoading: saving }] = useUpdateMyEntityProfileMutation();

    // Multiple entities per owner; the primary is the active one edited above.
    const { data: entities = [], refetch: refetchEntities } = useGetMyEntitiesQuery();
    const [createEntity, { isLoading: creating }] = useCreateMyEntityMutation();
    const [setPrimary] = useSetPrimaryEntityMutation();
    const [deleteEntity] = useDeleteMyEntityMutation();

    const [values, setValues] = useState(EMPTY);
    const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });
    const [busyKind, setBusyKind] = useState(null);

    const refreshAll = useCallback(async () => {
        await Promise.all([refetch(), refetchEntities()]);
    }, [refetch, refetchEntities]);

    const onAddEntity = useCallback(async () => {
        try {
            await createEntity({ copy_from_primary: true }).unwrap();
            await refetchEntities();
            setSnack({ open: true, severity: 'success', message: 'Entity added (copied from primary).' });
        } catch {
            setSnack({ open: true, severity: 'error', message: 'Could not add entity.' });
        }
    }, [createEntity, refetchEntities]);

    const onMakePrimary = useCallback(async (id) => {
        try {
            await setPrimary(id).unwrap();
            await refreshAll();
            setSnack({ open: true, severity: 'success', message: 'Primary entity updated.' });
        } catch {
            setSnack({ open: true, severity: 'error', message: 'Could not set primary.' });
        }
    }, [setPrimary, refreshAll]);

    const onDeleteEntity = useCallback(async (id) => {
        try {
            await deleteEntity(id).unwrap();
            await refetchEntities();
            setSnack({ open: true, severity: 'success', message: 'Entity removed.' });
        } catch (e) {
            setSnack({
                open: true, severity: 'error',
                message: e?.data?.message || e?.data?.error || 'Could not remove entity.',
            });
        }
    }, [deleteEntity, refetchEntities]);

    const uploadMedia = useCallback(async (endpoint, kind, file, extra = {}) => {
        setBusyKind(kind);
        try {
            const fd = new FormData();
            fd.append('kind', kind);
            fd.append('file', file);
            Object.entries(extra).forEach(([k, v]) => v != null && fd.append(k, v));
            await axiosInstance.post(`/api/entity-profile/me/${endpoint}`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            await refetch();
            setSnack({ open: true, severity: 'success', message: 'Uploaded.' });
        } catch (err) {
            setSnack({
                open: true, severity: 'error',
                message: err?.response?.data?.error || err?.response?.data?.message || 'Upload failed.',
            });
        } finally {
            setBusyKind(null);
        }
    }, [refetch]);

    useEffect(() => {
        if (!data) return;
        setValues({
            entity_type: data.entity_type || 'individual',
            entity_name: data.entity_name || '',
            legal_name: data.legal_name || '',
            trade_name: data.trade_name || '',
            promoters: (data.promoters || []).join(', '),
            year_of_establishment: data.year_of_establishment || '',
            registration_license_number: data.registration_license?.number || '',
            cin_number: data.cin?.number || '',
            gst_number: data.gst?.number || '',
            pan_number: data.pan?.number || '',
        });
    }, [data]);

    const onChange = (e) => setValues((p) => ({ ...p, [e.target.name]: e.target.value }));

    const doSave = useCallback(async () => {
        try {
            await save({
                entity_type: values.entity_type,
                entity_name: values.entity_name || null,
                legal_name: values.legal_name || null,
                trade_name: values.trade_name || null,
                promoters: values.promoters
                    ? values.promoters.split(',').map((s) => s.trim()).filter(Boolean) : [],
                year_of_establishment: values.year_of_establishment
                    ? Number(values.year_of_establishment) : null,
                registration_license_number: values.registration_license_number || null,
                cin_number: values.cin_number || null,
                gst_number: values.gst_number || null,
                pan_number: values.pan_number || null,
            }).unwrap();
            setSnack({ open: true, severity: 'success', message: 'Entity details saved.' });
        } catch (err) {
            setSnack({
                open: true, severity: 'error',
                message: err?.data?.message || err?.data?.error || 'Failed to save.',
            });
        }
    }, [values, save]);

    // In the doctor profile page a sticky footer Save button drives the active
    // section via registerSave. When mounted standalone (e.g. the patient
    // profile) there's no footer, so we render our own Save button below.
    useEffect(() => {
        if (registerSave) registerSave(doSave, 'Save Entity Details', saving);
    }, [registerSave, doSave, saving]);

    return (
        <Box>
            {isLoading && <LinearProgress sx={{ mb: 2 }} />}

            {/* ── Entities: multiple per owner, one primary (active) ──────
                Always render the panel — hiding it when the list is empty (or
                a fetch hiccups) also hid the ONLY "+ Add entity" affordance, so
                a second entity could never be created. Show it unconditionally;
                an empty list just reads "Entities (0)". */}
            {!isLoading && (
                <Paper sx={{ p: 2, mb: 2 }}>
                    <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>
                            Entities ({entities.length})
                        </Typography>
                        <Button size="small" variant="outlined" onClick={onAddEntity} disabled={creating}>
                            + Add entity
                        </Button>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                        The primary entity is the active one used across the app. Editing
                        below applies to the primary.
                    </Typography>
                    <Stack spacing={1} sx={{ mt: 1.5 }}>
                        {entities.map((e) => (
                            <Stack
                                key={e.id}
                                direction="row"
                                spacing={1}
                                alignItems="center"
                                sx={{ flexWrap: 'wrap', gap: 1 }}
                            >
                                <Typography sx={{ minWidth: 200 }}>
                                    {e.entity_name || e.legal_name || '(unnamed entity)'}
                                </Typography>
                                <Chip size="small" variant="outlined"
                                    label={(e.entity_type || 'individual').replace(/_/g, ' ')} />
                                {e.is_primary
                                    ? <Chip size="small" color="primary" label="PRIMARY" />
                                    : (
                                        <Button size="small" onClick={() => onMakePrimary(e.id)}>
                                            Make primary
                                        </Button>
                                    )}
                                <Box sx={{ flexGrow: 1 }} />
                                {!e.is_primary && (
                                    <Button size="small" color="error" onClick={() => onDeleteEntity(e.id)}>
                                        Delete
                                    </Button>
                                )}
                            </Stack>
                        ))}
                    </Stack>
                </Paper>
            )}

            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Entity Details</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Your legal-entity type and details. Logos, document attachments and
                    authorized personnel will be added here next.
                </Typography>
                <EntityCoreFields values={values} onChange={onChange} />

                {!registerSave && (
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
                        <Button variant="contained" startIcon={<SaveIcon />} onClick={doSave} disabled={saving}>
                            {saving ? 'Saving…' : 'Save Entity Details'}
                        </Button>
                    </Box>
                )}
            </Paper>

            {/* ── Entity media: logos / image / statutory documents ─────── */}
            <Paper sx={{ p: 3, mt: 2 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>Logos & Image</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Brand logo, legal-entity logo and a photo of the premises.
                </Typography>
                <Stack direction="row" spacing={3} sx={{ flexWrap: 'wrap', gap: 2 }}>
                    {IMAGE_KINDS.map(({ kind, label }) => (
                        <ImageTile
                            key={kind}
                            label={label}
                            url={data?.[`${kind}_url`]}
                            busy={busyKind === kind}
                            onPick={(file) => uploadMedia('image', kind, file)}
                        />
                    ))}
                </Stack>

                <Divider sx={{ my: 3 }} />

                <Typography variant="h6" sx={{ mb: 0.5 }}>Documents</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Statutory documents. Uploading a new file resets it to
                    pending re-verification.
                </Typography>
                <Stack spacing={1.5}>
                    {DOC_KINDS.map(({ kind, label }) => {
                        const doc = data?.[kind] || {};
                        const busy = busyKind === kind;
                        return (
                            <Stack
                                key={kind}
                                direction="row"
                                spacing={2}
                                alignItems="center"
                                sx={{ flexWrap: 'wrap', gap: 1 }}
                            >
                                <Typography sx={{ minWidth: 180, fontWeight: 600 }}>{label}</Typography>
                                {doc.has_file
                                    ? <Chip
                                        size="small"
                                        color={DOC_VERIF_COLOR[doc.verification_status] || 'default'}
                                        label={(doc.verification_status || 'pending').toUpperCase()}
                                      />
                                    : <Chip size="small" variant="outlined" label="Not uploaded" />}
                                {doc.doc_url && (
                                    <Link href={doc.doc_url} target="_blank" rel="noopener" variant="body2">
                                        View
                                    </Link>
                                )}
                                <Box sx={{ flexGrow: 1 }} />
                                <Button
                                    component="label"
                                    size="small"
                                    variant="outlined"
                                    startIcon={busy ? <CircularProgress size={14} /> : <UploadIcon />}
                                    disabled={busy}
                                >
                                    {doc.has_file ? 'Replace' : 'Upload'}
                                    <input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        hidden
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            e.target.value = '';
                                            if (f) uploadMedia('document', kind, f);
                                        }}
                                    />
                                </Button>
                            </Stack>
                        );
                    })}
                </Stack>
            </Paper>

            <Snackbar open={snack.open} autoHideDuration={4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
                <Alert severity={snack.severity} onClose={() => setSnack((s) => ({ ...s, open: false }))} sx={{ width: '100%' }}>
                    {snack.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
