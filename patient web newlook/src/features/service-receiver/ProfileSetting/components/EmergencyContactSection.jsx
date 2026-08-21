import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Grid, TextField, Select, MenuItem,
    FormControl, InputLabel,
} from '@mui/material';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import {
    useGetEmergencyContactQuery,
    useUpdateEmergencyContactMutation,
} from '../api/scopedPatientApi';

const DEFAULT_RELATION_TYPES = [
    'Spouse', 'Parent', 'Child', 'Sibling', 'Friend', 'Other',
];

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const EmergencyContactSection = ({ configOverride, registerSave }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: profileData } = useGetEmergencyContactQuery();
    const [updateProfile, { isLoading: isSaving }] = useUpdateEmergencyContactMutation();

    const dataSources = cfg.dataSources || {};
    const relationTypes = dataSources?.relation_types || DEFAULT_RELATION_TYPES;

    const [formData, setFormData] = useState({
        emergency_contact_name: '',
        emergency_contact_phone: '',
        emergency_contact_relation: '',
        emergency_contact_email: '',
    });

    useEffect(() => {
        if (profileData) {
            const profile = profileData;
            setFormData((prev) => ({
                ...prev,
                emergency_contact_name: profile.emergency_contact_name || '',
                emergency_contact_phone: profile.emergency_contact_phone || '',
                emergency_contact_relation: profile.emergency_contact_relation || '',
                emergency_contact_email: profile.emergency_contact_email || '',
            }));
        }
    }, [profileData]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleSave = useCallback(async () => {
        await updateProfile(formData).unwrap();
    }, [formData, updateProfile]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save', isSaving);
        }
    }, [registerSave, handleSave, isSaving]);

    if (!cfg.isSectionVisible('emergency_contact')) return null;

    return (
        <Box>
            <Grid container spacing={2}>
                {/* Emergency Contact Name */}
                {cfg.isFieldVisible('emergency_contact_name') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('emergency_contact_name', 'Contact Name')}
                            name="emergency_contact_name"
                            value={formData.emergency_contact_name}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('emergency_contact_name')}
                        />
                    </Grid>
                )}

                {/* Emergency Contact Phone */}
                {cfg.isFieldVisible('emergency_contact_phone') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('emergency_contact_phone', 'Contact Phone')}
                            name="emergency_contact_phone"
                            value={formData.emergency_contact_phone}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('emergency_contact_phone')}
                        />
                    </Grid>
                )}

                {/* Emergency Contact Relation */}
                {cfg.isFieldVisible('emergency_contact_relation') && (
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth required={cfg.isFieldRequired('emergency_contact_relation')}>
                            <InputLabel>{cfg.getFieldLabel('emergency_contact_relation', 'Relation')}</InputLabel>
                            <Select
                                name="emergency_contact_relation"
                                value={formData.emergency_contact_relation}
                                label={cfg.getFieldLabel('emergency_contact_relation', 'Relation')}
                                onChange={handleChange}
                            >
                                {relationTypes.map((rel) => {
                                    const n = norm(rel);
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

                {/* Emergency Contact Email */}
                {cfg.isFieldVisible('emergency_contact_email') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('emergency_contact_email', 'Contact Email')}
                            name="emergency_contact_email"
                            value={formData.emergency_contact_email}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('emergency_contact_email')}
                            type="email"
                        />
                    </Grid>
                )}
                {/* Dynamic custom fields added by admin */}
                <DynamicFieldRenderer
                    sectionKey="emergency_contact"
                    cfg={cfg}
                    excludeKeys={['emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'emergency_contact_email']}
                    formData={formData}
                    onFieldChange={(fieldKey, value) => setFormData((prev) => ({ ...prev, [fieldKey]: value }))}
                />
            </Grid>
        </Box>
    );
};

export default React.memo(EmergencyContactSection);
