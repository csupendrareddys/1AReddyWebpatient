import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Box, Grid, TextField, Button, Avatar, IconButton,
    Tooltip, Select, MenuItem, FormControl, InputLabel, Chip,
    Typography, Autocomplete,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import ProfileImageUpload from '../../../../common/components/ProfileImageUpload/ProfileImageUpload';
import {
    useGetPersonalDetailsQuery,
    useUpdatePersonalDetailsMutation,
} from '../api/scopedPatientApi';
import { toLocalDateString } from '../../../../common/utils/date';

const DEFAULT_GENDER_OPTIONS = [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'other', label: 'Other' },
];

const DEFAULT_BLOOD_GROUPS = [
    { value: 'a_positive', label: 'A+' },
    { value: 'a_negative', label: 'A-' },
    { value: 'b_positive', label: 'B+' },
    { value: 'b_negative', label: 'B-' },
    { value: 'ab_positive', label: 'AB+' },
    { value: 'ab_negative', label: 'AB-' },
    { value: 'o_positive', label: 'O+' },
    { value: 'o_negative', label: 'O-' },
];

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const PersonalDetailsSection = ({ configOverride, registerSave }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = useGetPersonalDetailsQuery();
    const [updateProfile, { isLoading: isSaving }] = useUpdatePersonalDetailsMutation();

    const dataSources = cfg.dataSources || {};
    const genderOptions = dataSources?.gender_options || DEFAULT_GENDER_OPTIONS;
    const bloodGroups = dataSources?.blood_groups || DEFAULT_BLOOD_GROUPS;
    const languageOptions = dataSources?.indian_languages || [];

    const [formData, setFormData] = useState({
        first_name: '',
        middle_name: '',
        last_name: '',
        dob: null,
        gender: '',
        blood_group: '',
        languages_known: [],
        profile_image: '',
    });

    useEffect(() => {
        if (profileData) {
            const profile = profileData;
            setFormData((prev) => ({
                ...prev,
                first_name: profile.first_name || '',
                middle_name: profile.middle_name || '',
                last_name: profile.last_name || '',
                dob: profile.dob ? new Date(profile.dob) : null,
                gender: profile.gender || '',
                blood_group: profile.blood_group || '',
                languages_known: profile.languages_known || [],
                profile_image: profile.profile_image || '',
            }));
        }
    }, [profileData]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleDateChange = useCallback((date) => {
        setFormData((prev) => ({ ...prev, dob: date }));
    }, []);

    const handleLanguagesChange = useCallback((_, newValue) => {
        setFormData((prev) => ({ ...prev, languages_known: newValue }));
    }, []);

    const handleSave = useCallback(async () => {
        const payload = { ...formData };
        if (payload.dob) {
            payload.dob = toLocalDateString(payload.dob);
        }
        await updateProfile(payload).unwrap();
    }, [formData, updateProfile]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save', isSaving);
        }
    }, [registerSave, handleSave, isSaving]);

    if (!cfg.isSectionVisible('personal_details')) return null;

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box>
                {/* Avatar Upload Placeholder */}
                {cfg.isFieldVisible('profile_image') && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <ProfileImageUpload
                            value={formData.profile_image}
                            fallback={formData.first_name?.[0]}
                            onChange={(url) => {
                                // Show it now, and refresh the cached profile so it
                                // survives in-app navigation (the upload set it
                                // server-side but doesn't invalidate this query).
                                setFormData((prev) => ({ ...prev, profile_image: url }));
                                refetchProfile();
                            }}
                        />
                        <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
                            Click the camera to upload a profile photo
                        </Typography>
                    </Box>
                )}

                <Grid container spacing={2}>
                    {/* First Name */}
                    {cfg.isFieldVisible('first_name') && (
                        <Grid item xs={12} sm={4}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('first_name', 'First Name')}
                                name="first_name"
                                value={formData.first_name}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('first_name')}
                            />
                        </Grid>
                    )}

                    {/* Middle Name */}
                    {cfg.isFieldVisible('middle_name') && (
                        <Grid item xs={12} sm={4}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('middle_name', 'Middle Name')}
                                name="middle_name"
                                value={formData.middle_name}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('middle_name')}
                            />
                        </Grid>
                    )}

                    {/* Last Name */}
                    {cfg.isFieldVisible('last_name') && (
                        <Grid item xs={12} sm={4}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('last_name', 'Last Name')}
                                name="last_name"
                                value={formData.last_name}
                                onChange={handleChange}
                                required={cfg.isFieldRequired('last_name')}
                            />
                        </Grid>
                    )}

                    {/* Date of Birth */}
                    {cfg.isFieldVisible('dob') && (
                        <Grid item xs={12} sm={4}>
                            <DatePicker
                                label={cfg.getFieldLabel('dob', 'Date of Birth')}
                                value={formData.dob}
                                onChange={handleDateChange}
                                slotProps={{
                                    textField: {
                                        fullWidth: true,
                                        required: cfg.isFieldRequired('dob'),
                                    },
                                }}
                            />
                        </Grid>
                    )}

                    {/* Gender */}
                    {cfg.isFieldVisible('gender') && (
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth required={cfg.isFieldRequired('gender')}>
                                <InputLabel>{cfg.getFieldLabel('gender', 'Gender')}</InputLabel>
                                <Select
                                    name="gender"
                                    value={formData.gender}
                                    label={cfg.getFieldLabel('gender', 'Gender')}
                                    onChange={handleChange}
                                >
                                    {genderOptions.map((opt) => {
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

                    {/* Blood Group */}
                    {cfg.isFieldVisible('blood_group') && (
                        <Grid item xs={12} sm={4}>
                            <FormControl fullWidth required={cfg.isFieldRequired('blood_group')}>
                                <InputLabel>{cfg.getFieldLabel('blood_group', 'Blood Group')}</InputLabel>
                                <Select
                                    name="blood_group"
                                    value={formData.blood_group}
                                    label={cfg.getFieldLabel('blood_group', 'Blood Group')}
                                    onChange={handleChange}
                                >
                                    {bloodGroups.map((bg) => {
                                        const n = norm(bg);
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

                    {/* Languages Known */}
                    {cfg.isFieldVisible('languages_known') && (
                        <Grid item xs={12}>
                            <Autocomplete
                                multiple
                                options={languageOptions}
                                getOptionLabel={(option) => {
                                    const n = norm(option);
                                    return option?.native
                                        ? `${n.label} (${option.native})`
                                        : n.label || String(option);
                                }}
                                value={formData.languages_known}
                                onChange={handleLanguagesChange}
                                isOptionEqualToValue={(option, value) =>
                                    norm(option).value === norm(value).value
                                }
                                renderTags={(value, getTagProps) =>
                                    value.map((option, index) => {
                                        const n = norm(option);
                                        return (
                                            <Chip
                                                {...getTagProps({ index })}
                                                key={n.value || index}
                                                label={
                                                    option?.native
                                                        ? `${n.label} (${option.native})`
                                                        : n.label
                                                }
                                                size="small"
                                            />
                                        );
                                    })
                                }
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label={cfg.getFieldLabel('languages_known', 'Languages Known')}
                                        required={cfg.isFieldRequired('languages_known')}
                                        placeholder="Select languages"
                                    />
                                )}
                            />
                        </Grid>
                    )}
                    {/* Dynamic custom fields added by admin */}
                    <DynamicFieldRenderer
                        sectionKey="personal_details"
                        cfg={cfg}
                        excludeKeys={['first_name', 'middle_name', 'last_name', 'dob', 'gender', 'blood_group', 'languages_known', 'profile_image']}
                        formData={formData}
                        onFieldChange={(fieldKey, value) => setFormData((prev) => ({ ...prev, [fieldKey]: value }))}
                    />
                </Grid>
            </Box>
        </LocalizationProvider>
    );
};

export default React.memo(PersonalDetailsSection);
