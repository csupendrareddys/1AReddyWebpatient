/**
 * Landing Editor tab — table-style field list (mirrors PageConfigEditor's
 * Page Configuration table) plus a Modules sub-table.
 *
 * The top ``Page Configuration`` card is the canonical editing surface:
 * one row per field, S.No / Field Name / Value / Display / Mandatory columns.
 * Hero + theme fields live here.
 *
 * The ``Modules`` card below is a CRUD list for the dynamic top-nav. Clicking
 * a row (or its pencil icon) opens the ModuleConfigEditor.
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Card, CardContent, Typography, TextField, Switch, Button, Table,
    TableContainer, TableHead, TableRow, TableCell, TableBody, IconButton, Dialog, DialogTitle,
    DialogContent, DialogActions, Grid, Alert, Tooltip, Divider, Stack,
    FormControlLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import {
    useListLandingModulesQuery,
    useCreateLandingModuleMutation,
    useDeleteLandingModuleMutation,
    useReorderLandingModulesMutation,
    useUpdateLandingModuleMutation,
    useUploadLandingAssetMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import {
    useListPlatformLandingModulesQuery,
    useCreatePlatformLandingModuleMutation,
    useDeletePlatformLandingModuleMutation,
    useUpdatePlatformLandingModuleMutation,
} from '../../../../../api/platformLandingEndpoints';
import { TranslationsEditor } from '../../../../../../../common/i18n';
import { LANDING_SECTIONS } from '../../../../../../../pages/LandingPage/sectionVisibility';


/**
 * LogoUploadField — file-picker that uploads to S3 via the landing
 * config admin upload endpoint and writes the resulting public URL
 * back to the parent ``onChange``. Doubles as a URL-paste field for
 * admins who already host their logo somewhere (CDN, marketing site,
 * etc.); the text input below the picker is editable independently.
 *
 * Validates extension at the browser layer for a fast-fail UX; the
 * backend re-validates (size + extension + size cap) so a malformed
 * file can't slip in via a forged frontend.
 */
function LogoUploadField({ field, value, onChange, disabled }) {
    const [uploadAsset, { isLoading: uploading }] = useUploadLandingAssetMutation();
    const [uploadError, setUploadError] = useState('');
    const inputRef = useRef(null);

    const handlePick = () => {
        if (disabled || uploading) return;
        inputRef.current?.click();
    };

    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        // Reset the input so re-uploading the same file fires onChange again.
        if (e.target) e.target.value = '';
        if (!file) return;
        setUploadError('');
        // Browser-side extension guard. Mirror the backend's
        // ``ALLOWED_EXTENSIONS`` for image uploads — keeps a typo'd
        // .docx from round-tripping to S3 just to surface a 400.
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const allowed = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
        if (!allowed.includes(ext)) {
            setUploadError(`Logos must be ${allowed.join(' / ')}. Got: .${ext}`);
            return;
        }
        try {
            const result = await uploadAsset({ file, kind: 'logo' }).unwrap();
            if (result?.url) {
                onChange(result.url);
            } else {
                setUploadError('Upload completed but the server returned no URL.');
            }
        } catch (err) {
            setUploadError(
                err?.data?.error
                || err?.data?.message
                || 'Upload failed. Try a smaller file or different format.'
            );
        }
    };

    return (
        <Box>
            <Stack direction="row" spacing={1.5} alignItems="center">
                {/* Inline preview — only shown when a URL is set. */}
                {value && (
                    <Box
                        component="img"
                        src={value}
                        alt="Logo preview"
                        sx={{
                            height: 40, width: 'auto', maxWidth: 120,
                            objectFit: 'contain',
                            border: '1px solid', borderColor: 'grey.200',
                            borderRadius: 1, p: 0.5, bgcolor: '#fff',
                        }}
                    />
                )}
                <Button
                    variant="outlined" size="small"
                    startIcon={<CloudUploadIcon />}
                    onClick={handlePick}
                    disabled={disabled || uploading}
                    sx={{ textTransform: 'none' }}
                >
                    {uploading ? 'Uploading…' : (value ? 'Replace logo' : 'Upload logo')}
                </Button>
                {value && (
                    <Button
                        variant="text" size="small" color="error"
                        onClick={() => onChange('')}
                        disabled={disabled || uploading}
                        sx={{ textTransform: 'none' }}
                    >
                        Remove
                    </Button>
                )}
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/gif,image/svg+xml,image/webp"
                    hidden
                    onChange={handleFile}
                />
            </Stack>
            <TextField
                key={`logo-url-${value || ''}`}
                size="small" fullWidth
                defaultValue={value || ''}
                onBlur={(e) => onChange(e.target.value)}
                disabled={disabled || uploading}
                placeholder={field.placeholder}
                helperText={uploadError || 'Upload a logo image or paste any CDN/S3 URL.'}
                error={Boolean(uploadError)}
                sx={{ mt: 1 }}
            />
        </Box>
    );
}


/**
 * RepeatableRowsField — friendly row-based editor for the JSON-array
 * config fields (stats / testimonials / hero_partners / why_features
 * / faqs). One row per item; each row has labeled TextField inputs
 * for the row's keys plus reorder + remove buttons. "+ Add row" at
 * the bottom.
 *
 * The persisted value is still a plain JSON array (no schema change)
 * — the row editor is just a presentation layer over the same data.
 * Empty rows aren't auto-stripped; if the admin leaves a row blank
 * the frontend renders an empty entry. Defensive rendering on the
 * public side skips rows missing required keys, so a half-filled
 * row doesn't crash the live page.
 *
 * ``schema`` shape:
 *   [{ key: 'value', label: 'Value', type: 'text' },
 *    { key: 'label', label: 'Label', type: 'text' }, …]
 * ``newRow()`` is the optional factory for a blank row (defaults to
 * an empty object).
 */
