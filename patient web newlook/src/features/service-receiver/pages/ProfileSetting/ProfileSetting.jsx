import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    Box, Container, Typography, Paper, Grid, TextField, Button,
    Select, MenuItem, FormControl, InputLabel, Avatar, IconButton,
    RadioGroup, Radio, FormControlLabel, Chip, Dialog, DialogTitle,
    DialogContent, DialogActions, Divider, CircularProgress, Alert, Tooltip,
    Snackbar
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import AddIcon from '@mui/icons-material/Add';
import MaleIcon from '@mui/icons-material/Male';
import FemaleIcon from '@mui/icons-material/Female';
import TransgenderIcon from '@mui/icons-material/Transgender';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import {
    fetchPatientProfile,
    updateProfile,
    fetchHouseGroup,
    addHouseGroupMember,
    updateHouseGroupMember,
    deleteHouseGroupMember,
    sendOtp,
    verifyAndUpdateContact
} from '../../redux/patientSlice';
import { toLocalDateString } from '../../../../common/utils/date';

import './ProfileSetting.css';

const ProfileSetting = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const {
        profile, profileLoading, houseGroup, houseGroupLoading,
        houseGroupActionLoading, profileError, houseGroupError
    } = useSelector((state) => state.patient);

    const [formData, setFormData] = useState({
        first_name: '', middle_name: '', last_name: '',
        phone_number: '', email: '', gender: '', dob: null,
        blood_group: '',
        caste: '', religion: '', citizenship: '',
        pan_number: '', aadhar_number: '',
        alternative_phone: '', alternative_email: '',

        // Address
        address_line1: '', address_line2: '',
        city: '', state: '', pincode: '', country: 'India',

        // Organization
        organization_type: 'individual', // or organization

        // Female specifics
        lmp_date: null, lmp_remarks: '',
        pregnancy_status: '', pregnancy_remarks: ''
    });

    const [memberDialogOpen, setMemberDialogOpen] = useState(false);
    const [editingMember, setEditingMember] = useState(null);
    const [memberForm, setMemberForm] = useState({
        relation: 'Spouse', first_name: '', last_name: '', gender: '', dob: null,
        blood_group: '', phone_number: ''
    });

    // OTP Dialog State
    const [otpDialogOpen, setOtpDialogOpen] = useState(false);
    const [otpPurpose, setOtpPurpose] = useState(''); // 'phone_change' or 'email_change'
    const [otpIdentifier, setOtpIdentifier] = useState('');
    const [otpValue, setOtpValue] = useState('');
    const [otpSent, setOtpSent] = useState(false);
    const [otpLoading, setOtpLoading] = useState(false);
    const [otpError, setOtpError] = useState('');

    // Verification tracking - track original values and verified status
    const [originalPhone, setOriginalPhone] = useState('');
    const [originalEmail, setOriginalEmail] = useState('');
    const [phoneVerified, setPhoneVerified] = useState(true); // True means no change or verified
    const [emailVerified, setEmailVerified] = useState(true);

    // Snackbar for success/error messages
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });

    // Load initial data
    useEffect(() => {
        dispatch(fetchPatientProfile()).unwrap().then((data) => {
            if (data) {
                console.log('Profile data loaded:', data);
                // Store original phone/email for verification tracking
                setOriginalPhone(data.phone_number || '');
                setOriginalEmail(data.email || '');
                setPhoneVerified(true); // Original values are already verified
                setEmailVerified(true);

                // Populate form with all available data
                setFormData(prev => ({
                    ...prev,
                    first_name: data.first_name || '',
                    middle_name: data.middle_name || '',
                    last_name: data.last_name || '',
                    phone_number: data.phone_number || '',
                    email: data.email || '',
                    gender: data.gender || '',
                    dob: data.dob ? new Date(data.dob) : null,
                    blood_group: data.blood_group || '',
                    caste: data.caste || '',
                    religion: data.religion || '',
                    citizenship: data.citizenship || '',
                    pan_number: data.pan_number || '',
                    aadhar_number: data.aadhar_number || '',
                    alternative_phone: data.alternative_phone || '',
                    alternative_email: data.alternative_email || '',
                    // Emergency contact
                    emergency_contact_name: data.emergency_contact_name || '',
                    emergency_contact_phone: data.emergency_contact_phone || '',
                    emergency_contact_relation: data.emergency_contact_relation || '',
                    // Insurance
                    insurance_provider: data.insurance_provider || '',
                    insurance_policy_number: data.insurance_policy_number || '',
                    // Languages
                    languages_known: data.languages_known || [],
                    // Female health details (if exists)
                    ...(data.female_health_details || {}),
                }));
            }
        }).catch(err => {
            console.error('Failed to load profile:', err);
        });
        dispatch(fetchHouseGroup());
    }, [dispatch]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));

        // Track phone/email changes - mark as unverified if changed from original
        if (name === 'phone_number') {
            setPhoneVerified(value === originalPhone);
        } else if (name === 'email') {
            setEmailVerified(value === originalEmail);
        }
    };

    const handleDateChange = (name, date) => {
        setFormData(prev => ({ ...prev, [name]: date }));
    };

    const handleSaveProfile = async () => {
        const payload = { ...formData };
        if (payload.dob) payload.dob = toLocalDateString(payload.dob);
        if (payload.lmp_date) {
            payload.female_health_details = {
                ...payload.female_health_details,
                lmp_date: toLocalDateString(payload.lmp_date),
                lmp_remarks: payload.lmp_remarks,
                pregnancy_status: payload.pregnancy_status,
                pregnancy_remarks: payload.pregnancy_remarks
            };
        }
        try {
            await dispatch(updateProfile(payload)).unwrap();
            setSnackbar({ open: true, message: 'Profile saved successfully!', severity: 'success' });
        } catch (err) {
            setSnackbar({ open: true, message: err.message || 'Failed to save profile', severity: 'error' });
        }
    };

    const handleMemberSubmit = async () => {
        const payload = { ...memberForm };
        if (payload.dob) payload.dob = toLocalDateString(payload.dob);

        if (editingMember) {
            await dispatch(updateHouseGroupMember({ memberId: editingMember.id, data: payload }));
        } else {
            await dispatch(addHouseGroupMember(payload));
        }
        setMemberDialogOpen(false);
        setEditingMember(null);
        setMemberForm({ relation: 'Spouse', first_name: '', last_name: '', gender: '', dob: null, blood_group: '', phone_number: '' });
    };

    const openAddMember = () => {
        setEditingMember(null);
        setMemberForm({ relation: 'Spouse', first_name: '', last_name: '', gender: '', dob: null, blood_group: '', phone_number: '' });
        setMemberDialogOpen(true);
    };

    const openEditMember = (member) => {
        setEditingMember(member);
        setMemberForm({
            relation: member.relation,
            first_name: member.first_name,
            last_name: member.last_name,
            gender: member.gender || '',
            dob: member.dob ? new Date(member.dob) : null,
            blood_group: member.blood_group || '',
            phone_number: member.phone_number || ''
        });
        setMemberDialogOpen(true);
    };

    // OTP Handlers
    const openOtpDialog = (purpose) => {
        const identifier = purpose === 'phone_change' ? formData.phone_number : formData.email;
        setOtpPurpose(purpose);
        setOtpIdentifier(identifier);
        setOtpValue('');
        setOtpSent(false);
        setOtpError('');
        setOtpDialogOpen(true);
    };

    const handleSendOtp = async () => {
        setOtpLoading(true);
        setOtpError('');
        try {
            await dispatch(sendOtp({ identifier: otpIdentifier, purpose: otpPurpose })).unwrap();
            setOtpSent(true);
        } catch (err) {
            setOtpError(err.message || 'Failed to send OTP');
        }
        setOtpLoading(false);
    };

    const handleVerifyOtp = async () => {
        setOtpLoading(true);
        setOtpError('');
        try {
            const result = await dispatch(verifyAndUpdateContact({
                identifier: otpIdentifier,
                otp: otpValue,
                purpose: otpPurpose
            })).unwrap();
            // Update form data with new value and mark as verified
            if (otpPurpose === 'phone_change') {
                setFormData(prev => ({ ...prev, phone_number: otpIdentifier }));
                setOriginalPhone(otpIdentifier); // Update original to new verified value
                setPhoneVerified(true);
            } else {
                setFormData(prev => ({ ...prev, email: otpIdentifier }));
                setOriginalEmail(otpIdentifier); // Update original to new verified value
                setEmailVerified(true);
            }
            setOtpDialogOpen(false);
        } catch (err) {
            setOtpError(err.message || 'Invalid OTP');
        }
        setOtpLoading(false);
    };

    return (
        <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Box className="profile-setting-container">
                {/* Header */}
                <Box sx={{ bgcolor: 'white', p: 2, borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center' }}>
                    <IconButton onClick={() => navigate(-1)} sx={{ mr: 2 }}>
                        <ArrowBackIcon />
                    </IconButton>
                    <Typography variant="h6" color="primary" sx={{ flexGrow: 1 }}>
                        Profile Setting
                    </Typography>
                    <Avatar sx={{ bgcolor: 'secondary.main', width: 40, height: 40 }}>
                        {profile?.first_name?.[0]}
                    </Avatar>
                </Box>

                <Container maxWidth="lg" sx={{ mt: 3 }}>
                    {(profileError || houseGroupError) && (
                        <Alert severity="error" sx={{ mb: 2 }}>{profileError || houseGroupError}</Alert>
                    )}

                    {/* House Group Section */}
                    <Box className="section-header" display="flex" justifyContent="space-between" alignItems="center">
                        <Typography variant="subtitle1">House Group</Typography>
                        <Button
                            variant="contained"
                            size="small"
                            color="secondary"
                            startIcon={<AddIcon />}
                            onClick={openAddMember}
                        >
                            Add Family Member
                        </Button>
                    </Box>

                    <Grid container spacing={2} sx={{ mb: 4 }}>
                        <Grid item xs={12} sm={6} md={3}>
                            <Paper className="house-group-card active" sx={{ p: 2, textAlign: 'center', cursor: 'pointer' }}>
                                <Typography variant="subtitle2" color="primary">Self / Master</Typography>
                                <Avatar sx={{ width: 60, height: 60, mx: 'auto', my: 1, bgcolor: '#1976d2' }}>
                                    {formData.first_name?.[0]}
                                </Avatar>
                                <Typography variant="body1" fontWeight="bold">
                                    {formData.first_name} {formData.last_name}
                                </Typography>
                            </Paper>
                        </Grid>
                        {houseGroup.map((member) => (
                            <Grid item xs={12} sm={6} md={3} key={member.id}>
                                <Paper className="house-group-card" sx={{ p: 2, textAlign: 'center', position: 'relative' }}>
                                    <IconButton
                                        size="small"
                                        sx={{ position: 'absolute', right: 5, top: 5 }}
                                        onClick={() => openEditMember(member)}
                                    >
                                        <EditIcon fontSize="small" />
                                    </IconButton>
                                    <Typography variant="subtitle2" color="text.secondary">{member.relation}</Typography>
                                    <Avatar sx={{ width: 60, height: 60, mx: 'auto', my: 1 }}>
                                        {member.first_name[0]}
                                    </Avatar>
                                    <Typography variant="body1" fontWeight="bold">
                                        {member.full_name}
                                    </Typography>
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>

                    {/* Profile Data Section */}
                    <Button fullWidth variant="contained" color="success" sx={{ mb: 3, py: 1.5 }}>
                        Profile Data
                    </Button>

                    <Grid container spacing={4}>
                        {/* Left Column - Profile Pic & Gender */}
                        <Grid item xs={12} md={3} textAlign="center">
                            <Box className="profile-image-container" sx={{ mb: 3 }}>
                                <Avatar
                                    src={profile?.profile_image}
                                    sx={{ width: 150, height: 150, mb: 2, border: '4px solid white', boxShadow: 2 }}
                                />
                                <IconButton className="profile-image-upload-btn">
                                    <PhotoCameraIcon />
                                </IconButton>
                            </Box>
                            <Button variant="contained" size="small">Update Profile Pic</Button>

                            <Typography variant="subtitle1" sx={{ mt: 3, mb: 1, textAlign: 'left' }}>Gender:</Typography>
                            <Box display="flex" justifyContent="center" gap={2}>
                                <Tooltip title="Male">
                                    <MaleIcon
                                        className={`gender-icon gender-male ${formData.gender === 'male' ? 'selected' : ''}`}
                                        onClick={() => setFormData({ ...formData, gender: 'male' })}
                                    />
                                </Tooltip>
                                <Tooltip title="Female">
                                    <FemaleIcon
                                        className={`gender-icon gender-female ${formData.gender === 'female' ? 'selected' : ''}`}
                                        onClick={() => setFormData({ ...formData, gender: 'female' })}
                                    />
                                </Tooltip>
                                <Tooltip title="Others">
                                    <TransgenderIcon
                                        className={`gender-icon gender-other ${formData.gender === 'other' ? 'selected' : ''}`}
                                        onClick={() => setFormData({ ...formData, gender: 'other' })}
                                    />
                                </Tooltip>
                            </Box>
                        </Grid>

                        {/* Right Column - Form Fields */}
                        <Grid item xs={12} md={9}>
                            <div className="section-title-bar">Personal Details</div>
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={4}>
                                    <TextField fullWidth label="First Name" name="first_name" value={formData.first_name} onChange={handleInputChange} required />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <TextField fullWidth label="Middle Name" name="middle_name" value={formData.middle_name} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <TextField fullWidth label="Last Name" name="last_name" value={formData.last_name} onChange={handleInputChange} required />
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <Box display="flex" gap={1} alignItems="center">
                                        <TextField
                                            fullWidth
                                            label="Mobile Number"
                                            name="phone_number"
                                            value={formData.phone_number}
                                            onChange={handleInputChange}
                                        />
                                        {phoneVerified && (
                                            <CheckCircleIcon color="success" titleAccess="Verified" />
                                        )}
                                        <Button
                                            variant={phoneVerified ? "outlined" : "contained"}
                                            size="small"
                                            color={phoneVerified ? "primary" : "warning"}
                                            onClick={() => openOtpDialog('phone_change')}
                                            sx={{ minWidth: 80 }}
                                        >
                                            {phoneVerified ? 'Verify' : 'Verify!'}
                                        </Button>
                                    </Box>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Box display="flex" gap={1} alignItems="center">
                                        <TextField
                                            fullWidth
                                            label="Email ID"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleInputChange}
                                            type="email"
                                        />
                                        {emailVerified && (
                                            <CheckCircleIcon color="success" titleAccess="Verified" />
                                        )}
                                        <Button
                                            variant={emailVerified ? "outlined" : "contained"}
                                            size="small"
                                            color={emailVerified ? "primary" : "warning"}
                                            onClick={() => openOtpDialog('email_change')}
                                            sx={{ minWidth: 80 }}
                                        >
                                            {emailVerified ? 'Verify' : 'Verify!'}
                                        </Button>
                                    </Box>
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <DatePicker
                                        label="Date of Birth"
                                        value={formData.dob}
                                        onChange={(date) => handleDateChange('dob', date)}
                                        renderInput={(params) => <TextField {...params} fullWidth />}
                                    />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <FormControl fullWidth>
                                        <InputLabel>Blood Group</InputLabel>
                                        <Select name="blood_group" value={formData.blood_group} label="Blood Group" onChange={handleInputChange}>
                                            <MenuItem value="A_POSITIVE">A+</MenuItem>
                                            <MenuItem value="O_POSITIVE">O+</MenuItem>
                                            <MenuItem value="B_POSITIVE">B+</MenuItem>
                                            <MenuItem value="AB_POSITIVE">AB+</MenuItem>
                                            {/* Add others */}
                                        </Select>
                                    </FormControl>
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Aadhar Number" name="aadhar_number" value={formData.aadhar_number} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="PAN Number" name="pan_number" value={formData.pan_number} onChange={handleInputChange} />
                                </Grid>

                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Caste" name="caste" value={formData.caste} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Religion" name="religion" value={formData.religion} onChange={handleInputChange} />
                                </Grid>
                            </Grid>

                            {/* Female Specific Fields */}
                            {formData.gender === 'female' && (
                                <>
                                    <div className="section-title-bar" style={{ marginTop: 24 }}>Female Health Details</div>
                                    <Grid container spacing={2}>
                                        <Grid item xs={12} sm={6}>
                                            <DatePicker
                                                label="LMP Date"
                                                value={formData.lmp_date}
                                                onChange={(date) => handleDateChange('lmp_date', date)}
                                                renderInput={(params) => <TextField {...params} fullWidth />}
                                            />
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <TextField fullWidth label="LMP Remarks" name="lmp_remarks" value={formData.lmp_remarks} onChange={handleInputChange} />
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <FormControl fullWidth>
                                                <InputLabel>Pregnancy Status</InputLabel>
                                                <Select name="pregnancy_status" value={formData.pregnancy_status} label="Pregnancy Status" onChange={handleInputChange}>
                                                    <MenuItem value="pregnant">Pregnant</MenuItem>
                                                    <MenuItem value="not_pregnant">Not Pregnant</MenuItem>
                                                    <MenuItem value="planning">Planning</MenuItem>
                                                </Select>
                                            </FormControl>
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <TextField fullWidth label="Pregnancy Remarks" name="pregnancy_remarks" value={formData.pregnancy_remarks} onChange={handleInputChange} />
                                        </Grid>
                                    </Grid>
                                </>
                            )}

                            {/* Address Section */}
                            <div className="section-title-bar" style={{ marginTop: 24 }}>
                                Address Details
                                <Button size="small" sx={{ float: 'right' }}>Auto fill from House Group</Button>
                            </div>
                            <Grid container spacing={2}>
                                <Grid item xs={12}>
                                    <TextField fullWidth label="Address Line 1" name="address_line1" value={formData.address_line1} onChange={handleInputChange} placeholder="H.No, Street" />
                                </Grid>
                                <Grid item xs={12}>
                                    <TextField fullWidth label="Address Line 2" name="address_line2" value={formData.address_line2} onChange={handleInputChange} placeholder="Landmark etc." />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="City" name="city" value={formData.city} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="State" name="state" value={formData.state} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Pincode" name="pincode" value={formData.pincode} onChange={handleInputChange} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <TextField fullWidth label="Country" name="country" value={formData.country} onChange={handleInputChange} disabled />
                                </Grid>
                            </Grid>

                            {/* Organization Toggle */}
                            <Box sx={{ mt: 3, mb: 10 }}>
                                <Button
                                    variant={formData.organization_type === 'organization' ? 'contained' : 'outlined'}
                                    color="success"
                                    onClick={() => setFormData({ ...formData, organization_type: 'organization' })}
                                    sx={{ mr: 2, width: 200 }}
                                >
                                    Add or Edit Organization
                                </Button>
                                <Button
                                    variant={formData.organization_type === 'individual' ? 'contained' : 'outlined'}
                                    onClick={() => setFormData({ ...formData, organization_type: 'individual' })}
                                    sx={{ width: 200 }}
                                >
                                    Individual
                                </Button>
                            </Box>
                        </Grid>
                    </Grid>
                </Container>

                {/* Sticky Action Footer */}
                <Box className="action-buttons-container">
                    <Container maxWidth="lg" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Button variant="contained" color="primary" startIcon={<BlockIcon />}>
                            Deactivate Account
                        </Button>
                        <Box>
                            <Button variant="outlined" color="error" startIcon={<DeleteIcon />} sx={{ mr: 2 }}>
                                Delete Account
                            </Button>
                            <Tooltip title={!phoneVerified || !emailVerified ? 'Please verify phone and email before saving' : ''}>
                                <span>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        startIcon={<SaveIcon />}
                                        onClick={handleSaveProfile}
                                        disabled={profileLoading || !phoneVerified || !emailVerified}
                                    >
                                        {profileLoading ? 'Saving...' : 'Save & Update'}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Box>
                    </Container>
                </Box>

                {/* Add Member Dialog */}
                <Dialog open={memberDialogOpen} onClose={() => setMemberDialogOpen(false)} maxWidth="sm" fullWidth>
                    <DialogTitle>{editingMember ? 'Edit Family Member' : 'Add Family Member'}</DialogTitle>
                    <DialogContent dividers>
                        <Grid container spacing={2}>
                            <Grid item xs={12}>
                                <FormControl fullWidth>
                                    <InputLabel>Relation</InputLabel>
                                    <Select
                                        value={memberForm.relation}
                                        label="Relation"
                                        onChange={(e) => setMemberForm({ ...memberForm, relation: e.target.value })}
                                    >
                                        <MenuItem value="Spouse">Spouse</MenuItem>
                                        <MenuItem value="Child">Child</MenuItem>
                                        <MenuItem value="Parent">Parent</MenuItem>
                                        <MenuItem value="Sibling">Sibling</MenuItem>
                                        <MenuItem value="Other">Other</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={6}>
                                <TextField fullWidth label="First Name" value={memberForm.first_name} onChange={(e) => setMemberForm({ ...memberForm, first_name: e.target.value })} />
                            </Grid>
                            <Grid item xs={6}>
                                <TextField fullWidth label="Last Name" value={memberForm.last_name} onChange={(e) => setMemberForm({ ...memberForm, last_name: e.target.value })} />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField fullWidth label="Phone Number" value={memberForm.phone_number} onChange={(e) => setMemberForm({ ...memberForm, phone_number: e.target.value })} />
                            </Grid>
                            <Grid item xs={6}>
                                <FormControl fullWidth>
                                    <InputLabel>Gender</InputLabel>
                                    <Select value={memberForm.gender} label="Gender" onChange={(e) => setMemberForm({ ...memberForm, gender: e.target.value })}>
                                        <MenuItem value="male">Male</MenuItem>
                                        <MenuItem value="female">Female</MenuItem>
                                        <MenuItem value="other">Other</MenuItem>
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid item xs={6}>
                                <DatePicker
                                    label="Date of Birth"
                                    value={memberForm.dob}
                                    onChange={(date) => setMemberForm({ ...memberForm, dob: date })}
                                    renderInput={(params) => <TextField {...params} fullWidth />}
                                />
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions>
                        {editingMember && (
                            <Button color="error" onClick={() => {
                                dispatch(deleteHouseGroupMember(editingMember.id));
                                setMemberDialogOpen(false);
                            }}>Delete</Button>
                        )}
                        <Button onClick={() => setMemberDialogOpen(false)}>Cancel</Button>
                        <Button variant="contained" onClick={handleMemberSubmit} disabled={houseGroupActionLoading}>
                            {houseGroupActionLoading ? 'Saving...' : 'Save'}
                        </Button>
                    </DialogActions>
                </Dialog>

                {/* OTP Verification Dialog */}
                <Dialog open={otpDialogOpen} onClose={() => setOtpDialogOpen(false)} maxWidth="xs" fullWidth>
                    <DialogTitle>
                        Verify {otpPurpose === 'phone_change' ? 'Phone Number' : 'Email'}
                    </DialogTitle>
                    <DialogContent>
                        {otpError && <Alert severity="error" sx={{ mb: 2 }}>{otpError}</Alert>}
                        <TextField
                            fullWidth
                            label={otpPurpose === 'phone_change' ? 'Phone Number' : 'Email'}
                            value={otpIdentifier}
                            onChange={(e) => setOtpIdentifier(e.target.value)}
                            sx={{ mb: 2 }}
                            disabled={otpSent}
                        />
                        {otpSent && (
                            <TextField
                                fullWidth
                                label="Enter OTP"
                                value={otpValue}
                                onChange={(e) => setOtpValue(e.target.value)}
                                placeholder="Enter 6-digit OTP"
                                sx={{ mb: 2 }}
                            />
                        )}
                        <Typography variant="caption" color="text.secondary">
                            {otpSent
                                ? 'OTP sent! Check the backend terminal for the OTP (testing mode).'
                                : 'Click Send OTP to receive verification code.'}
                        </Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setOtpDialogOpen(false)}>Cancel</Button>
                        {!otpSent ? (
                            <Button variant="contained" onClick={handleSendOtp} disabled={otpLoading}>
                                {otpLoading ? 'Sending...' : 'Send OTP'}
                            </Button>
                        ) : (
                            <Button variant="contained" onClick={handleVerifyOtp} disabled={otpLoading || !otpValue}>
                                {otpLoading ? 'Verifying...' : 'Verify & Update'}
                            </Button>
                        )}
                    </DialogActions>
                </Dialog>

                {/* Success/Error Snackbar */}
                <Snackbar
                    open={snackbar.open}
                    autoHideDuration={4000}
                    onClose={() => setSnackbar({ ...snackbar, open: false })}
                    anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
                >
                    <Alert
                        onClose={() => setSnackbar({ ...snackbar, open: false })}
                        severity={snackbar.severity}
                        sx={{ width: '100%' }}
                    >
                        {snackbar.message}
                    </Alert>
                </Snackbar>
            </Box>
        </LocalizationProvider>
    );
};

export default ProfileSetting;
