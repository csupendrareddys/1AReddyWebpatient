/**
 * DocumentFormPage — Create or edit a document.
 *
 * A document has NO fixed clinical schema (that is the prescription's job).
 * It is exactly three things:
 *
 *   1. Description  — the one fixed text field, always present
 *   2. Attachment   — one optional supporting file
 *   3. Custom fields— doctor-authored {label, value} sections, any number,
 *                     rendered in list order
 *
 * Do not reintroduce named clinical fields here (Diagnosis, Allergies,
 * Medicines, Follow-up …). A document is whatever the doctor sold, so the
 * section names belong to the doctor — they add a custom field instead.
 *
 * Routes:
 *   /dashboard/doctor/documents/new?orderId=xxx  (create)
 *   /dashboard/doctor/documents/:id/edit         (edit)
 *
 * A document belongs to a purchased service (marketplace order), not an
 * appointment — there is no consultation to pull a patient context from,
 * so the form starts empty and the doctor fills it in.
 */
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
    Box, Typography, Paper, TextField, Button, IconButton,
    Stack, Snackbar, Alert, CircularProgress, Chip, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import PreviewIcon from '@mui/icons-material/Preview';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';

import { apiFileUrl } from '../../../../api/fileUrl';
import {
    useSaveDocumentMutation,
    useUpdateDocumentMutation,
    useReviseDocumentMutation,
    useGetDoctorDocumentQuery,
    useGetDoctorOrderQuery,
    useUploadDocumentAttachmentMutation,
    useDeleteDocumentAttachmentMutation,
    useAddFieldAttachmentMutation,
    useDeleteFieldAttachmentMutation,
} from '../../api/scopedDoctorApi';
import { useDoctorScope } from '../../ProfileSetting/context/DoctorScopeContext';

// Mirrors the backend cap in S3Service for asset_type='medical_document'.
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ACCEPTED_ATTACHMENTS = '.pdf,.jpg,.jpeg,.png';

// Field ids are minted here rather than server-side so the doctor can stage
// attachments on a field that has not been saved yet — the upload call needs
// a field id, and waiting for the save round-trip to learn it would mean
// mapping files back to rows by position. The backend accepts a well-formed
// uuid and mints its own otherwise.
const newFieldId = () => (
    globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        // http:// origins on older browsers don't expose randomUUID.
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
        })
);

const emptyField = () => ({
    id: newFieldId(), label: '', value: '',
    attachments: [],   // already saved on the server
    pendingFiles: [],  // chosen locally, uploaded after the next save
});