let _rowIdCounter = 0;
const nextRowId = () => `_rid_${++_rowIdCounter}`;

/** Ensure every row in an array carries a stable ``_rid`` identity key. */
const ensureRowIds = (rows) =>
    (Array.isArray(rows) ? structuredClone(rows) : []).map((r) =>
        r && r._rid ? r : { ...r, _rid: nextRowId() },
    );

/** Strip the internal ``_rid`` before handing the data back to the parent
 *  (heroPatch / save-draft payload). The backend doesn't know about _rid. */
const stripRowIds = (rows) =>
    rows.map(({ _rid, ...rest }) => rest);

function RepeatableRowsField({ field, value, onChange, disabled, schema, newRow }) {
    const rowsRef = useRef(ensureRowIds(value));
    // Re-sync the ref when the parent draft is refreshed from the server
    // (e.g. after a publish + DRAFT invalidation forces a refetch). Without
    // this the component keeps rendering the stale pre-publish rows.
    //
    // ``selfUpdateRef`` prevents re-syncing (and regenerating _rid keys)
    // when the value change was triggered by our own onChange calls
    // (structural mutations like add/remove/reorder). Without this guard
    // every onChange → patchHero → re-render cycle would create new _rid
    // values, causing React to unmount/remount TextFields and lose focus.
    const lastValueRef = useRef(value);
    const selfUpdateRef = useRef(false);
    if (lastValueRef.current !== value) {
        lastValueRef.current = value;
        if (!selfUpdateRef.current) {
            rowsRef.current = ensureRowIds(value);
        }
        selfUpdateRef.current = false;
    }

    const forceRender = useState({})[1];
    const rerender = () => { forceRender({}); };

    /** Notify parent without triggering a _rid-regenerating re-sync. */
    const notifyParent = () => {
        selfUpdateRef.current = true;
        onChange(stripRowIds(rowsRef.current));
    };

    // Update a single cell in the ref (no re-render on keystroke).
    // The TextField below flushes the whole row array via onBlur.
    const updateRow = (idx, key, val) => {
        rowsRef.current[idx] = { ...(rowsRef.current[idx] || {}), [key]: val };
    };
    // Structural mutations (add / remove / reorder) are immediate — notify
    // the parent so the change lands in heroPatch and survives Save Draft.
    const addRow = () => {
        const blank = newRow ? newRow() : {};
        blank._rid = nextRowId();
        rowsRef.current.push(blank);
        rerender();
        notifyParent();
    };
    const removeRow = (idx) => {
        rowsRef.current = rowsRef.current.filter((_, i) => i !== idx);
        rerender();
        notifyParent();
    };
    const moveRow = (idx, delta) => {
        const target = idx + delta;
        if (target < 0 || target >= rowsRef.current.length) return;
        [rowsRef.current[idx], rowsRef.current[target]] =
            [rowsRef.current[target], rowsRef.current[idx]];
        rerender();
        notifyParent();
    };
    return (
        <Box>
            {field.helpText && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {field.helpText}
                </Typography>
            )}
            <Stack spacing={1.5}>
                {rowsRef.current.length === 0 && (
                    <Typography variant="caption" color="text.disabled">
                        No rows yet — click <strong>Add row</strong> to create one.
                    </Typography>
                )}
                {rowsRef.current.map((row, idx) => (
                    <Box
                        key={row._rid}
                        sx={{
                            p: 1.5,
                            border: '1px solid',
                            borderColor: 'grey.200',
                            borderRadius: 1.5,
                            bgcolor: 'grey.50',
                        }}
                    >
                        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                                Row {idx + 1} of {rowsRef.current.length}
                            </Typography>
                            <Tooltip title="Move up">
                                <span>
                                    <IconButton size="small" onClick={() => moveRow(idx, -1)} disabled={disabled || idx === 0}>
                                        <ArrowUpwardIcon fontSize="inherit" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Move down">
                                <span>
                                    <IconButton size="small" onClick={() => moveRow(idx, 1)} disabled={disabled || idx === rowsRef.current.length - 1}>
                                        <ArrowDownwardIcon fontSize="inherit" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Remove row">
                                <span>
                                    <IconButton size="small" color="error" onClick={() => removeRow(idx)} disabled={disabled}>
                                        <DeleteIcon fontSize="inherit" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Stack>
                        <Stack spacing={1}>
                            {schema.map((col) => (
                                <TextField
                                    key={`${row._rid}-${col.key}`}
                                    size="small" fullWidth
                                    label={col.label}
                                    defaultValue={row?.[col.key] ?? ''}
                                    onChange={(e) => updateRow(idx, col.key, e.target.value)}
                                    onBlur={() => notifyParent()}
                                    disabled={disabled}
                                    multiline={col.type === 'textarea'}
                                    minRows={col.type === 'textarea' ? 2 : undefined}
                                    placeholder={col.placeholder}
                                    helperText={col.helpText}
                                />
                            ))}
                        </Stack>
                    </Box>
                ))}
            </Stack>
            <Button
                size="small" startIcon={<AddIcon />}
                onClick={addRow} disabled={disabled}
                sx={{ mt: 1.5, textTransform: 'none' }}
            >
                Add row
            </Button>
        </Box>
    );
}


