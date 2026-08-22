import React, { useEffect, useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import {
    Box, Grid, TextField, Button, Avatar, IconButton,
    Tooltip, Select, MenuItem, FormControl, InputLabel, Chip, Typography,
    Alert,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import MaleIcon from '@mui/icons-material/Male';
import FemaleIcon from '@mui/icons-material/Female';
import TransgenderIcon from '@mui/icons-material/Transgender';
import usePersonalDetails from '../hooks/usePersonalDetails';
import useDoctorProfilePageConfig from '../hooks/useDoctorProfilePageConfig';
import DocUploadField from '../components/DocUploadField';
import ApprovalChip from '../../../../common/components/ApprovalChip/ApprovalChip';
import ProfileImageUpload from '../../../../common/components/ProfileImageUpload/ProfileImageUpload';
import ContactChangeDialog from '../components/ContactChangeDialog';
import { useGetFieldStatusesQuery } from '../../../admin/api/fieldApprovalEndpoints';
import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';

/** Admin-verification status chip for a certificate document. */
const CertVerifyChip = ({ status }) => {
    const s = (status || 'pending').toLowerCase();
    const color = s === 'verified' ? 'success' : s === 'rejected' ? 'error' : 'warning';
    const label = s === 'verified' ? 'Approved'
        : s === 'rejected' ? 'Rejected' : 'Pending approval';
    return <Chip size="small" color={color} label={label} sx={{ mt: 0.5 }} />;
};

const PersonalProfessionalSection = React.memo(({ previewMode = false, configOverride = null, registerSave }) => {
    // Which contact field the OTP change dialog is open for ('phone' | 'email' | null).
    const [contactDialog, setContactDialog] = useState(null);
    const {
        formData,
        documentData,
        female_data,
        communication_data,
        permanent_address_data,
        loading,
        handleInputChange,
        handleDateChange,
        handleGenderSelect,
        handleSaveProfile,
        handleDocumentChange,
        handleDocumentFileChange,
        handleFemaleChange,
        handleCommunicationChange,
        handleCommunicationFileChange,
        handlePermanentAddressChange,
        handlePermanentAddressFileChange,
        handleCopyCommToPermanent,
        handleSaveExtendedProfile,
    } = usePersonalDetails(previewMode);

    const cfg = useDoctorProfilePageConfig('en', 'doctor', configOverride);

    // Clinic/hospital reuse this doctor section for their authorized person, so
    // the header reads "Authorized Person Profile Details" rather than the
    // doctor-centric "Personal & Professional Details".
    const userRole = useSelector((s) => s?.auth?.user?.role);
    const isFacility = userRole === 'clinic' || userRole === 'hospital';

    // Fetch field approval statuses
    const { data: myDoctorId } = useGetMyDoctorIdQuery(undefined, { skip: previewMode });
    const { data: fieldStatusData, refetch: refetchFieldStatuses } = useGetFieldStatusesQuery(
        { entityType: 'doctor', entityId: myDoctorId },
        { skip: previewMode || !myDoctorId }
    );
    const fieldStatuses = fieldStatusData?.field_statuses || {};

    // Helper to get approval status for a field
    const getFieldApprovalStatus = (section, fieldName) => {
        const key = `${section}.${fieldName}`;
        return fieldStatuses[key]?.status || null;
    };

    // Helper to get pending new_value for a field (used to show pending selections)
    const getPendingValue = (section, fieldName) => {
        const key = `${section}.${fieldName}`;
        const entry = fieldStatuses[key];
        if (entry && (entry.status === 'pending' || entry.status === 'query')) {
            return entry.new_value;
        }
        return null;
    };

    // If there's a pending gender value, use it for display so the doctor sees their submitted change
    const pendingGender = getPendingValue('personal_details', 'gender');
    const displayGender = pendingGender || formData.gender;

    const handleSave = useCallback(async () => {
        await Promise.resolve(handleSaveProfile());
        await Promise.resolve(handleSaveExtendedProfile());
        // Pull the just-created approval requests so the "Waiting for Approval"
        // chips appear immediately (the save doesn't invalidate this query).
        if (!previewMode && myDoctorId) refetchFieldStatuses();
    }, [handleSaveProfile, handleSaveExtendedProfile, refetchFieldStatuses, previewMode, myDoctorId]);

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save Profile', loading);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSave, loading]);

    if (!cfg.isSectionVisible('personal_details')) return null;

    // Collect pending fields for summary
    const pendingFields = Object.entries(fieldStatuses)
        .filter(([, info]) => info.status === 'pending' || info.status === 'query')
        .map(([key, info]) => ({ key, ...info }));

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            {/* Pending approvals summary */}
            {pendingFields.length > 0 && !previewMode && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight="bold" sx={{ mb: 0.5 }}>
                        {pendingFields.length} field(s) waiting for approval
                    </Typography>
                    <Box display="flex" gap={0.5} flexWrap="wrap">
                        {pendingFields.map((f) => (
                            <ApprovalChip key={f.key} status={f.status} />
                        ))}
                    </Box>
                </Alert>
            )}
            <Grid container spacing={4}>
                {/* Left — Avatar & Gender */}
                <Grid item xs={12} md={3} textAlign="center">
                    <Box className="profile-image-container" sx={{ mb: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                        <ProfileImageUpload
                            value={formData.profile_image}
                            fallback={formData.first_name?.[0] || 'D'}
                            size={150}
                            onChange={(url) => handleDateChange('profile_image', url)}
                        />
                        <ApprovalChip status={getFieldApprovalStatus('personal_details', 'profile_image')} />
                    </Box>

                    <Typography variant="subtitle1" sx={{ mt: 3, mb: 1, textAlign: 'left' }}>Gender:</Typography>
                    <Box display="flex" justifyContent="center" gap={2}>
                        <Tooltip title="Male">
                            <MaleIcon
                                className={`gender-icon gender-male ${displayGender === 'male' ? 'selected' : ''}`}
                                onClick={() => handleGenderSelect('male')}
                            />
                        </Tooltip>
                        <Tooltip title="Female">
                            <FemaleIcon
                                className={`gender-icon gender-female ${displayGender === 'female' ? 'selected' : ''}`}
                                onClick={() => handleGenderSelect('female')}
                            />
                        </Tooltip>
                        <Tooltip title="Others">
                            <TransgenderIcon
                                className={`gender-icon gender-other ${displayGender === 'other' ? 'selected' : ''}`}
                                onClick={() => handleGenderSelect('other')}
                            />
                        </Tooltip>
                    </Box>
                    <ApprovalChip status={getFieldApprovalStatus('personal_details', 'gender')} />
                </Grid>

                {/* Right — Form fields */}
                <Grid item xs={12} md={9}>
                    <div className="section-title-bar">{isFacility ? 'Authorized Person Profile Details' : cfg.getSectionLabel('personal_details', 'Personal & Professional Details')}</div>
                    <Grid container spacing={2}>
                        {cfg.isFieldVisible('first_name') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('first_name', 'First Name')} name="first_name" value={formData.first_name} onChange={handleInputChange} required={cfg.isFieldRequired('first_name', true)} />
                            <ApprovalChip status={getFieldApprovalStatus('personal_details', 'first_name')} pendingValue={getPendingValue('personal_details', 'first_name')} />
                        </Grid>}
                        {cfg.isFieldVisible('middle_name') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('middle_name', 'Middle Name')} name="middle_name" value={formData.middle_name} onChange={handleInputChange} required={cfg.isFieldRequired('middle_name')} />
                            <ApprovalChip status={getFieldApprovalStatus('personal_details', 'middle_name')} pendingValue={getPendingValue('personal_details', 'middle_name')} />
                        </Grid>}
                        {cfg.isFieldVisible('last_name') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('last_name', 'Last Name')} name="last_name" value={formData.last_name} onChange={handleInputChange} required={cfg.isFieldRequired('last_name')} />
                            <ApprovalChip status={getFieldApprovalStatus('personal_details', 'last_name')} pendingValue={getPendingValue('personal_details', 'last_name')} />
                        </Grid>}

                        {cfg.isFieldVisible('phone') && <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth label={cfg.getFieldLabel('phone', 'Phone Number')}
                                name="phone_number" value={formData.phone_number} disabled
                                helperText="Verified by OTP; change takes effect after admin approval."
                                InputProps={{
                                    endAdornment: !previewMode && (
                                        <Button size="small" onClick={() => setContactDialog('phone')}>Change</Button>
                                    ),
                                }}
                            />
                        </Grid>}
                        {cfg.isFieldVisible('email') && <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth label={cfg.getFieldLabel('email', 'Email')}
                                name="email" value={formData.email} disabled
                                helperText="Verified by OTP; change takes effect after admin approval."
                                InputProps={{
                                    endAdornment: !previewMode && (
                                        <Button size="small" onClick={() => setContactDialog('email')}>Change</Button>
                                    ),
                                }}
                            />
                        </Grid>}
                        <ContactChangeDialog
                            open={!!contactDialog}
                            channel={contactDialog}
                            currentValue={contactDialog === 'phone' ? formData.phone_number : formData.email}
                            onClose={() => setContactDialog(null)}
                        />

                        {cfg.isFieldVisible('dob') && <Grid item xs={12} sm={6}>
                            <DatePicker
                                label={cfg.getFieldLabel('dob', 'Date of Birth')}
                                value={formData.dob}
                                onChange={(date) => handleDateChange('dob', date)}
                                renderInput={(params) => <TextField {...params} fullWidth />}
                            />
                            <ApprovalChip
                                status={getFieldApprovalStatus('personal_details', 'dob')}
                                pendingValue={getPendingValue('personal_details', 'dob')}
                            />
                        </Grid>}
                        {cfg.isFieldVisible('registration_number') && <Grid item xs={12} sm={6}>
                            <TextField fullWidth label={cfg.getFieldLabel('registration_number', 'Registration Number')} name="registration_number" value={formData.registration_number} disabled />
                        </Grid>}

                        {/* Registration details + Certificate of Practice (COP) —
                            saved via the extended-profile flow (direct, like Aadhaar/PAN). */}
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Registration Name" name="registration_name" value={formData.registration_name || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="Registration Board / Council" name="registration_board" value={formData.registration_board || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="date" label="Registration Date" name="registration_date" InputLabelProps={{ shrink: true }} value={formData.registration_date || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth type="date" label="Registration Expiry" name="registration_expiry" InputLabelProps={{ shrink: true }} value={formData.registration_expiry || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={4}>
                            <TextField fullWidth label="Registration State" name="registration_state" value={formData.registration_state || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <Box mt={0.5}>
                                <DocUploadField
                                    fieldName="registration_certificate"
                                    label="Registration Certificate"
                                    accept="image/*,.pdf"
                                    value={documentData?.registration_certificate || ''}
                                    onChange={(file) => handleDocumentFileChange('registration_certificate', file)}
                                    onClear={() => handleDocumentFileChange('registration_certificate', null)}
                                />
                                <CertVerifyChip status={formData.registration_certificate_verification_status} />
                            </Box>
                        </Grid>
                        <Grid item xs={12}>
                            <Typography variant="subtitle2" sx={{ mt: 1 }}>Certificate of Practice (COP)</Typography>
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="COP Number" name="cop_number" value={formData.cop_number || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <TextField fullWidth label="COP Name" name="cop_name" value={formData.cop_name || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField fullWidth type="date" label="COP Date" name="cop_date" InputLabelProps={{ shrink: true }} value={formData.cop_date || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField fullWidth type="date" label="COP Expiry" name="cop_expiry" InputLabelProps={{ shrink: true }} value={formData.cop_expiry || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField fullWidth label="COP Board" name="cop_board" value={formData.cop_board || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={3}>
                            <TextField fullWidth label="COP State" name="cop_state" value={formData.cop_state || ''} onChange={handleInputChange} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <Box mt={0.5}>
                                <DocUploadField
                                    fieldName="cop_attachment"
                                    label="COP Certificate"
                                    accept="image/*,.pdf"
                                    value={documentData?.cop_attachment || ''}
                                    onChange={(file) => handleDocumentFileChange('cop_attachment', file)}
                                    onClear={() => handleDocumentFileChange('cop_attachment', null)}
                                />
                                <CertVerifyChip status={formData.cop_attachment_verification_status} />
                            </Box>
                        </Grid>

                        {cfg.isFieldVisible('experience_years') && <Grid item xs={12} sm={6}>
                            <TextField fullWidth label={cfg.getFieldLabel('experience_years', 'Years of Experience')} name="experience_years" type="number" value={formData.experience_years} onChange={handleInputChange} required={cfg.isFieldRequired('experience_years')} />
                            <ApprovalChip status={getFieldApprovalStatus('personal_details', 'experience_years')} pendingValue={getPendingValue('personal_details', 'experience_years')} />
                        </Grid>}
                    </Grid>
                </Grid>

                {/* ── Additional Personal Details ── */}
                {cfg.isSectionVisible('additional_personal_details') && <Grid item xs={12}>
                    <div className="section-title-bar">{cfg.getSectionLabel('additional_personal_details', 'Additional Personal Details')}</div>
                    <Grid container spacing={2}>
                        {cfg.isFieldVisible('alternate_phone') && <Grid item xs={12} sm={6}>
                            <TextField fullWidth label={cfg.getFieldLabel('alternate_phone', 'Alternate Phone Number')} name="alternate_phone_number" value={formData.alternate_phone_number || ''} onChange={handleInputChange} required={cfg.isFieldRequired('alternate_phone')} />
                        </Grid>}
                        {cfg.isFieldVisible('alternate_email') && <Grid item xs={12} sm={6}>
                            <TextField fullWidth label={cfg.getFieldLabel('alternate_email', 'Alternate Email')} name="alternate_email" type="email" value={formData.alternate_email || ''} onChange={handleInputChange} required={cfg.isFieldRequired('alternate_email')} />
                        </Grid>}
                        {cfg.isFieldVisible('height_cm') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('height_cm', 'Height (cm)')} name="height" type="number" value={formData.height || ''} onChange={handleInputChange} />
                        </Grid>}
                        {cfg.isFieldVisible('weight_kg') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('weight_kg', 'Weight (kg)')} name="weight" type="number" value={formData.weight || ''} onChange={handleInputChange} />
                        </Grid>}
                        {cfg.isFieldVisible('category') && <Grid item xs={12} sm={4}>
                            <FormControl fullWidth>
                                <InputLabel>{cfg.getFieldLabel('category', 'Category')}</InputLabel>
                                <Select name="category" value={formData.category || ''} label={cfg.getFieldLabel('category', 'Category')} onChange={handleInputChange}>
                                    <MenuItem value="">Select</MenuItem>
                                    <MenuItem value="General">General</MenuItem>
                                    <MenuItem value="OBC">OBC</MenuItem>
                                    <MenuItem value="SC">SC</MenuItem>
                                    <MenuItem value="ST">ST</MenuItem>
                                    <MenuItem value="Other">Other</MenuItem>
                                </Select>
                            </FormControl>
                        </Grid>}
                        {cfg.isFieldVisible('religion') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('religion', 'Religion')} name="religion" value={formData.religion || ''} onChange={handleInputChange} />
                        </Grid>}
                        {cfg.isFieldVisible('citizenship') && <Grid item xs={12} sm={4}>
                            <TextField fullWidth label={cfg.getFieldLabel('citizenship', 'Citizenship')} name="citizenship" value={formData.citizenship || ''} onChange={handleInputChange} />
                        </Grid>}
                        {cfg.isFieldVisible('languages_known') && <Grid item xs={12} sm={4}>
                            <TextField
                                fullWidth
                                label={cfg.getFieldLabel('languages_known', 'Languages Known (comma-separated)')}
                                name="languages_known"
                                value={Array.isArray(formData.languages_known) ? formData.languages_known.join(', ') : (formData.languages_known || '')}
                                onChange={(e) => {
                                    const val = e.target.value.split(',').map(s => s.trimStart());
                                    handleInputChange({ target: { name: 'languages_known', value: val } });
                                }}
                                helperText="e.g. English, Hindi, Tamil"
                            />
                        </Grid>}
                    </Grid>
                </Grid>}

                {/* ── Identity Documents ── */}
                {cfg.isSectionVisible('identity_documents') && <Grid item xs={12}>
                    <div className="section-title-bar">{cfg.getSectionLabel('identity_documents', 'Identity Documents')}</div>
                    <Grid container spacing={2}>
                        {cfg.isFieldVisible('aadhar_number') && <Grid item xs={12} sm={5}>
                            <TextField fullWidth label={cfg.getFieldLabel('aadhar_number', 'Aadhar Number')} name="aadhar_number" value={documentData?.aadhar_number || ''} onChange={handleDocumentChange} inputProps={{ maxLength: 12 }} required={cfg.isFieldRequired('aadhar_number', true)} />
                        </Grid>}
                        <Grid item xs={12} sm={7}>
                            <TextField fullWidth label="Name as per Aadhaar" name="name_as_per_aadhaar" value={formData.name_as_per_aadhaar || ''} onChange={handleInputChange} />
                        </Grid>
                        {cfg.isFieldVisible('aadhar_attachment') && <Grid item xs={12} sm={7}>
                            <Box mt={0.5}>
                                <DocUploadField
                                    fieldName="aadhar_attachment"
                                    label={cfg.getFieldLabel('aadhar_attachment', 'Upload Aadhar')}
                                    accept="image/*,.pdf"
                                    value={documentData?.aadhar_attachment || ''}
                                    onChange={(file) => handleDocumentFileChange('aadhar_attachment', file)}
                                    onClear={() => handleDocumentFileChange('aadhar_attachment', null)}
                                />
                            </Box>
                        </Grid>}
                        {cfg.isFieldVisible('pan_number') && <Grid item xs={12} sm={5}>
                            <TextField fullWidth label={cfg.getFieldLabel('pan_number', 'PAN Number')} name="pan_number" value={documentData?.pan_number || ''} onChange={handleDocumentChange} inputProps={{ maxLength: 10 }} required={cfg.isFieldRequired('pan_number')} />
                        </Grid>}
                        <Grid item xs={12} sm={7}>
                            <TextField fullWidth label="Name as per PAN" name="name_as_per_pan" value={formData.name_as_per_pan || ''} onChange={handleInputChange} />
                        </Grid>
                        {cfg.isFieldVisible('pan_attachment') && <Grid item xs={12} sm={7}>
                            <Box mt={0.5}>
                                <DocUploadField
                                    fieldName="pan_attachment"
                                    label={cfg.getFieldLabel('pan_attachment', 'Upload PAN')}
                                    accept="image/*,.pdf"
                                    value={documentData?.pan_attachment || ''}
                                    onChange={(file) => handleDocumentFileChange('pan_attachment', file)}
                                    onClear={() => handleDocumentFileChange('pan_attachment', null)}
                                />
                            </Box>
                        </Grid>}
                    </Grid>
                </Grid>}

                {/* ── Female Health Data (conditional) ── */}
                {displayGender === 'female' && cfg.isSectionVisible('female_health_details') && (
                    <Grid item xs={12}>
                        <div className="section-title-bar">{cfg.getSectionLabel('female_health_details', 'Female Health Details')}</div>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="LMP Date" name="LMP_calender" type="date" InputLabelProps={{ shrink: true }} value={female_data?.LMP_calender || ''} onChange={handleFemaleChange} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="LMP Remarks" name="LMP_remarks" value={female_data?.LMP_remarks || ''} onChange={handleFemaleChange} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <FormControl fullWidth>
                                    <InputLabel>Pregnancy Status</InputLabel>
                                    <Select name="pregnancy_status" value={female_data?.pregnancy_status || ''} label="Pregnancy Status" onChange={handleFemaleChange}>
                                        <MenuItem value="">Select</MenuItem>
                                        <MenuItem value="not_pregnant">Not Pregnant</MenuItem>
                                        <MenuItem value="pregnant">Pregnant</MenuItem>
                                        <MenuItem value="postpartum">Postpartum</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="Pregnancy Status Remarks" name="pregnancy_status_remarks" value={female_data?.pregnancy_status_remarks || ''} onChange={handleFemaleChange} />
                            </Grid>
                        </Grid>
                    </Grid>
                )}

                {/* ── Communication (Current) Address ── */}
                {cfg.isSectionVisible('current_address') && <Grid item xs={12}>
                    <div className="section-title-bar">{cfg.getSectionLabel('current_address', 'Communication (Current) Address')}</div>
                    <Grid container spacing={2}>
                        {[
                            { label: 'Address', name: 'address', sm: 12 },
                            { label: 'Landmark', name: 'landmark', sm: 6 },
                            { label: 'City', name: 'city', sm: 6 },
                            { label: 'District', name: 'district', sm: 4 },
                            { label: 'State', name: 'state', sm: 4 },
                            { label: 'Pincode', name: 'pincode', sm: 4 },
                            { label: 'Country', name: 'country', sm: 6 },
                            { label: 'GPS Location', name: 'gps_location', sm: 6 },
                            { label: 'Address Proof Type', name: 'address_id_proof_type', sm: 4 },
                            { label: 'Address Proof Number', name: 'address_id_proof_number', sm: 4 },
                        ].map(({ label, name, sm }) => (
                            <Grid item xs={12} sm={sm} key={name}>
                                <TextField fullWidth label={label} name={name} value={communication_data?.[name] || ''} onChange={handleCommunicationChange} />
                            </Grid>
                        ))}
                        <Grid item xs={12} sm={4}>
                            <DocUploadField
                                fieldName="comm_address_id_proof_attachment"
                                label="Upload Address Proof"
                                accept="image/*,.pdf"
                                value={communication_data?.address_id_proof_attachment || ''}
                                onChange={(file) => handleCommunicationFileChange('address_id_proof_attachment', file)}
                                onClear={() => handleCommunicationFileChange('address_id_proof_attachment', null)}
                            />
                        </Grid>
                    </Grid>
                </Grid>}

                {/* ── Permanent Address ── */}
                {cfg.isSectionVisible('permanent_address') && <Grid item xs={12}>
                    <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                        <div className="section-title-bar" style={{ margin: 0 }}>{cfg.getSectionLabel('permanent_address', 'Permanent Address')}</div>
                        <Button variant="text" size="small" onClick={handleCopyCommToPermanent} sx={{ textTransform: 'none', fontSize: '0.82rem' }}>
                            Copy from Current Address
                        </Button>
                    </Box>
                    <Grid container spacing={2}>
                        {[
                            { label: 'Address', name: 'address', sm: 12 },
                            { label: 'Landmark', name: 'landmark', sm: 6 },
                            { label: 'City', name: 'city', sm: 6 },
                            { label: 'District', name: 'district', sm: 4 },
                            { label: 'State', name: 'state', sm: 4 },
                            { label: 'Pincode', name: 'pincode', sm: 4 },
                            { label: 'Country', name: 'country', sm: 6 },
                            { label: 'GPS Location', name: 'gps_location', sm: 6 },
                            { label: 'Address Proof Type', name: 'address_id_proof_type', sm: 4 },
                            { label: 'Address Proof Number', name: 'address_id_proof_number', sm: 4 },
                        ].map(({ label, name, sm }) => (
                            <Grid item xs={12} sm={sm} key={name}>
                                <TextField fullWidth label={label} name={name} value={permanent_address_data?.[name] || ''} onChange={handlePermanentAddressChange} />
                            </Grid>
                        ))}
                        <Grid item xs={12} sm={4}>
                            <DocUploadField
                                fieldName="perm_address_id_proof_attachment"
                                label="Upload Address Proof"
                                accept="image/*,.pdf"
                                value={permanent_address_data?.address_id_proof_attachment || ''}
                                onChange={(file) => handlePermanentAddressFileChange('address_id_proof_attachment', file)}
                                onClear={() => handlePermanentAddressFileChange('address_id_proof_attachment', null)}
                            />
                        </Grid>
                    </Grid>
                </Grid>}

            </Grid>
        </LocalizationProvider>
    );
});

PersonalProfessionalSection.displayName = 'PersonalProfessionalSection';

export default PersonalProfessionalSection;
