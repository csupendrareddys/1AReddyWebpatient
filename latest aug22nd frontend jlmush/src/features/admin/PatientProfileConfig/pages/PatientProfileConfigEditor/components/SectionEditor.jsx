/**
 * SectionEditor — Renders a collapsible section with its field configs in a table.
 * Section label is editable inline by admin.
 * Supports adding new fields dynamically and removing existing fields.
 */
import { useState } from 'react';
import {
    Box, Typography, Switch, Collapse, IconButton, Card, CardContent, TextField,
    Button, Dialog, DialogTitle, DialogContent, DialogActions, Select, MenuItem,
    FormControl, InputLabel, Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import FieldEditor from './FieldEditor';

// Field types available when adding new fields
const NEW_FIELD_TYPES = [
    'text', 'textarea', 'number', 'tel', 'email', 'date',
    'select', 'multi_select', 'radio', 'checkbox', 'file',
];

const SectionEditor = ({
    section,
    fieldConfigs,
    onSectionChange,
    onFieldChange,
    onAddField,
    onRemoveField,
    dataSources,
    disabled,
}) => {
    const [expanded, setExpanded] = useState(true);
    const [editingLabel, setEditingLabel] = useState(false);
    const [labelValue, setLabelValue] = useState(section.label || '');
    const [showAddFieldDialog, setShowAddFieldDialog] = useState(false);
    const [newField, setNewField] = useState({
        field_key: '',
        label: '',
        placeholder: '',
        field_type: 'text',
        required: false,
        options: '',
    });

    const sectionFields = fieldConfigs
        .filter((f) => f.section === section.key)
        .sort((a, b) => a.display_order - b.display_order);

    const handleLabelSave = (e) => {
        e.stopPropagation();
        if (labelValue.trim() && labelValue !== section.label) {
            onSectionChange(section.key, 'label', labelValue.trim());
        }
        setEditingLabel(false);
    };

    const handleLabelEdit = (e) => {
        e.stopPropagation();
        setLabelValue(section.label || '');
        setEditingLabel(true);
    };

    const handleAddNewField = () => {
        if (!newField.field_key.trim() || !newField.label.trim()) return;
        const fieldData = {
            section: section.key,
            field_key: newField.field_key.trim().toLowerCase().replace(/\s+/g, '_'),
            label: newField.label.trim(),
            placeholder: newField.placeholder.trim() || null,
            field_type: newField.field_type,
            required: newField.required,
            display_order: sectionFields.length + 1,
            is_present: true,
            options: ['select', 'radio', 'checkbox', 'multi_select'].includes(newField.field_type) && newField.options
                ? newField.options.split(',').map((s) => s.trim()).filter(Boolean)
                : null,
        };
        if (onAddField) onAddField(fieldData);
        setShowAddFieldDialog(false);
        setNewField({ field_key: '', label: '', placeholder: '', field_type: 'text', required: false, options: '' });
    };

    return (
        <Card sx={{ mb: 2, border: '1px solid', borderColor: section.is_present === false ? 'error.light' : 'divider', opacity: section.is_present === false ? 0.7 : 1 }}>
            {/* Section Header */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    p: 1.5,
                    bgcolor: section.is_present === false ? '#ffebee' : '#e3f2fd',
                    cursor: 'pointer',
                }}
                onClick={() => setExpanded(!expanded)}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                    <IconButton size="small">
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>

                    {/* Editable section label */}
                    {editingLabel && !disabled ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                            <TextField
                                size="small"
                                value={labelValue}
                                onChange={(e) => setLabelValue(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleLabelSave(e); if (e.key === 'Escape') setEditingLabel(false); }}
                                autoFocus
                                sx={{ minWidth: 200, '& .MuiInputBase-root': { height: 32 } }}
                            />
                            <IconButton size="small" color="success" onClick={handleLabelSave}>
                                <CheckIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    ) : (
                        <>
                            <Typography variant="subtitle1" fontWeight="bold">
                                {section.label}
                            </Typography>
                            {!disabled && (
                                <IconButton size="small" onClick={handleLabelEdit} sx={{ opacity: 0.5, '&:hover': { opacity: 1 } }}>
                                    <EditIcon fontSize="small" />
                                </IconButton>
                            )}
                        </>
                    )}

                    <Typography variant="caption" color="text.secondary">
                        ({sectionFields.length} fields)
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }} onClick={(e) => e.stopPropagation()}>
                    {/* Add Field Button */}
                    {!disabled && onAddField && (
                        <Tooltip title="Add Field">
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAddFieldDialog(true);
                                }}
                            >
                                <AddIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Typography variant="caption" color={!section.is_present ? 'error.main' : 'text.disabled'}>
                        Hidden
                    </Typography>
                    <Switch
                        size="small"
                        checked={section.is_present ?? true}
                        onChange={(e) => onSectionChange(section.key, 'is_present', e.target.checked)}
                        color="success"
                        disabled={disabled}
                    />
                    <Typography variant="caption" color={section.is_present ? 'success.main' : 'text.disabled'}>
                        Visible
                    </Typography>
                </Box>
            </Box>

            {/* Section Body — Field Table */}
            <Collapse in={expanded}>
                <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                    {sectionFields.length === 0 ? (
                        <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
                            No fields configured for this section.
                        </Typography>
                    ) : (
                        // Horizontal scroll on small screens — the fixed column
                        // widths sum well past a phone viewport, so keep the
                        // header + rows on one min-width track and let it scroll
                        // rather than overflow the page.
                        <Box sx={{ overflowX: 'auto' }}>
                          <Box sx={{ minWidth: 1000 }}>
                            {/* Table Header */}
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: '50px 140px 1fr 120px 120px 120px 150px 50px',
                                    gap: 1,
                                    alignItems: 'center',
                                    bgcolor: 'primary.main',
                                    color: 'white',
                                    p: 1,
                                }}
                            >
                                <Typography fontWeight="bold" textAlign="center" fontSize="0.75rem">S.No</Typography>
                                <Typography fontWeight="bold" fontSize="0.75rem">Field Key</Typography>
                                <Typography fontWeight="bold" fontSize="0.75rem">Label / Placeholder</Typography>
                                <Typography fontWeight="bold" textAlign="center" fontSize="0.75rem">Type</Typography>
                                <Typography fontWeight="bold" textAlign="center" fontSize="0.75rem">Display</Typography>
                                <Typography fontWeight="bold" textAlign="center" fontSize="0.75rem">Mandatory</Typography>
                                <Typography fontWeight="bold" textAlign="center" fontSize="0.75rem">Data Source</Typography>
                                <Typography fontWeight="bold" textAlign="center" fontSize="0.75rem">Del</Typography>
                            </Box>

                            {/* Field Rows */}
                            {sectionFields.map((field, index) => (
                                <FieldEditor
                                    key={field.id}
                                    field={field}
                                    index={index}
                                    onFieldChange={onFieldChange}
                                    onRemoveField={onRemoveField}
                                    dataSources={dataSources}
                                    disabled={disabled}
                                />
                            ))}
                          </Box>
                        </Box>
                    )}
                </CardContent>
            </Collapse>

            {/* Add Field Dialog */}
            <Dialog open={showAddFieldDialog} onClose={() => setShowAddFieldDialog(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Add New Field to &quot;{section.label}&quot;</DialogTitle>
                <DialogContent>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                        <TextField
                            size="small"
                            fullWidth
                            label="Field Key (unique identifier)"
                            placeholder="e.g. marital_status, father_name"
                            value={newField.field_key}
                            onChange={(e) => setNewField((prev) => ({ ...prev, field_key: e.target.value }))}
                            helperText="Lowercase with underscores, must be unique within this section"
                        />
                        <TextField
                            size="small"
                            fullWidth
                            label="Display Label"
                            placeholder="e.g. Marital Status, Father's Name"
                            value={newField.label}
                            onChange={(e) => setNewField((prev) => ({ ...prev, label: e.target.value }))}
                        />
                        <TextField
                            size="small"
                            fullWidth
                            label="Placeholder Text"
                            placeholder="e.g. Enter your marital status"
                            value={newField.placeholder}
                            onChange={(e) => setNewField((prev) => ({ ...prev, placeholder: e.target.value }))}
                        />
                        <FormControl size="small" fullWidth>
                            <InputLabel>Field Type</InputLabel>
                            <Select
                                value={newField.field_type}
                                label="Field Type"
                                onChange={(e) => setNewField((prev) => ({ ...prev, field_type: e.target.value }))}
                            >
                                {NEW_FIELD_TYPES.map((ft) => (
                                    <MenuItem key={ft} value={ft}>{ft}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        {['select', 'radio', 'checkbox', 'multi_select'].includes(newField.field_type) && (
                            <TextField
                                size="small"
                                fullWidth
                                label="Options (comma separated)"
                                placeholder="e.g. Single, Married, Divorced, Widowed"
                                value={newField.options}
                                onChange={(e) => setNewField((prev) => ({ ...prev, options: e.target.value }))}
                                helperText="Comma-separated list of options for dropdown/radio/checkbox"
                            />
                        )}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowAddFieldDialog(false)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleAddNewField}
                        disabled={!newField.field_key.trim() || !newField.label.trim()}
                    >
                        Add Field
                    </Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
};

export default SectionEditor;
