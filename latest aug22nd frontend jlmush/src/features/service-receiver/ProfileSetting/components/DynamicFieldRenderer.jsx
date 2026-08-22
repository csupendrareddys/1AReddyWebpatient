import React from 'react';
import {
    Grid, TextField, Select, MenuItem, FormControl, InputLabel,
    Autocomplete, Chip, Radio, RadioGroup, FormControlLabel,
    Checkbox, FormGroup, Button, Typography,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

/**
 * Normalise an option entry into { value, label }.
 * Accepts plain strings ("signal") or objects ({ value, label }).
 */
/**
 * Normalise an option entry into { value, label }.
 * Accepts plain strings, { value, label }, or { id, name } objects.
 */
const normalizeOption = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    if (opt && typeof opt === 'object') {
        return {
            value: opt.value ?? opt.id ?? '',
            label: opt.label ?? opt.name ?? opt.value ?? opt.id ?? '',
        };
    }
    return { value: String(opt ?? ''), label: String(opt ?? '') };
};

/**
 * Safely coerce field.options into an array.
 * Handles: array, comma-string, null/undefined, object.
 */
const toOptionsArray = (raw) => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string' && raw.trim()) return raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (raw && typeof raw === 'object') return Object.entries(raw).map(([k, v]) => ({ value: k, label: v }));
    return [];
};

/**
 * DynamicFieldRenderer
 *
 * Renders admin-configured fields for a given section that are NOT already
 * hardcoded in the parent section component.
 *
 * Props:
 *   sectionKey   – e.g. "personal_details"
 *   cfg          – return value of usePatientProfilePageConfig()
 *   excludeKeys  – field keys already rendered by the parent (hardcoded)
 *   formData     – current form state object
 *   onFieldChange – (fieldKey, value) => void
 */
const DynamicFieldRenderer = ({ sectionKey, cfg, excludeKeys = [], formData = {}, onFieldChange }) => {
    if (!cfg || !cfg.fieldConfigs) return null;

    const excludeSet = new Set(excludeKeys);

    // Collect fields belonging to this section that are not hardcoded
    const dynamicFields = cfg.fieldConfigs.filter((field) => {
        if (field.section !== sectionKey) return false;
        if (excludeSet.has(field.field_key)) return false;
        if (!cfg.isFieldVisible(field.field_key)) return false;
        return true;
    });

    if (dynamicFields.length === 0) return null;

    const handleChange = (fieldKey) => (e) => {
        onFieldChange(fieldKey, e.target.value);
    };

    const renderField = (field) => {
        const fieldKey = field.field_key;
        const label = cfg.getFieldLabel(fieldKey, field.label);
        const required = cfg.isFieldRequired(fieldKey);
        const placeholder = cfg.getFieldPlaceholder(fieldKey, field.placeholder);
        const value = formData[fieldKey] ?? '';
        const options = toOptionsArray(field.options).map(normalizeOption);
        const fieldType = field.field_type || 'text';

        switch (fieldType) {
            case 'text':
                return (
                    <TextField
                        fullWidth
                        size="small"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                    />
                );

            case 'textarea':
                return (
                    <TextField
                        fullWidth
                        size="small"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                        multiline
                        rows={3}
                    />
                );

            case 'number':
                return (
                    <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                    />
                );

            case 'tel':
                return (
                    <TextField
                        fullWidth
                        size="small"
                        type="tel"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                    />
                );

            case 'email':
                return (
                    <TextField
                        fullWidth
                        size="small"
                        type="email"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                    />
                );

            case 'date':
                return (
                    <TextField
                        fullWidth
                        size="small"
                        type="date"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                        InputLabelProps={{ shrink: true }}
                    />
                );

            case 'select':
                return (
                    <FormControl fullWidth size="small" required={required}>
                        <InputLabel>{label}</InputLabel>
                        <Select
                            value={value}
                            label={label}
                            onChange={handleChange(fieldKey)}
                        >
                            {options.map((opt) => (
                                <MenuItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                );

            case 'multi_select': {
                const selectedValues = Array.isArray(value) ? value : [];
                return (
                    <Autocomplete
                        multiple
                        size="small"
                        options={options.map((o) => o.value)}
                        getOptionLabel={(optVal) => {
                            const found = options.find((o) => o.value === optVal);
                            return found ? found.label : optVal;
                        }}
                        value={selectedValues}
                        onChange={(_e, newVal) => onFieldChange(fieldKey, newVal)}
                        renderTags={(tagValues, getTagProps) =>
                            tagValues.map((optVal, idx) => {
                                const found = options.find((o) => o.value === optVal);
                                return (
                                    <Chip
                                        size="small"
                                        label={found ? found.label : optVal}
                                        {...getTagProps({ index: idx })}
                                        key={optVal}
                                    />
                                );
                            })
                        }
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                label={label}
                                required={required && selectedValues.length === 0}
                                placeholder={placeholder}
                            />
                        )}
                    />
                );
            }

            case 'radio':
                return (
                    <FormControl component="fieldset" required={required}>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                            {label}{required ? ' *' : ''}
                        </Typography>
                        <RadioGroup
                            value={value}
                            onChange={handleChange(fieldKey)}
                            row
                        >
                            {options.map((opt) => (
                                <FormControlLabel
                                    key={opt.value}
                                    value={opt.value}
                                    control={<Radio size="small" />}
                                    label={opt.label}
                                />
                            ))}
                        </RadioGroup>
                    </FormControl>
                );

            case 'checkbox': {
                const checkedValues = Array.isArray(value) ? value : [];
                return (
                    <FormControl component="fieldset" required={required}>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                            {label}{required ? ' *' : ''}
                        </Typography>
                        <FormGroup row>
                            {options.map((opt) => (
                                <FormControlLabel
                                    key={opt.value}
                                    control={
                                        <Checkbox
                                            size="small"
                                            checked={checkedValues.includes(opt.value)}
                                            onChange={(e) => {
                                                const next = e.target.checked
                                                    ? [...checkedValues, opt.value]
                                                    : checkedValues.filter((v) => v !== opt.value);
                                                onFieldChange(fieldKey, next);
                                            }}
                                        />
                                    }
                                    label={opt.label}
                                />
                            ))}
                        </FormGroup>
                    </FormControl>
                );
            }

            case 'file':
                return (
                    <div>
                        <Typography variant="body2" sx={{ mb: 0.5 }}>
                            {label}{required ? ' *' : ''}
                        </Typography>
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<CloudUploadIcon />}
                            component="label"
                        >
                            Upload {label}
                            <input type="file" hidden onChange={(e) => onFieldChange(fieldKey, e.target.files?.[0] || null)} />
                        </Button>
                    </div>
                );

            default:
                return (
                    <TextField
                        fullWidth
                        size="small"
                        label={label}
                        required={required}
                        placeholder={placeholder}
                        value={value}
                        onChange={handleChange(fieldKey)}
                    />
                );
        }
    };

    // textarea and multi_select get full width; everything else gets sm=4
    const isWideField = (fieldType) => fieldType === 'textarea' || fieldType === 'multi_select';

    // Return Grid items only (no wrapper) so they integrate seamlessly into the parent Grid container
    return (
        <>
            {dynamicFields.map((field) => (
                <Grid
                    item
                    xs={12}
                    sm={isWideField(field.field_type) ? 12 : 4}
                    key={field.field_key}
                >
                    {renderField(field)}
                </Grid>
            ))}
        </>
    );
};

export default DynamicFieldRenderer;