const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const DocumentFormPage = () => {
    const { id: documentId } = useParams();
    const [searchParams] = useSearchParams();
    const orderId = searchParams.get('orderId');
    const isRevise = searchParams.get('revise') === 'true';
    const navigate = useNavigate();
    // Operations mounts this page under its own /records tab, so every
    // link back into the hub is built from the scope, not hard-coded.
    const { recordsPath } = useDoctorScope();
    const isEdit = !!documentId && !isRevise;

    // ── Form state ──
    const [description, setDescription] = useState('');
    const [fields, setFields] = useState([emptyField()]);
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    // Attachment. `pendingFile` is a File chosen but not yet uploaded — a new
    // document has no id to attach to until it is saved, so the upload is
    // deferred to handleSave. `savedAttachment` is what the server already has.
    const [pendingFile, setPendingFile] = useState(null);
    const [savedAttachment, setSavedAttachment] = useState(null);
    const fileInputRef = useRef(null);
    // One hidden <input> per field, keyed by field id so reordering rows
    // doesn't hand a field someone else's picker.
    const fieldInputRefs = useRef({});

    // ── API ──
    // For NEW documents: the order header (which service, which patient).
    const { data: order } = useGetDoctorOrderQuery(
        orderId, { skip: !orderId || !!documentId }
    );
    const { data: existingDocument, isLoading: loadingExisting } = useGetDoctorDocumentQuery(
        documentId, { skip: !documentId }
    );
    const [saveDocument, { isLoading: saving }] = useSaveDocumentMutation();
    const [updateDocument, { isLoading: updating }] = useUpdateDocumentMutation();
    const [reviseDocument, { isLoading: revising }] = useReviseDocumentMutation();
    const [uploadAttachment, { isLoading: uploading }] = useUploadDocumentAttachmentMutation();
    const [deleteAttachment] = useDeleteDocumentAttachmentMutation();
    const [addFieldAttachment, { isLoading: uploadingField }] = useAddFieldAttachmentMutation();
    const [deleteFieldAttachment] = useDeleteFieldAttachmentMutation();

    const busy = saving || updating || revising || uploading || uploadingField;

    // ── Load existing document for edit or revise ──
    useEffect(() => {
        if (existingDocument && (isEdit || isRevise)) {
            const p = existingDocument;
            setDescription(p.description || '');
            const saved = (p.custom_fields || []).map((f) => ({
                id: f.id || newFieldId(),
                label: f.label || '',
                value: f.value || '',
                attachments: f.attachments || [],
                pendingFiles: [],
            }));
            // Always leave one empty row to type into.
            setFields(saved.length ? saved : [emptyField()]);
            if (p.attachment_url) {
                setSavedAttachment({ url: p.attachment_url, name: p.attachment_name });
            }
        }
    }, [existingDocument, isEdit, isRevise]);

    // ── Custom field row management ──
    const addField = () => setFields((prev) => [...prev, emptyField()]);

    const removeField = (index) => {
        setFields((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [emptyField()]));
    };

    const updateField = (index, prop, value) => {
        setFields((prev) => prev.map((f, i) => (i === index ? { ...f, [prop]: value } : f)));
    };

    // Order is meaningful — it is the render order on the document.
    const moveField = (index, delta) => {
        setFields((prev) => {
            const target = index + delta;
            if (target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    // ── Attachment handling ──
    const onFilePicked = (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';   // let the same file be re-picked after a remove
        if (!file) return;
        if (file.size > MAX_ATTACHMENT_BYTES) {
            setSnack({
                open: true, sev: 'error',
                msg: `"${file.name}" is ${formatBytes(file.size)} — the limit is 5 MB.`,
            });
            return;
        }
        setPendingFile(file);
    };

    const removeAttachment = async () => {
        if (pendingFile) {
            setPendingFile(null);
            return;
        }
        if (!savedAttachment || !documentId) return;
        try {
            await deleteAttachment({ documentId }).unwrap();
            setSavedAttachment(null);
            setSnack({ open: true, msg: 'Attachment removed', sev: 'success' });
        } catch (err) {
            setSnack({
                open: true, sev: 'error',
                msg: err?.data?.message || 'Could not remove the attachment',
            });
        }
    };

    // ── Per-field attachment handling ──
    // A field holds a list, so picking files appends. They stay local until
    // the next save, because the server rejects an upload for a field it has
    // not stored yet.
    const onFieldFilesPicked = (index, e) => {
        const picked = Array.from(e.target.files || []);
        e.target.value = '';
        if (!picked.length) return;

        const tooBig = picked.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
        const ok = picked.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
        if (tooBig.length) {
            setSnack({
                open: true, sev: 'error',
                msg: `${tooBig.map((f) => `"${f.name}"`).join(', ')} exceeded the 5 MB limit and ${tooBig.length > 1 ? 'were' : 'was'} skipped.`,
            });
        }
        if (!ok.length) return;
        setFields((prev) => prev.map((f, i) => (
            i === index ? { ...f, pendingFiles: [...f.pendingFiles, ...ok] } : f
        )));
    };

    const removePendingFieldFile = (index, fileIdx) => {
        setFields((prev) => prev.map((f, i) => (
            i === index
                ? { ...f, pendingFiles: f.pendingFiles.filter((_, j) => j !== fileIdx) }
                : f
        )));
    };

    const removeSavedFieldFile = async (index, attachment) => {
        if (!documentId) return;
        try {
            await deleteFieldAttachment({
                documentId, fieldId: fields[index].id, attachmentId: attachment.id,
            }).unwrap();
            setFields((prev) => prev.map((f, i) => (
                i === index
                    ? { ...f, attachments: f.attachments.filter((a) => a.id !== attachment.id) }
                    : f
            )));
            setSnack({ open: true, msg: 'Attachment removed', sev: 'success' });
        } catch (err) {
            setSnack({
                open: true, sev: 'error',
                msg: err?.data?.message || 'Could not remove the attachment',
            });
        }
    };

    // ── Build payload ──
    // Rows blank in both label and value are dropped; the backend does the
    // same, this just keeps the request clean.
    const buildPayload = (status) => ({
        status,
        description,
        custom_fields: fields
            .map((f) => ({ id: f.id, label: f.label.trim(), value: f.value.trim() }))
            .filter((f) => f.label || f.value),
    });

    const validate = () => {
        const orphan = fields.findIndex((f) => !f.label.trim() && f.value.trim());
        if (orphan !== -1) {
            setSnack({
                open: true, sev: 'error',
                msg: `Field ${orphan + 1} has content but no name — name it or clear it.`,
            });
            return false;
        }
        return true;
    };

    const handleSave = async (status = 'draft', { redirectToPreview = false } = {}) => {
        if (!validate()) return;
        const payload = buildPayload(status);
        try {
            let result;
            if (isRevise) {
                result = await reviseDocument({ documentId, ...payload }).unwrap();
                setSnack({ open: true, msg: 'Document revised successfully!', sev: 'success' });
            } else if (isEdit) {
                result = await updateDocument({ documentId, ...payload }).unwrap();
                setSnack({ open: true, msg: 'Saved as draft', sev: 'success' });
            } else {
                if (!orderId) {
                    setSnack({ open: true, msg: 'Missing order ID', sev: 'error' });
                    return;
                }
                try {
                    result = await saveDocument({ orderId, ...payload }).unwrap();
                    setSnack({ open: true, msg: 'Saved as draft', sev: 'success' });
                } catch (createErr) {
                    // 409 = document already exists → switch to update mode
                    const existingId = createErr?.data?.existing_document_id;
                    if (createErr?.status === 409 && existingId) {
                        result = await updateDocument({ documentId: existingId, ...payload }).unwrap();
                        setSnack({ open: true, msg: 'Document updated', sev: 'success' });
                    } else {
                        throw createErr;
                    }
                }
            }
            const newId = result?.data?.id || result?.id || documentId;

            // Attachments need the document (and its fields) to exist first, so
            // they go up after the save. A failed upload must not look like a
            // failed save — the text content is already committed by now.
            if (newId) {
                const failures = [];

                if (pendingFile) {
                    try {
                        await uploadAttachment({ documentId: newId, file: pendingFile }).unwrap();
                        setPendingFile(null);
                    } catch (upErr) {
                        failures.push(`${pendingFile.name}: ${upErr?.data?.message || 'upload error'}`);
                    }
                }

                // Sequential on purpose — these are 5 MB medical files and the
                // backend commits one row per call; firing a whole field's
                // worth at once buys nothing and muddies the error reporting.
                const uploaded = new Set();
                for (const f of fields) {
                    for (const file of f.pendingFiles) {
                        try {
                            await addFieldAttachment({
                                documentId: newId, fieldId: f.id, file,
                            }).unwrap();
                            uploaded.add(`${f.id}:${file.name}`);
                        } catch (upErr) {
                            failures.push(`${file.name}: ${upErr?.data?.message || 'upload error'}`);
                        }
                    }
                }
                if (uploaded.size) {
                    setFields((prev) => prev.map((f) => ({
                        ...f,
                        pendingFiles: f.pendingFiles.filter((file) => !uploaded.has(`${f.id}:${file.name}`)),
                    })));
                }

                if (failures.length) {
                    setSnack({
                        open: true, sev: 'warning',
                        msg: `Document saved, but ${failures.length} attachment(s) failed — ${failures[0]}`,
                    });
                    navigate(`${recordsPath}/documents/${newId}/edit`, { replace: true });
                    return;
                }
            }

            if (redirectToPreview && newId) {
                // Replace current history entry with the edit URL so pressing
                // browser-back from preview loads the saved document data
                // instead of remounting the empty "new" form.
                navigate(`${recordsPath}/documents/${newId}/edit`, { replace: true });
                setTimeout(() => navigate(`${recordsPath}/documents/${newId}/preview`), 100);
            } else {
                setTimeout(() => navigate(`${recordsPath}/documents`), 1200);
            }
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed to save', sev: 'error' });
        }
    };

    if ((isEdit || isRevise) && loadingExisting) {
        return <Box display="flex" justifyContent="center" mt={8}><CircularProgress /></Box>;
    }

    const attachment = pendingFile
        ? { name: pendingFile.name, size: formatBytes(pendingFile.size), pending: true }
        : savedAttachment
            ? { name: savedAttachment.name || 'Attachment', url: savedAttachment.url, pending: false }
            : null;

    return (
        <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
            {/* Header */}
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <IconButton onClick={() => navigate(`${recordsPath}/documents`)}>
                    <ArrowBackIcon />
                </IconButton>
                <Typography variant="h5" fontWeight="bold">
                    {isRevise ? 'Revise Document' : isEdit ? 'Edit Document' : 'New Document'}
                </Typography>
            </Box>

            {/* Which purchased service this document belongs to. Only shown
                when creating — on edit the document already carries it. */}
            {!documentId && order && (
                <Paper sx={{ p: 2, mb: 3, bgcolor: 'grey.50' }}>
                    <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                        <Chip size="small" color="primary" label={order.product_name || 'Service'} />
                        <Typography variant="body2" color="text.secondary">
                            for <strong>{order.patient?.full_name || order.patient_name || 'patient'}</strong>
                            {' · '}purchased {order.created_at ? new Date(order.created_at).toLocaleDateString('en-IN') : '-'}
                            {' · '}₹{order.price_at_purchase}
                        </Typography>
                        <Chip size="small" variant="outlined"
                            label={(order.status || '').replace(/_/g, ' ')} />
                    </Box>
                    {order.serving_doctors?.length > 1 && (
                        <Typography variant="caption" color="text.secondary">
                            Group offering — served by {order.serving_doctors.join(', ')}
                        </Typography>
                    )}
                </Paper>
            )}

            <Stack spacing={3}>
                {/* ══ Description (fixed) ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold" gutterBottom>
                        Description
                    </Typography>
                    <TextField
                        fullWidth multiline rows={4} value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What this document covers…"
                    />
                </Paper>

                {/* ══ Attachment (fixed, optional) ══ */}
                <Paper sx={{ p: 3 }}>
                    <Typography variant="h6" fontWeight="bold">
                        Attachment{' '}
                        <Typography component="span" variant="body2" color="text.secondary">
                            (optional)
                        </Typography>
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                        One supporting file — PDF or image, up to 5 MB.
                    </Typography>

                    <input
                        ref={fileInputRef} type="file" hidden
                        accept={ACCEPTED_ATTACHMENTS} onChange={onFilePicked}
                    />

                    {attachment ? (
                        <Box
                            display="flex" alignItems="center" gap={1.5}
                            sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                        >
                            <InsertDriveFileIcon color="action" />
                            <Box flexGrow={1} minWidth={0}>
                                <Typography variant="body2" noWrap>
                                    {attachment.url ? (
                                        <a href={apiFileUrl(attachment.url)} target="_blank" rel="noopener noreferrer">
                                            {attachment.name}
                                        </a>
                                    ) : attachment.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {attachment.pending
                                        ? `${attachment.size} · uploads when you save`
                                        : 'Attached'}
                                </Typography>
                            </Box>
                            <Button size="small" onClick={() => fileInputRef.current?.click()}>
                                Replace
                            </Button>
                            <Tooltip title="Remove attachment">
                                <IconButton size="small" color="error" onClick={removeAttachment}>
                                    <DeleteIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    ) : (
                        <Button
                            variant="outlined" startIcon={<AttachFileIcon />}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            Add an attachment
                        </Button>
                    )}
                </Paper>

                {/* ══ Custom fields (dynamic) ══ */}
                <Paper sx={{ p: 3 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                        <Typography variant="h6" fontWeight="bold">Fields</Typography>
                        <Button startIcon={<AddIcon />} onClick={addField} variant="outlined" size="small">
                            Add Field
                        </Button>
                    </Box>
                    <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                        Name each section yourself — they appear on the document in this order.
                    </Typography>

                    <Stack spacing={2}>
                        {fields.map((f, idx) => (
                            <Box
                                key={f.id}
                                sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                            >
                                <Box display="flex" alignItems="center" gap={1} mb={1.5}>
                                    <Typography variant="subtitle2" fontWeight="bold" color="text.secondary">
                                        #{idx + 1}
                                    </Typography>
                                    <Box flexGrow={1} />
                                    <Tooltip title="Move up">
                                        <span>
                                            <IconButton
                                                size="small" disabled={idx === 0}
                                                onClick={() => moveField(idx, -1)}
                                            >
                                                <ArrowUpwardIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title="Move down">
                                        <span>
                                            <IconButton
                                                size="small" disabled={idx === fields.length - 1}
                                                onClick={() => moveField(idx, 1)}
                                            >
                                                <ArrowDownwardIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    <Tooltip title="Remove field">
                                        <IconButton size="small" color="error" onClick={() => removeField(idx)}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>

                                <TextField
                                    fullWidth size="small" label="Field name"
                                    value={f.label}
                                    onChange={(e) => updateField(idx, 'label', e.target.value)}
                                    placeholder="e.g. Findings, Advice, Summary…"
                                    error={!f.label.trim() && !!f.value.trim()}
                                    helperText={
                                        !f.label.trim() && !!f.value.trim()
                                            ? 'Give this field a name before saving'
                                            : ' '
                                    }
                                />
                                <TextField
                                    fullWidth multiline rows={3} value={f.value}
                                    onChange={(e) => updateField(idx, 'value', e.target.value)}
                                    placeholder="Content…"
                                />

                                {/* ── This field's own files ── */}
                                <input
                                    ref={(el) => { fieldInputRefs.current[f.id] = el; }}
                                    type="file" hidden multiple
                                    accept={ACCEPTED_ATTACHMENTS}
                                    onChange={(e) => onFieldFilesPicked(idx, e)}
                                />

                                {(f.attachments.length > 0 || f.pendingFiles.length > 0) && (
                                    <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                                        {f.attachments.map((a) => (
                                            <Box key={a.id} display="flex" alignItems="center" gap={1}>
                                                <InsertDriveFileIcon fontSize="small" color="action" />
                                                <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                                                    <a href={apiFileUrl(a.url)} target="_blank" rel="noopener noreferrer">
                                                        {a.name || 'Attachment'}
                                                    </a>
                                                </Typography>
                                                <Tooltip title="Remove file">
                                                    <IconButton
                                                        size="small" color="error"
                                                        onClick={() => removeSavedFieldFile(idx, a)}
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        ))}
                                        {f.pendingFiles.map((file, j) => (
                                            <Box key={`${file.name}-${j}`} display="flex" alignItems="center" gap={1}>
                                                <InsertDriveFileIcon fontSize="small" color="disabled" />
                                                <Typography
                                                    variant="body2" noWrap color="text.secondary"
                                                    sx={{ flexGrow: 1, minWidth: 0 }}
                                                >
                                                    {file.name}
                                                    <Typography component="span" variant="caption" sx={{ ml: 1 }}>
                                                        {formatBytes(file.size)} · uploads when you save
                                                    </Typography>
                                                </Typography>
                                                <Tooltip title="Remove file">
                                                    <IconButton
                                                        size="small" color="error"
                                                        onClick={() => removePendingFieldFile(idx, j)}
                                                    >
                                                        <DeleteIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
                                        ))}
                                    </Stack>
                                )}

                                <Button
                                    size="small" startIcon={<AttachFileIcon />}
                                    onClick={() => fieldInputRefs.current[f.id]?.click()}
                                    sx={{ mt: 1 }}
                                >
                                    Attach files
                                </Button>
                            </Box>
                        ))}
                    </Stack>
                </Paper>

                {/* ══ Action Buttons ══ */}
                <Box display="flex" gap={2} justifyContent="flex-end" pb={4}>
                    <Button variant="outlined" onClick={() => navigate(`${recordsPath}/documents`)}>
                        Cancel
                    </Button>
                    <Button
                        variant="contained" color="inherit" startIcon={<SaveIcon />}
                        onClick={() => handleSave('draft')}
                        disabled={busy}
                    >
                        {busy ? 'Saving...' : 'Save as Draft'}
                    </Button>
                    <Button
                        variant="contained" color="info" startIcon={<PreviewIcon />}
                        onClick={() => handleSave('draft', { redirectToPreview: true })}
                        disabled={busy}
                    >
                        {busy ? 'Saving...' : 'Preview & Submit'}
                    </Button>
                </Box>
            </Stack>

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev} onClose={() => setSnack({ ...snack, open: false })}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default DocumentFormPage;
