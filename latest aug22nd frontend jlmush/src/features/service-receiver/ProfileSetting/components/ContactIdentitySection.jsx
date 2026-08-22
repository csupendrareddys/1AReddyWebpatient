import React, { useState, useEffect, useCallback } from 'react';
import {
    Box, Grid, TextField, Button, Select, MenuItem,
    FormControl, InputLabel, Chip, Typography, Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import usePatientProfilePageConfig from '../hooks/usePatientProfilePageConfig';
import DynamicFieldRenderer from './DynamicFieldRenderer';
import { usePatientScope } from '../context/PatientScopeContext';
import {
    useGetContactIdentityQuery,
    useUpdateContactIdentityMutation,
} from '../api/scopedPatientApi';

const DEFAULT_RELIGION_OPTIONS = [
    'Hindu', 'Muslim', 'Christian', 'Sikh', 'Buddhist', 'Jain', 'Other',
];

const DEFAULT_CASTE_OPTIONS = [
    'General', 'OBC', 'SC', 'ST', 'Other',
];

// Normalise data-source items to { value, label } regardless of backend format
const norm = (opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: opt.value ?? opt.id ?? '', label: opt.label ?? opt.name ?? '' };
};

const ContactIdentitySection = ({ configOverride, registerSave, onOpenOtp }) => {
    const cfg = usePatientProfilePageConfig('en', 'patient', configOverride);
    // A patient can only change their login phone/email through the OTP flow,
    // so those stay read-only for them. A super-admin acting on behalf from
    // Operations is the IT-support fix-up path (wrong number captured at
    // signup) and can't receive the patient's OTP — they edit directly, and
    // the backend widens its allowlist for act-on-behalf writes to match.
    const { isOps } = usePatientScope();
    const { data: profileData } = useGetContactIdentityQuery();
    const [updateProfile, { isLoading: isSaving }] = useUpdateContactIdentityMutation();

    const dataSources = cfg.dataSources || {};
    const religionOptions = dataSources?.religion_options || DEFAULT_RELIGION_OPTIONS;
    const casteOptions = dataSources?.caste_options || DEFAULT_CASTE_OPTIONS;

    const [formData, setFormData] = useState({
        phone_number: '',
        alternative_phone: '',
        email: '',
        alternative_email: '',
        aadhar_number: '',
        pan_number: '',
        religion: '',
        caste: '',
        citizenship: '',
    });

    const [phoneVerified, setPhoneVerified] = useState(false);
    const [emailVerified, setEmailVerified] = useState(false);

    useEffect(() => {
        if (profileData) {
            const profile = profileData;
            setFormData((prev) => ({
                ...prev,
                phone_number: profile.phone_number || '',
                alternative_phone: profile.alternative_phone || '',
                email: profile.email || '',
                alternative_email: profile.alternative_email || '',
                aadhar_number: profile.aadhar_number || '',
                pan_number: profile.pan_number || '',
                religion: profile.religion || '',
                caste: profile.caste || '',
                citizenship: profile.citizenship || '',
            }));
            setPhoneVerified(!!profile.phone_verified);
            setEmailVerified(!!profile.email_verified);
        }
    }, [profileData]);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleSave = useCallback(async () => {
        const payload = { ...formData };
        // Exclude readonly fields from save payload
        if (!isOps) {
            delete payload.phone_number;
            delete payload.email;
        }
        await updateProfile(payload).unwrap();
    }, [formData, updateProfile, isOps]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save', isSaving);
        }
    }, [registerSave, handleSave, isSaving]);

    if (!cfg.isSectionVisible('contact_identity')) return null;

    return (
        <Box>
            <Grid container spacing={2}>
                {/* Phone Number — read-only + OTP for the patient, directly
                    editable for an admin acting on their behalf. */}
                {cfg.isFieldVisible('phone_number') && (
                    <Grid item xs={12} sm={6}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('phone_number', 'Phone Number')}
                                name="phone_number"
                                value={formData.phone_number}
                                onChange={isOps ? handleChange : undefined}
                                InputProps={{ readOnly: !isOps }}
                                helperText={isOps
                                    ? 'Editable as admin — must stay unique for this tenant'
                                    : 'OTP verification required to change'}
                            />
                            {phoneVerified && (
                                <Chip
                                    icon={<CheckCircleIcon />}
                                    label="Verified"
                                    color="success"
                                    size="small"
                                    variant="outlined"
                                />
                            )}
                            {!isOps && (
                                <Tooltip title="OTP required to change phone number">
                                    <Button variant="outlined" size="small" sx={{ minWidth: 80, whiteSpace: 'nowrap' }}
                                        onClick={() => onOpenOtp?.('phone_change')}>
                                        Change
                                    </Button>
                                </Tooltip>
                            )}
                        </Box>
                    </Grid>
                )}

                {/* Alternative Phone */}
                {cfg.isFieldVisible('alternative_phone') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('alternative_phone', 'Alternative Phone')}
                            name="alternative_phone"
                            value={formData.alternative_phone}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('alternative_phone')}
                        />
                    </Grid>
                )}

                {/* Email (readonly) */}
                {cfg.isFieldVisible('email') && (
                    <Grid item xs={12} sm={6}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('email', 'Email')}
                                name="email"
                                value={formData.email}
                                onChange={isOps ? handleChange : undefined}
                                InputProps={{ readOnly: !isOps }}
                                helperText={isOps
                                    ? 'Editable as admin — must stay unique for this tenant'
                                    : 'OTP verification required to change'}
                            />
                            {/* Honest badge — only "Verified" if the
                                server says so. Unverified addresses
                                show a warning chip so the user knows
                                email login + email reset are gated. */}
                            {emailVerified ? (
                                <Chip
                                    icon={<CheckCircleIcon />}
                                    label="Verified"
                                    color="success"
                                    size="small"
                                    variant="outlined"
                                />
                            ) : (
                                <Chip
                                    label="Unverified"
                                    color="warning"
                                    size="small"
                                    variant="outlined"
                                />
                            )}
                            {!isOps && (
                                <Tooltip title="OTP required to change email">
                                    <Button variant="outlined" size="small" sx={{ minWidth: 80, whiteSpace: 'nowrap' }}
                                        onClick={() => onOpenOtp?.('email_change')}>
                                        Change
                                    </Button>
                                </Tooltip>
                            )}
                        </Box>
                    </Grid>
                )}

                {/* Alternative Email */}
                {cfg.isFieldVisible('alternative_email') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('alternative_email', 'Alternative Email')}
                            name="alternative_email"
                            value={formData.alternative_email}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('alternative_email')}
                            type="email"
                        />
                    </Grid>
                )}

                {/* Aadhar Number */}
                {cfg.isFieldVisible('aadhar_number') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('aadhar_number', 'Aadhar Number')}
                            name="aadhar_number"
                            value={formData.aadhar_number}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('aadhar_number')}
                            inputProps={{ maxLength: 12 }}
                        />
                    </Grid>
                )}

                {/* PAN Number */}
                {cfg.isFieldVisible('pan_number') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('pan_number', 'PAN Number')}
                            name="pan_number"
                            value={formData.pan_number}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('pan_number')}
                            inputProps={{ maxLength: 10 }}
                        />
                    </Grid>
                )}

                {/* Religion */}
                {cfg.isFieldVisible('religion') && (
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth required={cfg.isFieldRequired('religion')}>
                            <InputLabel>{cfg.getFieldLabel('religion', 'Religion')}</InputLabel>
                            <Select
                                name="religion"
                                value={formData.religion}
                                label={cfg.getFieldLabel('religion', 'Religion')}
                                onChange={handleChange}
                            >
                                {religionOptions.map((opt) => {
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

                {/* Caste */}
                {cfg.isFieldVisible('caste') && (
                    <Grid item xs={12} sm={6}>
                        <FormControl fullWidth required={cfg.isFieldRequired('caste')}>
                            <InputLabel>{cfg.getFieldLabel('caste', 'Caste')}</InputLabel>
                            <Select
                                name="caste"
                                value={formData.caste}
                                label={cfg.getFieldLabel('caste', 'Caste')}
                                onChange={handleChange}
                            >
                                {casteOptions.map((opt) => {
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

                {/* Citizenship */}
                {cfg.isFieldVisible('citizenship') && (
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label={cfg.getFieldLabel('citizenship', 'Citizenship')}
                            name="citizenship"
                            value={formData.citizenship}
                            onChange={handleChange}
                            required={cfg.isFieldRequired('citizenship')}
                        />
                    </Grid>
                )}
                {/* Dynamic custom fields added by admin */}
                <DynamicFieldRenderer
                    sectionKey="contact_identity"
                    cfg={cfg}
                    excludeKeys={['phone_number', 'alternative_phone', 'email', 'alternative_email', 'aadhar_number', 'pan_number', 'religion', 'caste', 'citizenship']}
                    formData={formData}
                    onFieldChange={(fieldKey, value) => setFormData((prev) => ({ ...prev, [fieldKey]: value }))}
                />
            </Grid>
        </Box>
    );
};

export default React.memo(ContactIdentitySection);
