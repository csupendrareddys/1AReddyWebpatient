import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Paper, Grid, Slider, FormGroup, FormControlLabel,
    Checkbox, Button, Chip, Dialog, DialogTitle, DialogContent,
    DialogActions, IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';

import usePageConfig from '../../../../auth/hooks/usePageConfig';

// Default filter fields when no admin config exists (mirrors the old
// DoctorFilterPage so admin `patient_appointment_filter` config still drives it).
const DEFAULT_FIELDS = [
    { key: 'gender', label: 'Gender', visible: true, type: 'checkbox_group', options: ['Male', 'Female', 'Others'] },
    { key: 'language', label: 'Languages', visible: true, type: 'checkbox_group', options: ['English', 'Hindi', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi'] },
    { key: 'experience', label: 'Experience (Years)', visible: true, type: 'range', min: 0, max: 50, unit: 'yrs' },
    { key: 'price', label: 'Price Range', visible: true, type: 'range', min: 200, max: 2500, unit: 'INR' },
];

const emptyFilters = () => ({
    language: [], specialization: [], gender: [], category: [],
    experience_min: 0, experience_max: 50,
    price_min: 200, price_max: 2500, rating_min: 0,
});

// Count how many filters are meaningfully active (shared with the toolbar badge).
export const countActiveFilters = (filters = {}) =>
    Object.entries(filters).reduce((count, [key, val]) => {
        if (Array.isArray(val) && val.length > 0) return count + 1;
        if (key === 'experience_min' && val > 0) return count + 1;
        if (key === 'experience_max' && val < 50) return count + 1;
        if (key === 'price_min' && val > 200) return count + 1;
        if (key === 'price_max' && val < 2500) return count + 1;
        if (key === 'rating_min' && val > 0) return count + 1;
        return count;
    }, 0);

// Translate the dialog's filter state into query params for GET
// /api/doctor/list (the Find-a-Doctor browse). Values still sitting at their
// slider default are dropped rather than sent: `experience_min=0` looks
// harmless but excludes every doctor who hasn't filled in their experience
// years, which silently empties the list. Same defaults `countActiveFilters`
// treats as "not active", so the badge and the request always agree.
export const filtersToQueryParams = (filters = {}) => {
    const params = {};
    if (filters.language?.length) params.language = filters.language.join(',');
    if (filters.gender?.length) params.gender = filters.gender.join(',');
    if (filters.specialization?.length) params.specialization = filters.specialization.join(',');
    if (filters.experience_min > 0) params.experience_min = filters.experience_min;
    if (filters.experience_max != null && filters.experience_max < 50) params.experience_max = filters.experience_max;
    if (filters.price_min > 200) params.price_min = filters.price_min;
    if (filters.price_max != null && filters.price_max < 2500) params.price_max = filters.price_max;
    return params;
};

const FiltersDialog = ({ open, onClose, initialFilters, onApply }) => {
    const { config: filterConfig } = usePageConfig('patient_appointment_filter');
    const filterFields = filterConfig?.fields || [];
    const fieldsToRender = filterFields.length > 0 ? filterFields : DEFAULT_FIELDS;

    const [filters, setFilters] = useState({ ...emptyFilters(), ...(initialFilters || {}) });

    // Re-sync local state whenever the dialog is (re)opened.
    useEffect(() => {
        if (open) setFilters({ ...emptyFilters(), ...(initialFilters || {}) });
    }, [open, initialFilters]);

    const handleCheckboxFilter = (key, option) => {
        setFilters((prev) => {
            const current = prev[key] || [];
            const updated = current.includes(option)
                ? current.filter((v) => v !== option)
                : [...current, option];
            return { ...prev, [key]: updated };
        });
    };

    const clearFilters = () => setFilters(emptyFilters());

    const activeFilterCount = countActiveFilters(filters);

    const renderFilterField = (field) => {
        if (!field.visible) return null;
        const key = field.key;

        switch (field.type) {
            case 'multi_select':
            case 'checkbox_group': {
                const options = field.options || [];
                return (
                    <Grid item xs={12} sm={6} key={key}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                            <Typography variant="subtitle1" fontWeight="bold" mb={1}>
                                {field.label}
                            </Typography>
                            {field.helper_text && (
                                <Typography variant="caption" color="text.secondary" display="block" mb={1}>
                                    {field.helper_text}
                                </Typography>
                            )}
                            <FormGroup>
                                {options.map((opt) => (
                                    <FormControlLabel
                                        key={opt}
                                        control={
                                            <Checkbox
                                                size="small"
                                                checked={(filters[key] || []).includes(opt)}
                                                onChange={() => handleCheckboxFilter(key, opt)}
                                            />
                                        }
                                        label={<Typography variant="body2">{opt}</Typography>}
                                    />
                                ))}
                            </FormGroup>
                        </Paper>
                    </Grid>
                );
            }
            case 'range': {
                const min = field.min || 0;
                const max = field.max || 100;
                const minKey = `${key}_min`;
                const maxKey = `${key}_max`;
                return (
                    <Grid item xs={12} sm={6} key={key}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                            <Typography variant="subtitle1" fontWeight="bold" mb={1}>
                                {field.label}
                            </Typography>
                            <Slider
                                value={[filters[minKey] ?? min, filters[maxKey] ?? max]}
                                onChange={(_, val) => {
                                    setFilters((prev) => ({ ...prev, [minKey]: val[0], [maxKey]: val[1] }));
                                }}
                                valueLabelDisplay="auto"
                                min={min}
                                max={max}
                                step={field.step || 1}
                            />
                            <Box display="flex" justifyContent="space-between">
                                <Typography variant="caption">
                                    {field.unit ? `${field.unit} ` : ''}{filters[minKey] ?? min}
                                </Typography>
                                <Typography variant="caption">
                                    {field.unit ? `${field.unit} ` : ''}{filters[maxKey] ?? max}
                                </Typography>
                            </Box>
                        </Paper>
                    </Grid>
                );
            }
            default:
                return null;
        }
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
            <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FilterListIcon color="primary" />
                <Box flex={1}>
                    <Typography variant="h6" fontWeight="bold">Set Your Preferences</Typography>
                    <Typography variant="body2" color="text.secondary">
                        Filter doctors based on your preferences.
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {activeFilterCount > 0 && (
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Chip
                            icon={<FilterListIcon />}
                            label={`${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active`}
                            color="primary"
                            variant="outlined"
                            size="small"
                        />
                        <Button size="small" onClick={clearFilters}>Clear All</Button>
                    </Box>
                )}
                <Grid container spacing={2}>
                    {fieldsToRender.map(renderFilterField)}
                </Grid>
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
                <Button variant="text" onClick={() => onApply(emptyFilters())}>
                    Clear &amp; Apply
                </Button>
                <Button variant="contained" onClick={() => onApply(filters)}>
                    Apply Filters
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default FiltersDialog;