// Per-field schemas. Each entry maps the array field's key to the
// row-shape the editor renders. Future round can extend with column
// types (number, select, image-upload) — text + textarea cover
// every current use.
const REPEATABLE_ROW_SCHEMAS = {
    stats: {
        newRow: () => ({ value: '', label: '' }),
        schema: [
            { key: 'value', label: 'Value (e.g. "10,000+")', type: 'text' },
            { key: 'label', label: 'Label (e.g. "Happy Patients")', type: 'text' },
        ],
    },
    testimonials: {
        newRow: () => ({ quote: '', name: '', role: '' }),
        schema: [
            { key: 'quote', label: 'Quote', type: 'textarea' },
            { key: 'name',  label: 'Name',  type: 'text' },
            { key: 'role',  label: 'Role / Position', type: 'text' },
        ],
    },
    hero_partners: {
        newRow: () => ({ name: '', logo_url: '' }),
        schema: [
            { key: 'name',     label: 'Partner Name', type: 'text' },
            { key: 'logo_url', label: 'Logo Image URL (optional)', type: 'text',
              helpText: 'Leave blank to show the name as text.' },
        ],
    },
    why_features: {
        newRow: () => ({ title: '', description: '' }),
        schema: [
            { key: 'title',       label: 'Bullet Title (e.g. "Certified Doctors")', type: 'text' },
            { key: 'description', label: 'Description', type: 'textarea' },
        ],
    },
    faqs: {
        newRow: () => ({ question: '', answer: '' }),
        schema: [
            { key: 'question', label: 'Question', type: 'text' },
            { key: 'answer',   label: 'Answer',   type: 'textarea' },
        ],
    },
};


/**
 * JsonArrayField — raw-JSON textarea for repeating-row config (stats /
 * testimonials / hero_partners). Renders the parsed value as JSON,
 * lets the admin edit, parses on blur, surfaces a syntax error
 * inline. Defensive parsing: a temporarily-invalid string while the
 * admin is mid-edit doesn't blow away their work or push garbage to
 * the parent state.
 *
 * Future round can replace this with a proper row-based editor (one
 * row per item, named TextFields for each key). Schema change isn't
 * needed — the column is still a JSON array.
 */
function JsonArrayField({ field, value, onChange, disabled }) {
    const initial = Array.isArray(value) ? value : [];
    const [text, setText] = useState(() =>
        initial.length ? JSON.stringify(initial, null, 2) : '',
    );
    const [error, setError] = useState('');

    const commit = (raw) => {
        const trimmed = (raw || '').trim();
        if (!trimmed) {
            setError('');
            onChange(null);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) {
                setError('Must be a JSON array (e.g. [{...}, {...}]).');
                return;
            }
            setError('');
            onChange(parsed);
        } catch (e) {
            setError(`Invalid JSON: ${e.message}`);
        }
    };

    return (
        <Box>
            <TextField
                size="small" fullWidth multiline rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={(e) => commit(e.target.value)}
                disabled={disabled}
                placeholder={field.placeholder}
                error={Boolean(error)}
                helperText={error || field.helpText}
                slotProps={{
                    input: {
                        sx: { fontFamily: 'monospace', fontSize: '0.78rem' },
                    },
                }}
            />
        </Box>
    );
}


/**
 * SectionVisibilityCard — admin panel with one toggle per known
 * landing-page section. Writes the whole map back to the parent on
 * every change so the existing dirty-tracking + save flow doesn't
 * need to learn about per-field debouncing.
 *
 * Visibility semantics live in ``pages/LandingPage/sectionVisibility.js``
 * (canonical list + ``isSectionVisible`` helper). Missing keys default
 * to "visible" so toggling something on amounts to deleting the key
 * OR setting it to ``true`` — both work.
 */
function SectionVisibilityCard({ visibility, onChange, disabled, hiddenSectionKeys }) {
    const setKey = (key, value) => {
        const next = { ...(visibility || {}), [key]: value };
        onChange(next);
    };

    // Sections whose visibility toggle ALSO appears inline in the
    // Page Configuration table above get filtered out here — no
    // point duplicating the same switch in two places. The caller
    // computes the set from LANDING_FIELDS.
    const hidden = new Set(hiddenSectionKeys || []);
    const sections = LANDING_SECTIONS.filter((s) => !hidden.has(s.key));

    if (sections.length === 0) return null;

    return (
        <Card>
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6">Other Section Toggles</Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Sections that don't have an editable text field above —
                    flip them on/off here. Sections with rows in the Page
                    Configuration table use the Show / Hide switch beside
                    each row.
                </Typography>
                <Divider sx={{ mb: 2 }} />

                <Grid container spacing={2}>
                    {sections.map((section) => {
                        // Missing key → on. Falsy explicit false → off.
                        const checked = visibility?.[section.key] !== false;
                        return (
                            <Grid item xs={12} sm={6} key={section.key}>
                                <Box
                                    sx={{
                                        p: 2,
                                        border: '1px solid',
                                        borderColor: 'grey.200',
                                        borderRadius: 1.5,
                                        bgcolor: checked ? '#fff' : '#fafafa',
                                        opacity: checked ? 1 : 0.7,
                                    }}
                                >
                                    <FormControlLabel
                                        sx={{ alignItems: 'flex-start', m: 0, width: '100%' }}
                                        control={
                                            <Switch
                                                checked={checked}
                                                onChange={(e) => setKey(section.key, e.target.checked)}
                                                disabled={disabled}
                                                sx={{ mt: -0.5 }}
                                            />
                                        }
                                        label={
                                            <Box sx={{ ml: 1 }}>
                                                <Typography variant="subtitle2" fontWeight={600}>
                                                    {section.label}
                                                </Typography>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{ display: 'block', mt: 0.25 }}
                                                >
                                                    {section.description}
                                                </Typography>
                                            </Box>
                                        }
                                    />
                                </Box>
                            </Grid>
                        );
                    })}
                </Grid>
            </CardContent>
        </Card>
    );
}


