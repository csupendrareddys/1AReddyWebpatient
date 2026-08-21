import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Grid, TextField, Select, MenuItem,
    FormControl, InputLabel,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import {
    useGetInsuranceQuery,
    useUpdateInsuranceMutation,
} from '../api/scopedPatientApi';
import { toLocalDateString } from '../../../../common/utils/date';

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const InsuranceSection = ({ configOverride, registerSave }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: profileData } = useGetInsuranceQuery();
    const [updateProfile, { isLoading: isSaving }] = useUpdateInsuranceMutation();

    const dataSources = cfg.dataSources || {};
    const insuranceProviders = dataSources?.insurance_providers || [];

    const [formData, setFormData] = useState({
        insurance_provider: '',
        insurance_policy_number: '',
        insurance_valid_till: null,
        insurance_coverage_amount: '',
    });

    useEffect(() => {
        if (profileData) {
            const profile = profileData;
            setFormData((prev) => ({
                ...prev,
                insurance_provider: profile.insurance_provider || '',
                insurance_policy_number: profile.insurance_policy_number || '',
                insurance_valid_till: profile.insurance_valid_till
                    ? new Date(profile.insurance_valid_till)
                    : null,
                insurance_coverage_amount: profile.insurance_coverage_amount || '',
            }));
        }
    }, [profileData]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDateChange = useCallback((date) => {
        setFormData((prev) => ({ ...prev, insurance_valid_till: date }));
    }, []);

    const handleSave = useCallback(async () => {
        const payload = { ...formData };
        if (payload.insurance_valid_till) {
            payload.insurance_valid_till = toLocalDateString(payload.insurance_valid_till);
        }
        await updateProfile(payload).unwrap();
    }, [formData, updateProfile]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save', isSaving);
        }
    }, [registerSave, handleSave, isSaving]);

    if (!cfg.isSectionVisible('insurance')) return null;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box>
                <Grid container spacing={2}>
                    {/* Insurance Provider */}
                    {cfg.isFieldVisible('insurance_provider') && (
                        <Grid item xs={12} sm={6}>
                            {insuranceProviders.length > 0 ? (
                                <FormControl fullWidth required={cfg.isFieldRequired('insurance_provider')}>
                                    <InputLabel>
                                        {cfg.getFieldLabel('insurance_provider', 'Insurance Provider')}
                                    </InputLabel>
                                    <Select
                                        name="insurance_provider"
                                        value={formData.insurance_provider}
                                        label={cfg.getFieldLabel('insurance_provider', 'Insurance Provider')}
                                        onChange={handleChange}
                                    >
                                        {insuranceProviders.map((prov) => {
                                            const n = norm(prov);
                                            return (
                                                <MenuItem key={n.value} value={n.value}>
                                                    {n.label}
                                                </MenuItem>
                                            );
                                        })}
                                    </Select>
                                </FormControl>
                            ) : (
                                <TextField
                                    fullWidth
                                    label={cfg.getFieldLabel('insurance_provider', 'Insurance Provider')}
                                    name="insurance_provider"
                                    value={formData.insurance_provider}
                                    onChange={handleChange}
                                    required={cfg.isFieldRequired('insurance_provider')}
                                />
                            )}
                        </Grid>
                    )}

                    {/* Policy Number */}
                    {cfg.isFieldVisible('insurance_policy_number') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('insurance_policy_number', 'Policy Number')}
                                name="insurance_policy_number"
                                value={formData.insurance_policy_number}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('insurance_policy_number')}
                            />
                        </Grid>
                    )}

                    {/* Valid Till */}
                    {cfg.isFieldVisible('insurance_valid_till') && (
                        <Grid item xs={12} sm={6}>
                            <DatePicker
                                label={cfg.getFieldLabel('insurance_valid_till', 'Valid Till')}
                                value={formData.insurance_valid_till}
                                onChange={handleDateChange}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                        required: cfg.isFieldRequired('insurance_valid_till'),
                                    },
                                }}
                            />
                        </Grid>
                    )}

                    {/* Coverage Amount */}
                    {cfg.isFieldVisible('insurance_coverage_amount') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('insurance_coverage_amount', 'Coverage Amount')}
                                name="insurance_coverage_amount"
                                value={formData.insurance_coverage_amount}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('insurance_coverage_amount')}
                                type="number"
                                InputProps={{ startAdornment: <span style={{ marginRight: 4 }}>INR</span> }}
                            />
                        </Grid>
                    )}
                    {/* Dynamic custom fields added by admin */}
                    <DynamicFieldRenderer
                        sectionKey="insurance"
                        cfg={cfg}
                        excludeKeys={['insurance_provider', 'insurance_policy_number', 'insurance_valid_till', 'insurance_coverage_amount']}
                        formData={formData}
                        onFieldChange={(fieldKey, value) => setFormData((prev) => ({ ...prev, [fieldKey]: value }))}
                    />
                </Grid>
            </Box>
        </LocalizationProvider>
    );
};

export default React.memo(InsuranceSection);
