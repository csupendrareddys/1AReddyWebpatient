/**
 * profileSettingUiSlice — UI state for the ProfileSetting sub-feature
 * Form state, member dialog, OTP verification, snackbar
 */
import { createSlice } from '@reduxjs/toolkit';

const INITIAL_FORM_DATA = {
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
    organization_type: 'individual',
    // Female specifics
    lmp_date: null, lmp_remarks: '',
    pregnancy_status: '', pregnancy_remarks: '',
    // Emergency
    emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
    // Insurance
    insurance_provider: '', insurance_policy_number: '',
    // Languages
    languages_known: [],
};

const INITIAL_MEMBER_FORM = {
    relation: 'Spouse', first_name: '', last_name: '',
    gender: '', dob: null, blood_group: '', phone_number: '',
};

const initialState = {
    // Form data
    formData: INITIAL_FORM_DATA,

    // Member dialog
    memberDialogOpen: false,
    editingMember: null,
    memberForm: INITIAL_MEMBER_FORM,

    // OTP dialog
    otpDialogOpen: false,
    otpPurpose: '',
    otpIdentifier: '',
    otpValue: '',
    otpSent: false,
    otpLoading: false,
    otpError: '',

    // Verification tracking
    originalPhone: '',
    originalEmail: '',
    phoneVerified: true,
    emailVerified: true,

    // Snackbar
    snackbar: { open: false, message: '', severity: 'success' },
};

const profileSettingUiSlice = createSlice({
    name: 'profileSettingUi',
    initialState,
    reducers: {
        // Form
        setFormData: (state, action) => {
            state.formData = { ...state.formData, ...action.payload };
        },
        setFormField: (state, action) => {
            const { name, value } = action.payload;
            state.formData[name] = value;
            // Track phone/email changes
            if (name === 'phone_number') {
                state.phoneVerified = value === state.originalPhone;
            } else if (name === 'email') {
                state.emailVerified = value === state.originalEmail;
            }
        },
        populateFormFromProfile: (state, action) => {
            const data = action.payload;
            state.originalPhone = data.phone_number || '';
            state.originalEmail = data.email || '';
            state.phoneVerified = true;
            state.emailVerified = true;
            state.formData = {
                ...state.formData,
                first_name: data.first_name || '',
                middle_name: data.middle_name || '',
                last_name: data.last_name || '',
                phone_number: data.phone_number || '',
                email: data.email || '',
                gender: data.gender || '',
                dob: data.dob || null,
                blood_group: data.blood_group || '',
                caste: data.caste || '',
                religion: data.religion || '',
                citizenship: data.citizenship || '',
                pan_number: data.pan_number || '',
                aadhar_number: data.aadhar_number || '',
                alternative_phone: data.alternative_phone || '',
                alternative_email: data.alternative_email || '',
                emergency_contact_name: data.emergency_contact_name || '',
                emergency_contact_phone: data.emergency_contact_phone || '',
                emergency_contact_relation: data.emergency_contact_relation || '',
                insurance_provider: data.insurance_provider || '',
                insurance_policy_number: data.insurance_policy_number || '',
                languages_known: data.languages_known || [],
                ...(data.female_health_details || {}),
            };
        },

        // Member dialog
        openAddMemberDialog: (state) => {
            state.editingMember = null;
            state.memberForm = INITIAL_MEMBER_FORM;
            state.memberDialogOpen = true;
        },
        openEditMemberDialog: (state, action) => {
            const member = action.payload;
            state.editingMember = member;
            state.memberForm = {
                relation: member.relation,
                first_name: member.first_name,
                last_name: member.last_name,
                gender: member.gender || '',
                dob: member.dob || null,
                blood_group: member.blood_group || '',
                phone_number: member.phone_number || '',
            };
            state.memberDialogOpen = true;
        },
        closeMemberDialog: (state) => {
            state.memberDialogOpen = false;
            state.editingMember = null;
            state.memberForm = INITIAL_MEMBER_FORM;
        },
        setMemberFormField: (state, action) => {
            const { name, value } = action.payload;
            state.memberForm[name] = value;
        },

        // OTP dialog
        openOtpDialog: (state, action) => {
            const purpose = action.payload;
            state.otpPurpose = purpose;
            state.otpIdentifier = purpose === 'phone_change'
                ? state.formData.phone_number
                : state.formData.email;
            state.otpValue = '';
            state.otpSent = false;
            state.otpError = '';
            state.otpDialogOpen = true;
        },
        closeOtpDialog: (state) => {
            state.otpDialogOpen = false;
        },
        setOtpIdentifier: (state, action) => {
            state.otpIdentifier = action.payload;
        },
        setOtpValue: (state, action) => {
            state.otpValue = action.payload;
        },
        setOtpSent: (state, action) => {
            state.otpSent = action.payload;
        },
        setOtpLoading: (state, action) => {
            state.otpLoading = action.payload;
        },
        setOtpError: (state, action) => {
            state.otpError = action.payload;
        },
        markPhoneVerified: (state, action) => {
            state.formData.phone_number = action.payload;
            state.originalPhone = action.payload;
            state.phoneVerified = true;
            state.otpDialogOpen = false;
        },
        markEmailVerified: (state, action) => {
            state.formData.email = action.payload;
            state.originalEmail = action.payload;
            state.emailVerified = true;
            state.otpDialogOpen = false;
        },

        // Snackbar
        setSnackbar: (state, action) => {
            state.snackbar = action.payload;
        },
        clearSnackbar: (state) => {
            state.snackbar = { ...state.snackbar, open: false };
        },
    },
});

export const {
    setFormData,
    setFormField,
    populateFormFromProfile,
    openAddMemberDialog,
    openEditMemberDialog,
    closeMemberDialog,
    setMemberFormField,
    openOtpDialog,
    closeOtpDialog,
    setOtpIdentifier,
    setOtpValue,
    setOtpSent,
    setOtpLoading,
    setOtpError,
    markPhoneVerified,
    markEmailVerified,
    setSnackbar,
    clearSnackbar,
} = profileSettingUiSlice.actions;

export default profileSettingUiSlice.reducer;
