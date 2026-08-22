/**
 * FieldEditor — Renders a single field config row within a section table.
 * Shows: S.No | Field Key | Label | Type | Display Toggle | Mandatory Toggle | Data Source
 * Includes inline translations editor with dynamic language support.
 * Includes expandable options editor for select/multi_select/radio/checkbox fields.
 */
import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
    Box, Typography, TextField, Switch, Chip, Select, MenuItem,
    FormControl, IconButton, Collapse, Button, Tooltip, TextareaAutosize,
    Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ListIcon from '@mui/icons-material/List';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { TranslationsEditor } from '../../../../../../common/i18n';

// Field types available for patient profile fields
const FIELD_TYPES = [
    'text', 'textarea', 'number', 'tel', 'email', 'date',
    'select', 'multi_select', 'radio', 'checkbox', 'file',
    'repeater', 'record_list', 'group_manager',
];

// Field types that support an options list
const OPTION_TYPES = new Set(['select', 'multi_select', 'radio', 'checkbox']);

const FieldEditor = ({ field, index, onFieldChange, onRemoveField, dataSources, disabled }) => {
    const [optionsExpanded, setOptionsExpanded] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [bulkText, setBulkText] = useState('');
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const excelInputRef = useRef(null);

    const handleChange = (key, value) => {
        onFieldChange(field.id, key, value);
    };

    // Show options editor for any option-type field (regardless of data_source)
    const hasOptions = OPTION_TYPES.has(field.field_type);
    const storedOptions = Array.isArray(field.options) ? field.options : [];

    // If field has a data_source but no custom options yet, pre-populate from resolved data
    const resolvedDataSourceOptions = (field.data_source && dataSources?.[field.data_source])
        ? dataSources[field.data_source].map((o) => (typeof o === 'string' ? o : (o.name || o.id || String(o))))
        : [];
    const options = storedOptions.length > 0 ? storedOptions : resolvedDataSourceOptions;

    // --- Options helpers ---
    // Writing options always stores to field.options (overrides data_source defaults)
    const updateOptions = (newOptions) => {
        handleChange('options', newOptions);
    };

    // When editing resolved data-source options, first bake them into field.options
    const getBaseOptions = () => (storedOptions.length > 0 ? storedOptions : resolvedDataSourceOptions);

    const handleOptionEdit = (idx, value) => {
        const next = [...getBaseOptions()];
        next[idx] = value;
        updateOptions(next);
    };

    const handleOptionDelete = (idx) => {
        updateOptions(getBaseOptions().filter((_, i) => i !== idx));
    };

    const handleOptionAdd = () => {
        updateOptions([...getBaseOptions(), '']);
    };

    const handleMoveUp = (idx) => {
        if (idx === 0) return;
        const next = [...getBaseOptions()];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        updateOptions(next);
    };

    const handleMoveDown = (idx) => {
        if (idx >= options.length - 1) return;
        const next = [...getBaseOptions()];
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        updateOptions(next);
    };

    const handleBulkUpload = () => {
        const lines = bulkText
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length > 0) {
            updateOptions([...getBaseOptions(), ...lines]);
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
                if (newOpts.length > 0) {
                    updateOptions([...getBaseOptions(), ...newOpts]);
                    if (!optionsExpanded) setOptionsExpanded(true);
                }
            } catch (err) {
                console.error('Excel parse error:', err);
            }
        };
        reader.readAsArrayBuffer(file);
        e.target.value = '';
    };

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
                    borderBottom: hasOptions && optionsExpanded ? 'none' : '1px solid',
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
                    {/* Options chip — opens the expandable sub-row below */}
                    {hasOptions && (
                        <Chip
                            icon={<ListIcon sx={{ fontSize: 14 }} />}
                            label={`Options (${options.length})`}
                            size="small"
                            color={optionsExpanded ? 'primary' : 'default'}
                            variant={optionsExpanded ? 'filled' : 'outlined'}
                            onClick={() => setOptionsExpanded((v) => !v)}
                            onDelete={optionsExpanded ? () => setOptionsExpanded(false) : undefined}
                            deleteIcon={optionsExpanded ? <ExpandLessIcon /> : undefined}
                            sx={{ mt: 0.5, fontSize: '0.7rem', cursor: 'pointer' }}
                        />
                    )}
                    <TranslationsEditor
                        translations={field.translations || {}}
                        translatableKeys={['label', 'placeholder']}
                        defaults={{ label: field.label, placeholder: field.placeholder }}
                        onChange={(t) => handleChange('translations', t)}
                    />
                </Box>

                {/* Type — read-only for all existing fields (type is set only at creation) */}
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

            {/* ---- Expandable Options sub-row ---- */}
            {hasOptions && (
                <Collapse in={optionsExpanded}>
                    <Box
                        sx={{
                            ml: '50px',
                            mr: 0,
                            p: 1.5,
                            bgcolor: '#f0f4ff',
                            borderLeft: '3px solid',
                            borderRight: '1px solid',
                            borderBottom: '1px solid',
                            borderColor: 'primary.light',
                            borderBottomColor: 'divider',
                            borderRightColor: 'divider',
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                            <Typography variant="caption" fontWeight={600} color="primary.main">
                                Options Editor
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 0.5 }}>
                                <Tooltip title="Import from Excel (.xlsx/.xls) — first column used">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        color="success"
                                        startIcon={<UploadFileIcon sx={{ fontSize: 14 }} />}
                                        onClick={() => excelInputRef.current?.click()}
                                        disabled={disabled}
                                        sx={{ fontSize: '0.7rem', textTransform: 'none', py: 0.25 }}
                                    >
                                        Excel
                                    </Button>
                                </Tooltip>
                                <input
                                    ref={excelInputRef}
                                    type="file"
                                    accept=".xlsx,.xls,.csv"
                                    style={{ display: 'none' }}
                                    onChange={handleExcelUpload}
                                />
                                <Tooltip title="Bulk upload options (one per line)">
                                    <Button
                                        size="small"
                                        variant="outlined"
                                        startIcon={<UploadFileIcon sx={{ fontSize: 14 }} />}
                                        onClick={() => setBulkOpen((v) => !v)}
                                        disabled={disabled}
                                        sx={{ fontSize: '0.7rem', textTransform: 'none', py: 0.25 }}
                                    >
                                        Bulk Paste
                                    </Button>
                                </Tooltip>
                                <Tooltip title="Add a single option">
                                    <Button
                                        size="small"
                                        variant="contained"
                                        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
                                        onClick={handleOptionAdd}
                                        disabled={disabled}
                                        sx={{ fontSize: '0.7rem', textTransform: 'none', py: 0.25 }}
                                    >
                                        Add Option
                                    </Button>
                                </Tooltip>
                            </Box>
                        </Box>

                        {/* Bulk upload area */}
                        <Collapse in={bulkOpen}>
                            <Box sx={{ mb: 1.5, p: 1, bgcolor: 'white', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                    Paste options below, one per line. They will be appended to the existing list.
                                </Typography>
                                <TextareaAutosize
                                    minRows={3}
                                    maxRows={8}
                                    value={bulkText}
                                    onChange={(e) => setBulkText(e.target.value)}
                                    disabled={disabled}
                                    placeholder={'Option A\nOption B\nOption C'}
                                    style={{
                                        width: '100%',
                                        fontFamily: 'inherit',
                                        fontSize: '0.8rem',
                                        padding: '6px 8px',
                                        borderRadius: 4,
                                        border: '1px solid #ccc',
                                        resize: 'vertical',
                                        boxSizing: 'border-box',
                                    }}
                                />
                                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5, mt: 0.5 }}>
                                    <Button
                                        size="small"
                                        onClick={() => { setBulkText(''); setBulkOpen(false); }}
                                        sx={{ fontSize: '0.7rem', textTransform: 'none' }}
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        size="small"
                                        variant="contained"
                                        onClick={handleBulkUpload}
                                        disabled={disabled || !bulkText.trim()}
                                        sx={{ fontSize: '0.7rem', textTransform: 'none' }}
                                    >
                                        Add All
                                    </Button>
                                </Box>
                            </Box>
                        </Collapse>

                        {/* Individual options list */}
                        {options.length === 0 && (
                            <Typography variant="caption" color="text.disabled" sx={{ display: 'block', py: 1, textAlign: 'center' }}>
                                No options yet. Click "Add Option" or use "Bulk Upload" to add options.
                            </Typography>
                        )}

                        {options.map((opt, idx) => (
                            <Box
                                key={idx}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    mb: 0.5,
                                    '&:hover': { bgcolor: 'rgba(0,0,0,0.02)' },
                                    borderRadius: 0.5,
                                    px: 0.5,
                                }}
                            >
                                {/* Index label */}
                                <Typography
                                    variant="caption"
                                    color="text.disabled"
                                    sx={{ minWidth: 24, textAlign: 'right', fontFamily: 'monospace', fontSize: '0.7rem' }}
                                >
                                    {idx + 1}.
                                </Typography>

                                {/* Editable option value */}
                                <TextField
                                    size="small"
                                    fullWidth
                                    value={opt}
                                    onChange={(e) => handleOptionEdit(idx, e.target.value)}
                                    disabled={disabled}
                                    placeholder={`Option ${idx + 1}`}
                                    InputProps={{ sx: { fontSize: '0.8rem', bgcolor: 'white' } }}
                                    sx={{ flex: 1 }}
                                />

                                {/* Move up */}
                                <Tooltip title="Move up">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => handleMoveUp(idx)}
                                            disabled={disabled || idx === 0}
                                            sx={{ p: 0.25 }}
                                        >
                                            <ArrowUpwardIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </span>
                                </Tooltip>

                                {/* Move down */}
                                <Tooltip title="Move down">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => handleMoveDown(idx)}
                                            disabled={disabled || idx >= options.length - 1}
                                            sx={{ p: 0.25 }}
                                        >
                                            <ArrowDownwardIcon sx={{ fontSize: 16 }} />
                                        </IconButton>
                                    </span>
                                </Tooltip>

                                {/* Delete */}
                                <Tooltip title="Remove option">
                                    <IconButton
                                        size="small"
                                        onClick={() => handleOptionDelete(idx)}
                                        disabled={disabled}
                                        color="error"
                                        sx={{ p: 0.25 }}
                                    >
                                        <CloseIcon sx={{ fontSize: 16 }} />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        ))}
                    </Box>
                </Collapse>
            )}
        </>
    );
};

export default FieldEditor;
