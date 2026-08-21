/**
 * FieldEditor — Renders a single field config row within a section table.
 * Shows: S.No | Field Key | Label | Type | Display Toggle | Mandatory Toggle | Data Source
 * Includes inline translations editor with dynamic language support.
 * For select/multi_select/radio/checkbox fields without a data_source, shows an
 * expandable options editor sub-row with individual editing, delete, add, and bulk upload.
 */
import { useState, useRef, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import * as XLSX from 'xlsx';
import {
    Box, Typography, TextField, Switch, Chip, Select, MenuItem,
    FormControl, IconButton, Button, Collapse, TextareaAutosize,
    Dialog, DialogTitle, DialogContent, DialogActions, Tooltip,
} from '@mui/material';
import {
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    Close as CloseIcon,
    Add as AddIcon,
    UploadFile as UploadFileIcon,
    Delete as DeleteIcon,
} from '@mui/icons-material';
import { TranslationsEditor } from '../../../../../../common/i18n';
import { apiSlice } from '../../../../../../app/api/apiSlice';
import {
    useCreateMasterCollegeByLevelMutation,
    useUpdateMasterCollegeByLevelMutation,
    useDeleteMasterCollegeByLevelMutation,
    useBulkCreateMasterCollegesMutation,
    useGetMasterCollegesByLevelQuery,
    useCreateMasterDegreeByLevelMutation,
    useUpdateMasterDegreeByLevelMutation,
    useDeleteMasterDegreeByLevelMutation,
    useBulkCreateMasterDegreesMutation,
    useGetMasterDegreesByLevelQuery,
    useCreateMasterSpecializationByLevelMutation,
    useUpdateMasterSpecializationByLevelMutation,
    useDeleteMasterSpecializationByLevelMutation,
    useBulkCreateMasterSpecializationsMutation,
    useGetMasterSpecializationsByLevelQuery,
} from '../../../../api/doctorSignupConfigEndpoints';

// Parse a data_source string like ``master_colleges:ug`` into a
// ``{ kind, level }`` tuple. Returns null for anything that isn't a
// level-scoped master-data source — static lists (master_states,
// master_religions) keep the legacy field.options behaviour.
const KIND_RE = /^master_(colleges|degrees|specializations):(ug|pg|super_speciality)$/;
function parseMasterDataSource(source) {
    if (!source) return null;
    const m = KIND_RE.exec(source);
    if (!m) return null;
    return { kind: m[1], level: m[2] };
}

// Field types available for doctor profile fields
const FIELD_TYPES = [
    'text', 'textarea', 'number', 'tel', 'email', 'date',
    'select', 'multi_select', 'radio', 'checkbox', 'file',
];

// Field types that support user-defined options
const OPTION_TYPES = ['select', 'multi_select', 'radio', 'checkbox'];

const FieldEditor = ({
    field, index, onFieldChange, onRemoveField, dataSources, disabled,
    /**
     * Optional flusher registry — when provided, master-backed
     * fields register a flush callback under their field.id so the
     * parent's Save Draft can diff field.options vs masterRows and
     * emit master_data CRUD in one batch. When omitted, the
     * master_data side stays untouched (back-compat for editors
     * that haven't wired this up yet).
     */
    registerOptionsFlusher,
}) => {
    const [optionsOpen, setOptionsOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkText, setBulkText] = useState('');
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    // Local editing buffer for master-backed options. ``null`` means
    // "use the live masterRows" (untouched). Once the user makes
    // any edit, we capture the current list here and all subsequent
    // edits go through this buffer until Save Draft runs the
    // flusher (below). This avoids the per-keystroke
    // masterApi.update → cache invalidate → backend refetch →
    // alphabetical re-sort cycle that scrambled rows mid-typing.
    const [localMasterOptions, setLocalMasterOptions] = useState(null);
    const excelInputRef = useRef(null);
    const dispatch = useDispatch();

    const handleChange = (key, value) => {
        onFieldChange(field.id, key, value);
    };

    // ── Master-data routing ───────────────────────────────────────────
    //
    // When a field's data_source matches a level-scoped master table
    // (``master_(colleges|degrees|specializations):(ug|pg|super_speciality)``),
    // typing into the Options block writes to MASTER DATA — not to the
    // field's per-page ``options`` JSON. The single workflow:
    // type once, reflects on doctor profile + signup + every other
    // page that uses the same data_source.
    //
    // For static / non-level-scoped sources (master_states,
    // master_religions, …) the legacy field.options behaviour is
    // preserved.
    const masterMeta = parseMasterDataSource(field.data_source);
    const isMasterBacked = !!masterMeta;

    // Mutation hooks — instantiated for all three kinds so the
    // helper below can pick whichever matches the field's data_source.
    const [createCollege] = useCreateMasterCollegeByLevelMutation();
    const [updateCollege] = useUpdateMasterCollegeByLevelMutation();
    const [deleteCollege] = useDeleteMasterCollegeByLevelMutation();
    const [bulkCreateColleges] = useBulkCreateMasterCollegesMutation();
    const [createDegree] = useCreateMasterDegreeByLevelMutation();
    const [updateDegree] = useUpdateMasterDegreeByLevelMutation();
    const [deleteDegree] = useDeleteMasterDegreeByLevelMutation();
    const [bulkCreateDegrees] = useBulkCreateMasterDegreesMutation();
    const [createSpec] = useCreateMasterSpecializationByLevelMutation();
    const [updateSpec] = useUpdateMasterSpecializationByLevelMutation();
    const [deleteSpec] = useDeleteMasterSpecializationByLevelMutation();
    const [bulkCreateSpecs] = useBulkCreateMasterSpecializationsMutation();

    // Live master-data query for this field's (kind, level) — drives
    // the displayed list AND gives us the id needed for update/delete.
    const masterQ = useGetMasterCollegesByLevelQuery(
        { level: masterMeta?.level, activeOnly: false },
        { skip: !masterMeta || masterMeta.kind !== 'colleges' },
    );
    const degreeQ = useGetMasterDegreesByLevelQuery(
        { level: masterMeta?.level, activeOnly: false },
        { skip: !masterMeta || masterMeta.kind !== 'degrees' },
    );
    const specQ = useGetMasterSpecializationsByLevelQuery(
        { level: masterMeta?.level, activeOnly: false },
        { skip: !masterMeta || masterMeta.kind !== 'specializations' },
    );
    const masterRows = masterMeta?.kind === 'colleges' ? (masterQ.data || [])
        : masterMeta?.kind === 'degrees' ? (degreeQ.data || [])
        : masterMeta?.kind === 'specializations' ? (specQ.data || [])
        : [];

    // Forces the parent's draft GET to refetch resolved data_sources
    // after a master-data write. The mutation hooks already invalidate
    // their own MasterX tags; this extra invalidation makes the
    // already-rendered ``dataSources`` object pick up the change too.
    const refreshParentDataSources = () => {
        dispatch(apiSlice.util.invalidateTags([
            { type: 'DoctorProfileConfig', id: 'DRAFT' },
        ]));
    };

    // Show options editor for any option-type field (regardless of data_source)
    const hasOptionsEditor = OPTION_TYPES.includes(field.field_type);
    const storedOptions = Array.isArray(field.options) ? field.options : [];

    // The displayed option list. For master-backed fields the
    // precedence is:
    //   1. ``localMasterOptions`` — set on first keystroke in this
    //      mount. Reflects the user's in-progress edits, preserves
    //      input order so the row they're typing into doesn't move.
    //   2. ``storedOptions`` (field.options) — the saved-but-not-
    //      published buffer. Survives page reload so the operator
    //      can keep working on a draft across sessions. Cleared
    //      after Publish flushes to master_data.
    //   3. ``masterRows`` — the live master catalog. Used when no
    //      edits exist in either buffer above.
    // For static fields it's field.options merged with resolved
    // data_source as a fallback.
    let options;
    if (isMasterBacked) {
        if (localMasterOptions !== null) {
            options = localMasterOptions;
        } else if (storedOptions.length > 0) {
            options = storedOptions;
        } else {
            options = masterRows.map((r) => r.name);
        }
    } else {
        const resolvedDataSourceOptions = (field.data_source && dataSources?.[field.data_source])
            ? dataSources[field.data_source].map((o) => (typeof o === 'string' ? o : (o.name || o.id || String(o))))
            : [];
        options = storedOptions.length > 0 ? storedOptions : resolvedDataSourceOptions;
    }

    // Snapshot of the master rows at the moment the user started
    // editing. Used by the flusher below to compute the diff
    // (additions / deletions) against masterRows AT FLUSH TIME — but
    // the snapshot helps us detect "actual user intent" even if
    // someone else mutated master_data between mount and save.
    const masterSnapshotRef = useRef(null);

    // Convenience — give every edit handler a single base array to
    // start from, whether or not the user has already touched the
    // list. First touch seeds ``localMasterOptions`` from masterRows
    // so the buffer is complete (we don't want a "delete option 3"
    // operation to nuke options 1 and 2).
    const ensureMasterBuffer = () => {
        if (localMasterOptions !== null) return localMasterOptions;
        const seed = masterRows.map((r) => r.name);
        masterSnapshotRef.current = seed;
        setLocalMasterOptions(seed);
        return seed;
    };

    // For static-options paths the base list is field.options first,
    // resolved data_source as fallback (kept for back-compat).
    const getBaseOptions = () => {
        const fallback = (field.data_source && dataSources?.[field.data_source])
            ? dataSources[field.data_source].map((o) => (typeof o === 'string' ? o : (o.name || o.id || String(o))))
            : [];
        return storedOptions.length > 0 ? storedOptions : fallback;
    };

    // Pick the right CRUD set for the field's master_data kind.
    const masterApi = masterMeta && {
        colleges: { create: createCollege, update: updateCollege, del: deleteCollege, bulk: bulkCreateColleges },
        degrees:  { create: createDegree,  update: updateDegree,  del: deleteDegree,  bulk: bulkCreateDegrees },
        specializations: { create: createSpec, update: updateSpec, del: deleteSpec, bulk: bulkCreateSpecs },
    }[masterMeta.kind];

    /* ---- option-level handlers ----
     *
     * All edits update LOCAL state only. The backend write (master_data
     * CRUD for master-backed fields, PageFieldConfig.options for static
     * fields) happens exclusively on Save Draft via the flusher
     * registered below. This is a deliberate departure from the earlier
     * "auto-save on every keystroke" behaviour, which caused the
     * symptom the user reported: master rows came back sorted
     * alphabetically on every refetch so the list re-ordered while
     * the user was still typing.
     */

    const handleOptionChange = (idx, value) => {
        if (isMasterBacked) {
            const base = ensureMasterBuffer();
            const next = [...base];
            next[idx] = value;
            setLocalMasterOptions(next);
            // Mirror into field.options so the parent's
            // ``hasUnsavedChanges`` flag flips and the field-config
            // save path knows about the dirty state too.
            handleChange('options', next);
            return;
        }
        const next = [...getBaseOptions()];
        next[idx] = value;
        handleChange('options', next);
    };

    const handleDeleteOption = (idx) => {
        if (isMasterBacked) {
            const base = ensureMasterBuffer();
            const next = base.filter((_, i) => i !== idx);
            setLocalMasterOptions(next);
            handleChange('options', next);
            return;
        }
        handleChange('options', getBaseOptions().filter((_, i) => i !== idx));
    };

    const handleAddOption = () => {
        if (isMasterBacked) {
            const base = ensureMasterBuffer();
            const next = [...base, ''];
            setLocalMasterOptions(next);
            handleChange('options', next);
            if (!optionsOpen) setOptionsOpen(true);
            return;
        }
        handleChange('options', [...getBaseOptions(), '']);
        if (!optionsOpen) setOptionsOpen(true);
    };

    const handleBulkApply = () => {
        const lines = bulkText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        if (!lines.length) {
            setBulkText('');
            setBulkOpen(false);
            return;
        }
        if (isMasterBacked) {
            const base = ensureMasterBuffer();
            const next = [...base, ...lines];
            setLocalMasterOptions(next);
            handleChange('options', next);
        } else {
            handleChange('options', [...getBaseOptions(), ...lines]);
        }
        setBulkText('');
        setBulkOpen(false);
    };

    const handleExcelUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const workbook = XLSX.read(evt.target.result, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const newOpts = rows
                    .map((row) => String(row[0] ?? '').trim())
                    .filter(Boolean);
                if (!newOpts.length) return;
                if (isMasterBacked) {
                    const base = ensureMasterBuffer();
                    const next = [...base, ...newOpts];
                    setLocalMasterOptions(next);
                    handleChange('options', next);
                } else {
                    handleChange('options', [...getBaseOptions(), ...newOpts]);
                }
                if (!optionsOpen) setOptionsOpen(true);
            } catch (err) {
                console.error('Excel parse error:', err);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    };

    /* ---- Save-time flusher ---------------------------------------- */
    //
    // Master-backed fields register a flush callback under their
    // field.id when ``registerOptionsFlusher`` is supplied. The
    // parent's ``handleSaveDraft`` iterates registered flushers and
    // awaits each one, so all the deferred master_data writes happen
    // in a single coordinated batch right after the field-config
    // save. The flusher diffs the local buffer against the live
    // masterRows snapshot:
    //   * names in buffer but not in masterRows → create (bulk).
    //   * names in masterRows but not in buffer → delete.
    //   * (Renames are not detected — they manifest as delete+create.
    //     Position-based rename detection is unreliable across server
    //     sorts; fixing it cleanly needs IDs on field.options, which
    //     is a bigger change.)
    useEffect(() => {
        if (!isMasterBacked || !masterApi || !registerOptionsFlusher) {
            return undefined;
        }
        const flusher = async () => {
            // Pick whichever buffer holds the user's pending intent:
            //   * ``localMasterOptions`` — fresh in-memory edits (this
            //     mount has been touched).
            //   * ``storedOptions`` — survived a Save Draft + reload,
            //     loaded back from PageFieldConfig.options.
            // Falling through to ``null`` means there's nothing to
            // publish for this field — skip silently.
            let desiredRaw;
            if (localMasterOptions !== null) {
                desiredRaw = localMasterOptions;
            } else if (storedOptions.length > 0) {
                desiredRaw = storedOptions;
            } else {
                return;
            }
            const desired = desiredRaw
                .map((s) => (typeof s === 'string' ? s.trim() : ''))
                .filter(Boolean);
            const currentNames = masterRows.map((r) => r.name);
            const toCreate = desired.filter((n) => !currentNames.includes(n));
            const toDelete = masterRows.filter((r) => !desired.includes(r.name));

            // Skip the network round-trip when nothing actually
            // changed (e.g. operator saved draft, didn't touch
            // anything, then hit Publish — the buffered options
            // already match master_data).
            if (!toCreate.length && !toDelete.length) {
                return;
            }

            if (toCreate.length) {
                await masterApi.bulk({
                    names: toCreate,
                    qualification_level: masterMeta.level,
                }).unwrap();
            }
            for (const r of toDelete) {
                await masterApi.del(r.id).unwrap();
            }

            refreshParentDataSources();
            // Reset local buffer so the next render reads from the
            // freshly-refetched masterRows. Also clear field.options
            // — master_data is now the source of truth again.
            setLocalMasterOptions(null);
            masterSnapshotRef.current = null;
            handleChange('options', []);
        };
        registerOptionsFlusher(field.id, flusher);
        return () => registerOptionsFlusher(field.id, null);
    }, [
        field.id, isMasterBacked, masterApi, registerOptionsFlusher,
        localMasterOptions, storedOptions, masterRows, masterMeta?.level,
    ]);

    return (
        <>
            {/* ---- Main field row ---- */}
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: '50px 140px 1fr 120px 120px 120px 150px 50px',
                    gap: 1,
                    alignItems: 'center',
                    p: 1,
                    borderBottom: '1px solid',
                    borderLeft: '1px solid',
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                    '&:hover': { bgcolor: '#e3f2fd' },
                }}
            >
                {/* S.No */}
                <Typography textAlign="center" fontWeight="500" fontSize="0.85rem">
                    {String(index + 1).padStart(2, '0')}
                </Typography>

                {/* Field Key */}
                <Typography fontSize="0.8rem" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {field.field_key}
                </Typography>

                {/* Label (editable) + Placeholder + Translations */}
                <Box>
                    <TextField
                        size="small"
                        fullWidth
                        value={field.label || ''}
                        onChange={(e) => handleChange('label', e.target.value)}
                        disabled={disabled}
                        placeholder="Field label"
                    />
                    {field.placeholder !== undefined && field.placeholder !== null && (
                        <TextField
                            size="small"
                            fullWidth
                            value={field.placeholder || ''}
                            onChange={(e) => handleChange('placeholder', e.target.value)}
                            disabled={disabled}
                            placeholder="Placeholder text"
                            sx={{ mt: 0.5 }}
                            InputProps={{ sx: { fontSize: '0.8rem' } }}
                        />
                    )}
                    <TranslationsEditor
                        translations={field.translations || {}}
                        translatableKeys={['label', 'placeholder']}
                        defaults={{ label: field.label, placeholder: field.placeholder }}
                        onChange={(t) => handleChange('translations', t)}
                    />
                </Box>

                {/* Type — read-only chip; type is fixed at field creation */}
                <Chip
                    label={field.field_type || 'text'}
                    size="small"
                    variant="outlined"
                    color={field.is_default ? 'default' : 'secondary'}
                    sx={{ fontSize: '0.7rem', width: '100%' }}
                />

                {/* Display Toggle */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color={!field.is_present ? 'error.main' : 'text.disabled'}>
                        Hide
                    </Typography>
                    <Switch
                        size="small"
                        checked={field.is_present ?? true}
                        onChange={(e) => handleChange('is_present', e.target.checked)}
                        color="success"
                        disabled={disabled}
                    />
                    <Typography variant="caption" color={field.is_present ? 'success.main' : 'text.disabled'}>
                        Show
                    </Typography>
                </Box>

                {/* Mandatory Toggle */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color={!field.required ? 'text.primary' : 'text.disabled'}>
                        Optional
                    </Typography>
                    <Switch
                        size="small"
                        checked={field.required ?? false}
                        onChange={(e) => handleChange('required', e.target.checked)}
                        color="success"
                        disabled={disabled}
                    />
                    <Typography variant="caption" color={field.required ? 'success.main' : 'text.disabled'}>
                        Required
                    </Typography>
                </Box>

                {/* Data Source */}
                <Box>
                    {field.data_source ? (
                        <Chip
                            label={field.data_source}
                            size="small"
                            color="info"
                            variant="outlined"
                            sx={{ fontSize: '0.65rem', maxWidth: '100%' }}
                        />
                    ) : (
                        <Typography variant="caption" color="text.disabled">&mdash;</Typography>
                    )}
                </Box>

                {/* Delete — only for non-default admin-added fields */}
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    {!field.is_default && !disabled && onRemoveField ? (
                        <Tooltip title="Delete this field">
                            <IconButton
                                size="small"
                                color="error"
                                onClick={() => setDeleteConfirmOpen(true)}
                                sx={{ p: 0.25 }}
                            >
                                <DeleteIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>
                            {field.is_default ? 'built-in' : ''}
                        </Typography>
                    )}
                </Box>
            </Box>

            {/* Delete confirmation dialog */}
            {!field.is_default && (
                <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="xs">
                    <DialogTitle>Delete Field</DialogTitle>
                    <DialogContent>
                        <Typography>
                            Delete field <strong>{field.label}</strong> (<code>{field.field_key}</code>)?
                            This cannot be undone.
                        </Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
                        <Button
                            color="error"
                            variant="contained"
                            onClick={() => { setDeleteConfirmOpen(false); onRemoveField(field.id); }}
                        >
                            Delete
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            {/* ---- Options editor sub-row (expandable) ---- */}
            {hasOptionsEditor && (
                <Box
                    sx={{
                        borderBottom: '1px solid',
                        borderLeft: '1px solid',
                        borderRight: '1px solid',
                        borderColor: 'divider',
                        bgcolor: '#f5f5f5',
                    }}
                >
                    {/* Toggle bar */}
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            px: 2,
                            py: 0.5,
                            cursor: 'pointer',
                            userSelect: 'none',
                            '&:hover': { bgcolor: '#eeeeee' },
                        }}
                        onClick={() => setOptionsOpen((prev) => !prev)}
                    >
                        {optionsOpen ? (
                            <ExpandLessIcon fontSize="small" />
                        ) : (
                            <ExpandMoreIcon fontSize="small" />
                        )}
                        <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 500 }}>
                            Options ({options.length})
                        </Typography>
                    </Box>

                    <Collapse in={optionsOpen} timeout="auto" unmountOnExit>
                        <Box sx={{ px: 3, pb: 1.5 }}>
                            {/* Individual option rows */}
                            {options.map((opt, idx) => (
                                <Box
                                    key={idx}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                        mb: 0.5,
                                    }}
                                >
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ minWidth: 24, textAlign: 'right' }}
                                    >
                                        {idx + 1}.
                                    </Typography>
                                    <TextField
                                        size="small"
                                        value={opt}
                                        onChange={(e) => handleOptionChange(idx, e.target.value)}
                                        disabled={disabled}
                                        placeholder={`Option ${idx + 1}`}
                                        sx={{ flex: 1 }}
                                        InputProps={{ sx: { fontSize: '0.8rem' } }}
                                    />
                                    <IconButton
                                        size="small"
                                        onClick={() => handleDeleteOption(idx)}
                                        disabled={disabled}
                                        sx={{ color: 'error.main' }}
                                    >
                                        <CloseIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            ))}

                            {/* Action buttons */}
                            <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={handleAddOption}
                                    disabled={disabled}
                                >
                                    Add Option
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    color="success"
                                    startIcon={<UploadFileIcon />}
                                    onClick={() => excelInputRef.current?.click()}
                                    disabled={disabled}
                                >
                                    Excel Upload
                                </Button>
                                <input
                                    ref={excelInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    style={{ display: 'none' }}
                                    onChange={handleExcelUpload}
                                />
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<UploadFileIcon />}
                                    onClick={() => setBulkOpen((prev) => !prev)}
                                    disabled={disabled}
                                >
                                    Bulk Paste
                                </Button>
                            </Box>

                            {/* Bulk upload textarea */}
                            <Collapse in={bulkOpen} timeout="auto" unmountOnExit>
                                <Box sx={{ mt: 1 }}>
                                    <TextareaAutosize
                                        minRows={3}
                                        maxRows={8}
                                        placeholder="Paste options here (one per line)"
                                        value={bulkText}
                                        onChange={(e) => setBulkText(e.target.value)}
                                        disabled={disabled}
                                        style={{
                                            width: '100%',
                                            fontFamily: 'inherit',
                                            fontSize: '0.8rem',
                                            padding: '8px',
                                            borderRadius: '4px',
                                            border: '1px solid #ccc',
                                            resize: 'vertical',
                                        }}
                                    />
                                    <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                                        <Button
                                            size="small"
                                            variant="contained"
                                            onClick={handleBulkApply}
                                            disabled={disabled || !bulkText.trim()}
                                        >
                                            Apply
                                        </Button>
                                        <Button
                                            size="small"
                                            variant="text"
                                            onClick={() => {
                                                setBulkText('');
                                                setBulkOpen(false);
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                    </Box>
                                </Box>
                            </Collapse>
                        </Box>
                    </Collapse>
                </Box>
            )}
        </>
    );
};

export default FieldEditor;
