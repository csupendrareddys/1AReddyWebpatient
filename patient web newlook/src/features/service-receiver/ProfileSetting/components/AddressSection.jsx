import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Grid, TextField, Select, MenuItem,
    FormControl, InputLabel,
} from '@mui/material';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import {
    useGetAddressQuery,
    useUpdateAddressMutation,
} from '../api/scopedPatientApi';

const AddressSection = ({ configOverride, registerSave }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: profileData } = useGetAddressQuery();
    const [updateProfile, { isLoading: isSaving }] = useUpdateAddressMutation();

    const dataSources = cfg.dataSources || {};
    const stateOptions = dataSources?.master_states || [];

    const [formData, setFormData] = useState({
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        pincode: '',
        country: 'India',
    });

    useEffect(() => {
        if (profileData) {
            const profile = profileData;
            setFormData((prev) => ({
                ...prev,
                address_line1: profile.address_line1 || '',
                address_line2: profile.address_line2 || '',
                city: profile.city || '',
                state: profile.state || '',
                pincode: profile.pincode || '',
                country: profile.country || 'India',
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

    if (!cfg.isSectionVisible('address')) return null;

    return (
        <Box>
            <Grid container spacing={2}>
                {/* Address Line 1 */}
                {cfg.isFieldVisible('address_line1') && (
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('address_line1', 'Address Line 1')}
                            name="address_line1"
                            value={formData.address_line1}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('address_line1')}
                            placeholder="H.No, Street"
                        />
                    </Grid>
                )}

                {/* Address Line 2 */}
                {cfg.isFieldVisible('address_line2') && (
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('address_line2', 'Address Line 2')}
                            name="address_line2"
                            value={formData.address_line2}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('address_line2')}
                            placeholder="Landmark etc."
                        />
                    </Grid>
                )}

                {/* City */}
                {cfg.isFieldVisible('city') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('city', 'City')}
                            name="city"
                            value={formData.city}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('city')}
                        />
                    </Grid>
                )}

                {/* State */}
                {cfg.isFieldVisible('state') && (
                    <Grid item xs={12} sm={6}>
                        {stateOptions.length > 0 ? (
                            <FormControl fullWidth required={cfg.isFieldRequired('state')}>
                                <InputLabel>{cfg.getFieldLabel('state', 'State')}</InputLabel>
                                <Select
                                    name="state"
                                    value={formData.state}
                                    label={cfg.getFieldLabel('state', 'State')}
                                    onChange={handleChange}
                                >
                                    {stateOptions.map((st) => {
                                        const v = typeof st === 'string' ? st : (st.value ?? st.id ?? '');
                                        const l = typeof st === 'string' ? st : (st.label ?? st.name ?? v);
                                        return <MenuItem key={v} value={v}>{l}</MenuItem>;
                                    })}
                                </Select>
                            </FormControl>
                        ) : (
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('state', 'State')}
                                name="state"
                                value={formData.state}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('state')}
                            />
                        )}
                    </Grid>
                )}

                {/* Pincode */}
                {cfg.isFieldVisible('pincode') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('pincode', 'Pincode')}
                            name="pincode"
                            value={formData.pincode}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('pincode')}
                            inputProps={{ maxLength: 6 }}
                        />
                    </Grid>
                )}

                {/* Country */}
                {cfg.isFieldVisible('country') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('country', 'Country')}
                            name="country"
                            value={formData.country}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('country')}
                        />
                    </Grid>
                )}
                {/* Dynamic custom fields added by admin */}
                <DynamicFieldRenderer
                    sectionKey="address"
                    cfg={cfg}
                    excludeKeys={['address_line1', 'address_line2', 'city', 'state', 'pincode', 'country']}
                    formData={formData}
                    onFieldChange={(fieldKey, value) => setFormData((prev) => ({ ...prev, [fieldKey]: value }))}
                />
            </Grid>
        </Box>
    );
};

export default React.memo(AddressSection);