import {
    LANDING_THEME_PRESETS,
    LANDING_THEME_PRESET_KEYS,
} from '../../../../../../../theme/landingThemePresets';

// Field definitions for the landing-level "Page Configuration" table. Shape
// matches PageConfigEditor's convention: ``visibilityKey`` drives the Display
// column (null → "Always Visible"), ``translatable`` surfaces the inline
// TranslationsEditor under the value.

import {DEFAULT_LANDING_FIELDS} from './Editordefault_value'
const LANDING_FIELDS=DEFAULT_LANDING_FIELDS   

const GRID_COLS = '50px 220px 1fr 150px 130px';

// ---------------------------------------------------------------------------

// Mirrors the backend validators in
// ``Backend/app/api/landing_page_config/validators.py``. Keep the two in sync
// so a form that looks valid here can't be rejected by the server for a rule
// the frontend didn't enforce.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,118}$/;
const SLUG_HELPER = 'Lowercase letters, digits, dashes and underscores. Must start with a letter or digit. 2–119 chars.';

const validateModuleForm = (form) => {
    const errors = {};
    if (!form.slug.trim()) errors.slug = 'Slug is required.';
    else if (!SLUG_RE.test(form.slug.trim())) errors.slug = SLUG_HELPER;
    if (!form.name.trim()) errors.name = 'Name is required.';
    else if (form.name.trim().length > 200) errors.name = 'Name must be 200 characters or fewer.';
    if (form.icon_key && form.icon_key.length > 100) errors.icon_key = 'Max 100 characters.';
    return errors;
};

// Turn whatever shape the backend returns on 422 into ``{field: message}``.
// Marshmallow errors come back as ``{field: ['msg1', 'msg2']}``; the envelope
// may stash those under ``error.data.errors`` (RTK + axiosBaseQuery) or
// ``error.data.error`` as a free-text string. Render whichever is present.
const parseBackendErrors = (rtkError) => {
    const out = { _global: '', fields: {} };
    if (!rtkError) return out;
    const envelope = rtkError.data || rtkError;
    const fields = envelope?.errors;
    if (fields && typeof fields === 'object') {
        Object.entries(fields).forEach(([k, v]) => {
            out.fields[k] = Array.isArray(v) ? v.join(' ') : String(v);
        });
    }
    if (envelope?.error && typeof envelope.error === 'string') {
        out._global = envelope.error;
    } else if (envelope?.message && typeof envelope.message === 'string') {
        out._global = envelope.message;
    }
    return out;
};

