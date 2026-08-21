import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Grid, TextField, Select, MenuItem,
    FormControl, InputLabel, Alert,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import {
    useGetFemaleHealthQuery,
    useUpdateFemaleHealthMutation,
} from '../api/scopedPatientApi';
import { toLocalDateString } from '../../../../common/utils/date';

const DEFAULT_PREGNANCY_STATUS = [
    { value: 'pregnant', label: 'Pregnant' },
    { value: 'not_pregnant', label: 'Not Pregnant' },
    { value: 'planning', label: 'Planning' },
    { value: 'postpartum', label: 'Postpartum' },
];

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const FemaleHealthSection = ({ configOverride, registerSave }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: profileData } = useGetFemaleHealthQuery();
    const [updateProfile, { isLoading: isSaving }] = useUpdateFemaleHealthMutation();

    const dataSources = cfg.dataSources || {};
    const pregnancyStatusOptions = dataSources?.pregnancy_status || DEFAULT_PREGNANCY_STATUS;

    const [formData, setFormData] = useState({
        lmp_date: null,
        lmp_remarks: '',
        pregnancy_status: '',
        pregnancy_remarks: '',
    });

    useEffect(() => {
        if (profileData) {
            // GET endpoint returns flat: { gender, lmp_date, lmp_remarks, ... }
            setFormData((prev) => ({
                ...prev,
                lmp_date: profileData.lmp_date ? new Date(profileData.lmp_date) : null,
                lmp_remarks: profileData.lmp_remarks || '',
                pregnancy_status: profileData.pregnancy_status || '',
                pregnancy_remarks: profileData.pregnancy_remarks || '',
            }));
        }
    }, [profileData]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDateChange = useCallback((date) => {
        setFormData((prev) => ({ ...prev, lmp_date: date }));
    }, []);

    const handleSave = useCallback(async () => {
        // Backend PUT /profile/female-health wraps req_data in female_health_details
        // So we send flat data, not nested
        const payload = {
            ...formData,
            lmp_date: toLocalDateString(formData.lmp_date),
        };
        await updateProfile(payload).unwrap();
    }, [formData, updateProfile]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save', isSaving);
        }
    }, [registerSave, handleSave, isSaving]);

    // Gender-based visibility is handled by the parent ProfileSetting page.
    // This component only checks admin config visibility.
    if (!cfg.isSectionVisible('female_health')) return null;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box>
                <Alert severity="info" sx={{ mb: 2 }}>
                    This section is only visible for female patients.
                </Alert>

                <Grid container spacing={2}>
                    {/* LMP Date */}
                    {cfg.isFieldVisible('lmp_date') && (
                        <Grid item xs={12} sm={6}>
                            <DatePicker
                                label={cfg.getFieldLabel('lmp_date', 'LMP Date')}
                                value={formData.lmp_date}
                                onChange={handleDateChange}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                        required: cfg.isFieldRequired('lmp_date'),
                                    },
                                }}
                            />
                        </Grid>
                    )}

                    {/* LMP Remarks */}
                    {cfg.isFieldVisible('lmp_remarks') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('lmp_remarks', 'LMP Remarks')}
                                name="lmp_remarks"
                                value={formData.lmp_remarks}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('lmp_remarks')}
                            />
                        </Grid>
                    )}

                    {/* Pregnancy Status */}
                    {cfg.isFieldVisible('pregnancy_status') && (
                        <Grid item xs={12} sm={6}>
                            <FormControl fullWidth required={cfg.isFieldRequired('pregnancy_status')}>
                                <InputLabel>
                                    {cfg.getFieldLabel('pregnancy_status', 'Pregnancy Status')}
                                </InputLabel>
                                <Select
                                    name="pregnancy_status"
                                    value={formData.pregnancy_status}
                                    label={cfg.getFieldLabel('pregnancy_status', 'Pregnancy Status')}
                                    onChange={handleChange}
                                >
                                    {pregnancyStatusOptions.map((opt) => {
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
                    )}

                    {/* Pregnancy Remarks */}
                    {cfg.isFieldVisible('pregnancy_remarks') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('pregnancy_remarks', 'Pregnancy Remarks')}
                                name="pregnancy_remarks"
                                value={formData.pregnancy_remarks}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('pregnancy_remarks')}
                            />
                        </Grid>
                    )}
                    {/* Dynamic custom fields added by admin */}
                    <DynamicFieldRenderer
                        sectionKey="female_health"
                        cfg={cfg}
                        excludeKeys={['lmp_date', 'lmp_remarks', 'pregnancy_status', 'pregnancy_remarks']}
                        formData={formData}
                        onFieldChange={(fieldKey, value) => setFormData((prev) => ({ ...prev, [fieldKey]: value }))}
                    />
                </Grid>
            </Box>
        </LocalizationProvider>
    );
};

export default React.memo(FemaleHealthSection);
