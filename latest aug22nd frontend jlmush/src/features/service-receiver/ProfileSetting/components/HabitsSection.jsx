import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Grid, Select, MenuItem, FormControl, InputLabel,
    Button,
} from '@mui/material';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import {
    useGetHabitsQuery,
    useUpdateHabitsMutation,
} from '../api/scopedPatientApi';

const HABIT_FIELDS = [
    { key: 'smoking', label: 'Smoking', defaultOptions: ['Never', 'Occasionally', 'Regularly', 'Former'] },
    { key: 'alcohol', label: 'Alcohol', defaultOptions: ['Never', 'Occasionally', 'Regularly', 'Former'] },
    { key: 'tobacco', label: 'Tobacco', defaultOptions: ['Never', 'Occasionally', 'Regularly', 'Former'] },
    { key: 'drugs', label: 'Drugs', defaultOptions: ['Never', 'Occasionally', 'Regularly', 'Former'] },
    { key: 'exercise', label: 'Exercise', defaultOptions: ['None', 'Light', 'Moderate', 'Intense', 'Daily'] },
    { key: 'diet', label: 'Diet', defaultOptions: ['Vegetarian', 'Non-Vegetarian', 'Vegan', 'Eggetarian', 'Mixed'] },
    { key: 'sleep_pattern', label: 'Sleep Pattern', defaultOptions: ['Less than 5 hrs', '5-6 hrs', '6-8 hrs', '8+ hrs', 'Irregular'] },
    { key: 'caffeine', label: 'Caffeine', defaultOptions: ['None', '1-2 cups/day', '3-4 cups/day', '5+ cups/day'] },
];

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const HabitsSection = ({ configOverride }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: habitsData, isLoading } = useGetHabitsQuery();
    const [updateHabits, { isLoading: isSaving }] = useUpdateHabitsMutation();

    const [formData, setFormData] = useState(() => {
        const initial = {};
        HABIT_FIELDS.forEach((f) => { initial[f.key] = ''; });
        return initial;
    });

    useEffect(() => {
        if (habitsData) {
            // transformResponse gives { habits: {...} } or the raw details object
            const habits = habitsData?.habits || habitsData?.data?.habits || habitsData?.data || habitsData;
            if (habits && typeof habits === 'object') {
                setFormData((prev) => {
                    const updated = { ...prev };
                    HABIT_FIELDS.forEach((f) => {
                        updated[f.key] = habits[f.key] ?? '';
                    });
                    return updated;
                });
            }
        }
    }, [habitsData]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleSaveHabits = useCallback(async () => {
        try {
            await updateHabits(formData).unwrap();
        } catch (err) {
            console.error('Failed to save habits:', err);
        }
    }, [formData, updateHabits]);

    if (!cfg.isSectionVisible('habits')) return null;

    return (
        <Box>
            <Grid container spacing={2}>
                {HABIT_FIELDS.map((field) => {
                    if (!cfg.isFieldVisible(field.key)) return null;

                    // Try to get options from field config, then fall back to defaults
                    const fieldOptions = cfg.getFieldOptions?.(field.key);
                    const options =
                        fieldOptions && fieldOptions.length > 0
                            ? fieldOptions
                            : field.defaultOptions;

                    return (
                        <Grid item xs={12} sm={6} md={3} key={field.key}>
                            <FormControl fullWidth size="small" required={cfg.isFieldRequired(field.key)}>
                                <InputLabel>
                                    {cfg.getFieldLabel(field.key, field.label)}
                                </InputLabel>
                                <Select
                                    name={field.key}
                                    value={formData[field.key]}
                                    label={cfg.getFieldLabel(field.key, field.label)}
                                    onChange={handleChange}
                                >
                                    {options.map((opt) => {
                                        const n = norm(opt);
                                        return (
                                            <MenuItem key={n.value} value={n.value}>
                                                {n.label}
                                            </MenuItem>
                                        );
                                    })}
                                </Select>
                            </FormControl>
                        </Grid>
                    );
                })}
            </Grid>

            <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                    variant="contained"
                    onClick={handleSaveHabits}
                    disabled={isSaving}
                >
                    {isSaving ? 'Saving...' : 'Save Habits'}
                </Button>
            </Box>
        </Box>
    );
};

export default React.memo(HabitsSection);