const ModuleCreateDialog = ({ open, onClose, onCreate, isSaving, lastError }) => {
    const [form, setForm] = useState({ slug: '', name: '', icon_key: '', description: '' });
    const [touched, setTouched] = useState({});
    const setField = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
    const touch = (k) => () => setTouched((p) => ({ ...p, [k]: true }));

    const clientErrors = validateModuleForm(form);
    const backendErrors = parseBackendErrors(lastError);
    // Backend errors take precedence over client errors on a field that was
    // already submitted — the server is authoritative (e.g. duplicate slug).
    const errorFor = (k) =>
        backendErrors.fields[k] || (touched[k] || lastError ? clientErrors[k] : null);

    const hasClientErrors = Object.keys(clientErrors).length > 0;

    const submit = () => {
        // Mark every field touched so the inline errors surface even for
        // users who just hit Create without leaving any input.
        setTouched({ slug: true, name: true, icon_key: true, description: true });
        if (hasClientErrors) return;
        onCreate(form);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Create module</DialogTitle>
            <DialogContent dividers>
                {backendErrors._global && (
                    <Alert severity="error" sx={{ mb: 2 }}>{backendErrors._global}</Alert>
                )}
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Slug" value={form.slug}
                            onChange={setField('slug')} onBlur={touch('slug')}
                            error={!!errorFor('slug')}
                            helperText={errorFor('slug') || SLUG_HELPER}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Name" value={form.name}
                            onChange={setField('name')} onBlur={touch('name')}
                            error={!!errorFor('name')}
                            helperText={errorFor('name')}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Icon key (optional)"
                            value={form.icon_key} onChange={setField('icon_key')}
                            onBlur={touch('icon_key')}
                            error={!!errorFor('icon_key')}
                            helperText={errorFor('icon_key') || 'MUI icon key, resolved on the frontend.'}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth size="small" multiline rows={2}
                            label="Description" value={form.description}
                            onChange={setField('description')}
                            error={!!errorFor('description')}
                            helperText={errorFor('description')}
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained" onClick={submit}
                    disabled={isSaving || hasClientErrors}
                >
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------

const EditorTab = ({ draft, canEdit, patchHero, mode = 'tenant' }) => {
    const navigate = useNavigate();
    const isPlatform = mode === 'platform';
    // Modules + their write surface branch on which landing this editor
    // edits. Reading from ``draft.modules`` works in both modes (the
    // backend inlines them on the config GET) but we still need a
    // matching mutation set for create/update/delete; using tenant
    // mutations in platform mode would write the wrong table and the
    // apex would never see the change.
    const tenantListQ = useListLandingModulesQuery(undefined, { skip: isPlatform });
    const platformListQ = useListPlatformLandingModulesQuery(draft?.id, {
        skip: !isPlatform || !draft?.id,
    });
    const listQ = isPlatform ? platformListQ : tenantListQ;
    // Prefer ``draft.modules`` (always inlined in the config GET) over the
    // separate list query — keeps a single source of truth and lets the
    // platform editor show modules even before the separate LIST query
    // settles. Falls back to the list query for tenant mode if draft is
    // missing modules for any reason.
    const modules = (draft?.modules?.length ? draft.modules : (listQ.data || []));
    const isLoading = listQ.isLoading;
    const [createTenantModule, createTenantState] = useCreateLandingModuleMutation();
    const [createPlatformModule, createPlatformState] = useCreatePlatformLandingModuleMutation();
    const [deleteTenantModule] = useDeleteLandingModuleMutation();
    const [deletePlatformModule] = useDeletePlatformLandingModuleMutation();
    const [updateTenantModule] = useUpdateLandingModuleMutation();
    const [updatePlatformModule] = useUpdatePlatformLandingModuleMutation();
    // Platform mode has no batch reorder endpoint — display_order is set on
    // each module's PUT instead. The up/down arrows fall back to a
    // best-effort sequence of single updates below.
    const [reorderModules] = useReorderLandingModulesMutation();
    // Unified callable shape so the rest of the file doesn't branch.
    const createModule = isPlatform
        ? (form) => createPlatformModule({ configId: draft.id, data: form })
        : createTenantModule;
    const updateModule = isPlatform
        ? ({ moduleId, data }) => updatePlatformModule({ moduleId, data })
        : updateTenantModule;
    const deleteModule = isPlatform ? deletePlatformModule : deleteTenantModule;
    const createState = isPlatform ? createPlatformState : createTenantState;
    const [createOpen, setCreateOpen] = useState(false);
    const draftRef = useRef({ ...draft });
    // Track server identity so we only reset from server when the
    // underlying row changes (e.g. after save/promote refetch), NOT
    // during a session where local ref edits should prevail.
    const serverStampRef = useRef(draft?.updated_at);

    if (!draft) {
        return <Alert severity="info">Draft is loading…</Alert>;
    }
    // Only overwrite draftRef from server when the row identity changes
    // (updated_at or id changed on the server side). During a single
    // editing session local ref edits take precedence.
    if (draft.updated_at !== serverStampRef.current || draft.id !== draftRef.current.id) {
        draftRef.current = { ...draft };
        serverStampRef.current = draft.updated_at;
    }
    const setDraftValue = (k, v) => {
        draftRef.current[k] = v;
    };
    const setNestedDraftValue = (parentKey, childKey, value) => {
        draftRef.current[parentKey] = {
            ...(draftRef.current[parentKey] || {}),
            [childKey]: value,
        };
    };

    // ``set`` routes non-text field changes (json arrays, row arrays,
    // section_visibility) through patchHero so they land in heroPatch
    // and are included in the Save Draft payload. These are triggered
    // by discrete user actions (add row, toggle switch, blur) — not
    // on every keystroke — so the state update + re-render is fine.
    const set = (k, v) => patchHero({ [k]: v });

    // Merge the TranslationsEditor's updated map into heroPatch.
    // ``next`` is the full translations object returned by the editor.
    const patchTranslations = (_fieldKey, next) =>
        patchHero({ translations: next });

    const handleCreate = async (form) => {
        try {
            await createModule(form).unwrap();
            setCreateOpen(false);
        } catch {
            // Keep the dialog open so ``createState.error`` drives the inline
            // error UI. Don't swallow — the dialog reads the error from the
            // RTK mutation state.
        }
    };
    const handleToggleVisible = (module) => {
        updateModule({ moduleId: module.id, data: { is_visible: !module.is_visible } });
    };

    // Featured-slider toggle (the third sliding bar on the public landing).
    const handleToggleSlider = (module) => {
        updateModule({ moduleId: module.id, data: { show_in_slider: !module.show_in_slider } });
    };
    const handleDelete = (module) => {
        if (!window.confirm(`Delete module "${module.name}"? Its features will also be removed.`)) return;
        deleteModule(module.id);
    };
    const moveModule = (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= modules.length) return;
        const reordered = [...modules];
        const [moved] = reordered.splice(index, 1);
        reordered.splice(target, 0, moved);
        const newOrders = reordered.map((m, i) => ({ id: m.id, display_order: i }));
        if (isPlatform) {
            // Platform side has no batch reorder endpoint; issue a
            // best-effort sequence of per-module PUTs.
            newOrders.forEach((row) =>
                updateModule({ moduleId: row.id, data: { display_order: row.display_order } })
            );
        } else {
            reorderModules(newOrders);
        }
    };
    // Per-module deep link — under the platform tree when this editor is
    // editing the apex marketing landing, under the tenant tree otherwise.
    // Without this, clicking a platform module sent you to the tenant
    // module editor, and feature edits would land in the wrong table.
    const moduleEditorBase = isPlatform
        ? '/dashboard/platform/landing-config/modules'
        : '/dashboard/admin/tenant-landing/modules';
    const openModule = (id) => navigate(`${moduleEditorBase}/${id}`);

    const activePreset = draft.theme_preset || 'ocean';
    // When the admin clicks a preset tile, write BOTH the preset key AND the
    // matching hex colors. Two reasons:
    //   1. Resilient — even if the backend ignores ``theme_preset`` (stale
    //      schema during a rolling deploy), the per-color hex fields still
    //      reflect the user's choice on the public site.
    //   2. Coherent — when the admin switches to "Custom" later, the per-color
    //      tiles already show what the previously-selected preset looked like
    //      (a sensible starting point) instead of the previous tenant's
    //      arbitrary colors.
    const setPreset = (key) => {
        if (key === 'custom') {
            patchHero({ theme_preset: 'custom' });
            return;
        }
        const p = LANDING_THEME_PRESETS[key];
        if (!p) {
            patchHero({ theme_preset: key });
            return;
        }
        patchHero({
            theme_preset: key,
            primary_color: p.primary,
            secondary_color: p.secondary,
            accent_color: p.accent,
            background_color: p.background,
        });
    };

    // Manually editing a hex color implicitly switches to the Custom preset —
    // otherwise the public landing would keep using the named preset's colors
    // and the admin's hex edit would silently no-op.
    const setColor = (fieldKey) => (value) => {
        if (['primary_color', 'secondary_color', 'accent_color', 'background_color'].includes(fieldKey)
            && draft.theme_preset !== 'custom') {
            patchHero({ [fieldKey]: value, theme_preset: 'custom' });
        } else {
            patchHero({ [fieldKey]: value });
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* ──────────────── Theme Picker ──────────────── */}
            <Card>
                <CardContent>
                    <Typography variant="h6" gutterBottom>Theme</Typography>
                    <Typography color="text.secondary" sx={{ mb: 3 }}>
                        Pick a preset to instantly retheme the public landing page. Choose
                        <code> Custom </code> to ignore the preset and use the per-color
                        fields in <em>Page Configuration</em> below.
                    </Typography>

                    <Grid container spacing={2}>
                        {LANDING_THEME_PRESET_KEYS.map((key) => {
                            const p = LANDING_THEME_PRESETS[key];
                            const selected = activePreset === key;
                            return (
                                <Grid size={{ xs: 12, sm: 6, md: 4 }} key={key}>
                                    <Box
                                        onClick={() => canEdit && setPreset(key)}
                                        sx={{
                                            cursor: canEdit ? 'pointer' : 'not-allowed',
                                            opacity: canEdit ? 1 : 0.6,
                                            border: '2px solid',
                                            borderColor: selected ? p.primary : 'divider',
                                            borderRadius: 2,
                                            p: 2,
                                            transition: 'all 0.2s',
                                            bgcolor: selected ? `${p.primary}10` : '#fff',
                                            '&:hover': canEdit ? { borderColor: p.primary } : {},
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                                            <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: p.primary }} />
                                            <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: p.secondary }} />
                                            <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: p.accent }} />
                                            <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: p.dark }} />
                                        </Box>
                                        <Typography fontWeight={700} fontSize="0.95rem">
                                            {p.label}
                                            {selected && (
                                                <Box component="span" sx={{ ml: 1, color: p.primary, fontSize: '0.75rem' }}>
                                                    ● selected
                                                </Box>
                                            )}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {p.description}
                                        </Typography>
                                    </Box>
                                </Grid>
                            );
                        })}
                        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                            <Box
                                onClick={() => canEdit && setPreset('custom')}
                                sx={{
                                    cursor: canEdit ? 'pointer' : 'not-allowed',
                                    opacity: canEdit ? 1 : 0.6,
                                    border: '2px dashed',
                                    borderColor: activePreset === 'custom' ? 'primary.main' : 'divider',
                                    borderRadius: 2,
                                    p: 2,
                                    height: '100%',
                                    transition: 'all 0.2s',
                                    bgcolor: activePreset === 'custom' ? 'primary.50' : '#fff',
                                }}
                            >
                                <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
                                    <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: draft.primary_color || '#1976d2' }} />
                                    <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: draft.secondary_color || '#dc004e' }} />
                                    <Box sx={{ flex: 1, height: 28, borderRadius: 1, bgcolor: draft.accent_color || '#26a69a' }} />
                                </Box>
                                <Typography fontWeight={700} fontSize="0.95rem">
                                    Custom
                                    {activePreset === 'custom' && (
                                        <Box component="span" sx={{ ml: 1, color: 'primary.main', fontSize: '0.75rem' }}>
                                            ● selected
                                        </Box>
                                    )}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Use the per-color fields below.
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            {/* ──────────────── Page Configuration (table) ──────────────── */}
            <Card>
                <CardContent>
                    <Typography variant="h6" gutterBottom>Page Configuration</Typography>
                    <Typography color="text.secondary" sx={{ mb: 3 }}>
                        Configure hero, theme, and marketing copy for the public landing page.
                    </Typography>

                    {/* Horizontal scroll on small screens — fixed columns sum
                        past a phone viewport, so keep header + rows on one
                        min-width track and let it scroll rather than overflow. */}
                    <Box sx={{ overflowX: 'auto' }}>
                    <Box sx={{ minWidth: 780 }}>
                    {/* Header */}
                    <Box sx={{
                        display: 'grid', gridTemplateColumns: GRID_COLS, gap: 1,
                        alignItems: 'center', bgcolor: 'primary.main', color: 'white',
                        p: 1.5, borderRadius: '4px 4px 0 0',
                    }}>
                        <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">S.No</Typography>
                        <Typography fontWeight="bold" fontSize="0.85rem">Field Name</Typography>
                        <Typography fontWeight="bold" fontSize="0.85rem">Value</Typography>
                        <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Display</Typography>
                        <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Mandatory</Typography>
                    </Box>

                    {LANDING_FIELDS.map((field, index) => (
                        <Box
                            key={field.key}
                            sx={{
                                display: 'grid', gridTemplateColumns: GRID_COLS, gap: 1,
                                alignItems: 'center', p: 1, borderBottom: '1px solid',
                                borderLeft: '1px solid', borderRight: '1px solid',
                                borderColor: 'divider',
                                bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                                '&:hover': { bgcolor: '#e3f2fd' },
                            }}
                        >
                            <Typography textAlign="center" fontWeight={500}>
                                {String(index + 1).padStart(2, '0')}
                            </Typography>
                            <Typography fontWeight={500}>{field.label}</Typography>

                            <Box>
                                {field.type === 'color' && (
                                    <TextField
                                        key={`${field.key}-${draft.updated_at || ''}`}
                                        type="color" size="small"
                                        value={draft[field.key] || field.default}
                                        onChange={(e) => setColor(field.key)(e.target.value)}
                                        disabled={!canEdit}
                                        sx={{ width: 100 }}
                                    />
                                )}
                                {field.type === 'select' && (
                                    <TextField
                                        key={`${field.key}-${draft.updated_at || ''}`}
                                        select size="small"
                                        SelectProps={{ native: true }}
                                        defaultValue={draft[field.key] || field.default}
                                        onChange={(e) => {
                                            setDraftValue(field.key, e.target.value);
                                            patchHero({ [field.key]: e.target.value });
                                        }}
                                        disabled={!canEdit}
                                        helperText={field.helpText}
                                        // Wide enough for a spelled-out option
                                        // ("3 levels — Module → Category →
                                        // Service"); the older single-word
                                        // selects don't mind the extra room.
                                        sx={{ width: field.helpText ? 320 : 180 }}
                                    >
                                        {/* Options are plain strings where the
                                            stored value IS the label, or
                                            {value, label} where the stored
                                            value is a code the operator should
                                            never have to read. */}
                                        {field.options.map((opt) => {
                                            const value = opt?.value ?? opt;
                                            return (
                                                <option key={value} value={value}>
                                                    {opt?.label ?? opt}
                                                </option>
                                            );
                                        })}
                                    </TextField>
                                )}
                                {field.type === 'text' && (
                                    <Box>
                                        <TextField
                                            key={`${field.key}-${draft.updated_at || ''}`}
                                            size="small" fullWidth
                                            defaultValue={draft[field.key] || ''}
                                            onChange={(e) => {
                                                setDraftValue(field.key, e.target.value);
                                                patchHero({ [field.key]: e.target.value });
                                            }}
                                            disabled={!canEdit}
                                            placeholder={field.placeholder}
                                        />
                                        {field.translatable && (
                                            <TranslationsEditor
                                                translations={draft.translations || {}}
                                                translatableKeys={[field.key]}
                                                defaults={{ [field.key]: draft[field.key] || '' }}
                                                onChange={(next) => patchTranslations(field.key, next)}
                                                publishedLanguages={draft.published_languages || ['en']}
                                            />
                                        )}
                                    </Box>
                                )}
                                {field.type === 'textarea' && (
                                    <Box>
                                        <TextField
                                            key={`${field.key}-${draft.updated_at || ''}`}
                                            size="small" fullWidth multiline rows={2}
                                            defaultValue={draft[field.key] || ''}
                                            onChange={(e) => {
                                                setDraftValue(field.key, e.target.value);
                                                patchHero({ [field.key]: e.target.value });
                                            }}
                                            disabled={!canEdit}
                                            placeholder={field.placeholder}
                                        />
                                        {field.translatable && (
                                            <TranslationsEditor
                                                translations={draft.translations || {}}
                                                translatableKeys={[field.key]}
                                                defaults={{ [field.key]: draft[field.key] || '' }}
                                                onChange={(next) => patchTranslations(field.key, next)}
                                                publishedLanguages={draft.published_languages || ['en']}
                                            />
                                        )}
                                    </Box>
                                )}
                                {field.type === 'json' && (
                                    <JsonArrayField
                                        field={field}
                                        value={draft[field.key]}
                                        onChange={(next) => set(field.key, next)}
                                        disabled={!canEdit}
                                    />
                                )}
                                {field.type === 'rows' && (() => {
                                    const meta = REPEATABLE_ROW_SCHEMAS[field.key];
                                    if (!meta) {
                                        return (
                                            <Typography variant="caption" color="error">
                                                Missing row schema for "{field.key}" — falling back to read-only.
                                            </Typography>
                                        );
                                    }
                                    return (
                                        <RepeatableRowsField
                                            field={field}
                                            value={draft[field.key]}
                                            onChange={(next) => set(field.key, next)}
                                            disabled={!canEdit}
                                            schema={meta.schema}
                                            newRow={meta.newRow}
                                        />
                                    );
                                })()}
                                {field.type === 'logo_upload' && (
                                    <LogoUploadField
                                        field={field}
                                        value={draft[field.key]}
                                        onChange={(next) => set(field.key, next)}
                                        disabled={!canEdit}
                                    />
                                )}
                            </Box>

                            {/* Display column — when the field is tied to a
                                section, render a Show/Hide switch that toggles
                                ``section_visibility[<section>]``. Multiple rows
                                of the same section share the toggle (so
                                flipping any one row flips the section). Fields
                                without a section show the static "Always
                                Visible" hint — they're brand-level / hero-level
                                bits that don't have an on/off concept. */}
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                                {field.section ? (() => {
                                    const visMap = draft.section_visibility || {};
                                    const visible = visMap[field.section] !== false;
                                    return (
                                        <Tooltip title={`Hide / show the entire "${field.section}" section on the public landing.`}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Typography
                                                    variant="caption"
                                                    color={!visible ? 'error.main' : 'text.disabled'}
                                                >
                                                    Hide
                                                </Typography>
                                                <Switch
                                                    size="small"
                                                    checked={visible}
                                                    onChange={(e) => set(
                                                        'section_visibility',
                                                        { ...visMap, [field.section]: e.target.checked },
                                                    )}
                                                    color="success"
                                                    disabled={!canEdit}
                                                />
                                                <Typography
                                                    variant="caption"
                                                    color={visible ? 'success.main' : 'text.disabled'}
                                                >
                                                    Show
                                                </Typography>
                                            </Box>
                                        </Tooltip>
                                    );
                                })() : (
                                    <Typography variant="caption" color="text.disabled">Always Visible</Typography>
                                )}
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography variant="caption" color="text.disabled">N/A</Typography>
                            </Box>
                        </Box>
                    ))}
                    </Box>
                    </Box>
                </CardContent>
            </Card>

            {/* ──────────────── Section Visibility ────────────────
                Only renders sections that DON'T have an inline Show/Hide
                row above — recognitions, videos, join_network, booking
                (anything else with a text field already exposes its
                toggle in the Display column). Empty list → card hides. */}
            <SectionVisibilityCard
                visibility={draft.section_visibility || {}}
                onChange={(next) => set('section_visibility', next)}
                disabled={!canEdit}
                hiddenSectionKeys={LANDING_FIELDS
                    .map((f) => f.section)
                    .filter(Boolean)}
            />

            {/* ──────────────── Modules CRUD table ──────────────── */}
            <Card>
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="h6">Modules (top navigation)</Typography>
                        {canEdit && (
                            <Button
                                variant="contained" startIcon={<AddIcon />}
                                onClick={() => setCreateOpen(true)}
                            >
                                New module
                            </Button>
                        )}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Modules render as navigation items on the public landing header. Click a row
                        to edit its name, icon, FAQ and features.
                    </Typography>
                    <Divider sx={{ mb: 1 }} />

                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell width={90}>Order</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Slug</TableCell>
                                <TableCell>Features</TableCell>
                                <TableCell align="center" width={90}>Visible</TableCell>
                                <TableCell align="center" width={90}>Slider</TableCell>
                                <TableCell align="right" width={120}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {isLoading && (
                                <TableRow><TableCell colSpan={7}>Loading…</TableCell></TableRow>
                            )}
                            {!isLoading && modules.length === 0 && (
                                <TableRow><TableCell colSpan={7}>No modules yet.</TableCell></TableRow>
                            )}
                            {modules.map((mod, idx) => (
                                <TableRow
                                    key={mod.id} hover
                                    onClick={() => openModule(mod.id)}
                                    sx={{ cursor: 'pointer' }}
                                >
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                        <IconButton
                                            size="small" disabled={!canEdit || idx === 0}
                                            onClick={() => moveModule(idx, -1)}
                                        >
                                            <ArrowUpwardIcon fontSize="inherit" />
                                        </IconButton>
                                        <IconButton
                                            size="small" disabled={!canEdit || idx === modules.length - 1}
                                            onClick={() => moveModule(idx, 1)}
                                        >
                                            <ArrowDownwardIcon fontSize="inherit" />
                                        </IconButton>
                                    </TableCell>
                                    <TableCell>{mod.name}</TableCell>
                                    <TableCell><code>{mod.slug}</code></TableCell>
                                    <TableCell>{(mod.features?.length ?? '—')}</TableCell>
                                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                        <Switch
                                            size="small" checked={!!mod.is_visible}
                                            onChange={() => handleToggleVisible(mod)}
                                            disabled={!canEdit}
                                        />
                                    </TableCell>
                                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                        <Tooltip title="Show in the public 'featured slider' (third sliding bar)">
                                            <Switch
                                                size="small" checked={!!mod.show_in_slider}
                                                onChange={() => handleToggleSlider(mod)}
                                                disabled={!canEdit}
                                            />
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                        <Tooltip title="Open module editor">
                                            <IconButton onClick={() => openModule(mod.id)}>
                                                <EditIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete module">
                                            <span>
                                                <IconButton
                                                    color="error" disabled={!canEdit}
                                                    onClick={() => handleDelete(mod)}
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

            {canEdit && (
                <ModuleCreateDialog
                    open={createOpen} onClose={() => setCreateOpen(false)}
                    onCreate={handleCreate} isSaving={createState.isLoading}
                    lastError={createState.error}
                />
            )}
        </Box>
    );
};

export default EditorTab;
