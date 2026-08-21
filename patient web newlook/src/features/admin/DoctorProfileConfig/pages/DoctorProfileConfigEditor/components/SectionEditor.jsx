/**
 * SectionEditor — Renders a collapsible section with its field configs in a table.
 * Section label is editable inline by admin.
 */
import { useState } from 'react';
import {
    Box, Typography, Switch, Collapse, IconButton, Card, CardContent, TextField
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import FieldEditor from './FieldEditor';

const SectionEditor = ({
    section,
    fieldConfigs,
    onSectionChange,
    onFieldChange,
    onRemoveField,
    dataSources,
    disabled,
    /** Optional master_data flusher registry — passed through to
     *  child FieldEditors so master-backed option edits can be
     *  batched until Save Draft. See useDoctorProfileConfigEditor. */
    registerOptionsFlusher,
}) => {
    const [expanded, setExpanded] = useState(true);
    const [editingLabel, setEditingLabel] = useState(false);
    const [labelValue, setLabelValue] = useState(section.label || '');

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
                                    registerOptionsFlusher={registerOptionsFlusher}
                                />
                            ))}
                          </Box>
                        </Box>
                    )}
                </CardContent>
            </Collapse>
        </Card>
    );
};

export default SectionEditor;
