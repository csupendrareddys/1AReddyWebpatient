/**
 * useProfileSetting — Custom hook for the ProfileSetting page
 * Combines patientSlice thunks (profile/house-group CRUD) + profileSettingUiSlice
 */
import { useEffect, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { usePatientScope } from '../context/PatientScopeContext';
import { toLocalDateString } from '../../../../common/utils/date';
import {
    fetchPatientProfile,
    updateProfile,
    fetchHouseGroup,
    addHouseGroupMember,
    updateHouseGroupMember,
    deleteHouseGroupMember,
    sendOtp,
    verifyAndUpdateContact,
} from '../../redux/patientSlice';

import {
    setFormField,
    setFormData,
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
} from '../redux/profileSettingUiSlice';

/**
 * @param {Object} [opts]
 * @param {boolean} [opts.skipFetch=false] Don't load the logged-in patient's
 *   own profile / house group on mount. Set when the page is rendered by a
 *   super-admin in Operations: those thunks hit ``/api/v1/patient/*`` as the
 *   admin, which 403s and paints a spurious error banner. The section
 *   components fetch the target patient's data through the scoped hooks
 *   instead; the rest of this hook (OTP dialog, snackbar) still applies.
 */
const useProfileSetting = ({ skipFetch = false } = {}) => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    // In a minor sub-profile (family scope) the OTP send/verify must ride the
    // act-on-behalf proxy so the guardian verifies the number in their own
    // session and it lands on the MINOR. Null for a patient's own profile.
    const { patientId: otpScope } = usePatientScope();

    // From patientSlice (server state)
    const {
        profile, profileLoading, houseGroup, houseGroupLoading,
        houseGroupActionLoading, profileError, houseGroupError,
    } = useSelector((state) => state.patient);

    // From profileSettingUiSlice (UI state)
    const ui = useSelector((state) => state.profileSettingUi);
    const {
        formData, memberDialogOpen, editingMember, memberForm,
        otpDialogOpen, otpPurpose, otpIdentifier, otpValue,
        otpSent, otpLoading, otpError,
        originalPhone, originalEmail, phoneVerified, emailVerified,
        snackbar,
    } = ui;

    // ─── Load initial data ─────────────────────────
    useEffect(() => {
        if (skipFetch) return;
        dispatch(fetchPatientProfile()).unwrap().then((data) => {
            if (data) {
                dispatch(populateFormFromProfile(data));
            }
        }).catch(err => {
            console.error('Failed to load profile:', err);
        });
        dispatch(fetchHouseGroup());
    }, [dispatch, skipFetch]);

    // ─── Form handlers ─────────────────────────────
    const handleInputChange = useCallback((e) => {
        const { name, value } = e.target;
        dispatch(setFormField({ name, value }));
    }, [dispatch]);

    const handleDateChange = useCallback((name, date) => {
        dispatch(setFormField({ name, value: date }));
    }, [dispatch]);

    const handleGenderSelect = useCallback((gender) => {
        dispatch(setFormField({ name: 'gender', value: gender }));
    }, [dispatch]);

    const handleOrgTypeChange = useCallback((type) => {
        dispatch(setFormField({ name: 'organization_type', value: type }));
    }, [dispatch]);

    // ─── Save profile ──────────────────────────────
    const handleSaveProfile = useCallback(async () => {
        const payload = { ...formData };
        if (payload.dob) payload.dob = toLocalDateString(payload.dob);
        if (payload.lmp_date) {
            payload.female_health_details = {
                ...payload.female_health_details,
                lmp_date: toLocalDateString(payload.lmp_date),
                lmp_remarks: payload.lmp_remarks,
                pregnancy_status: payload.pregnancy_status,
                pregnancy_remarks: payload.pregnancy_remarks,
            };
        }
        try {
            await dispatch(updateProfile(payload)).unwrap();
            dispatch(setSnackbar({ open: true, message: 'Profile saved successfully!', severity: 'success' }));
        } catch (err) {
            dispatch(setSnackbar({ open: true, message: err.message || 'Failed to save profile', severity: 'error' }));
        }
    }, [dispatch, formData]);

    // ─── House group ────────────────────────────────
    const handleOpenAddMember = useCallback(() => {
        dispatch(openAddMemberDialog());
    }, [dispatch]);

    const handleOpenEditMember = useCallback((member) => {
        dispatch(openEditMemberDialog(member));
    }, [dispatch]);

    const handleCloseMemberDialog = useCallback(() => {
        dispatch(closeMemberDialog());
    }, [dispatch]);

    const handleMemberFormChange = useCallback((name, value) => {
        dispatch(setMemberFormField({ name, value }));
    }, [dispatch]);

    const handleMemberSubmit = useCallback(async () => {
        const payload = { ...memberForm };
        if (payload.dob) payload.dob = toLocalDateString(payload.dob);

        if (editingMember) {
            await dispatch(updateHouseGroupMember({ memberId: editingMember.id, data: payload }));
        } else {
            await dispatch(addHouseGroupMember(payload));
        }
        dispatch(closeMemberDialog());
    }, [dispatch, memberForm, editingMember]);

    const handleDeleteMember = useCallback(async () => {
        if (editingMember) {
            await dispatch(deleteHouseGroupMember(editingMember.id));
            dispatch(closeMemberDialog());
        }
    }, [dispatch, editingMember]);

    // ─── OTP verification ──────────────────────────
    const handleOpenOtpDialog = useCallback((purpose) => {
        dispatch(openOtpDialog(purpose));
    }, [dispatch]);

    const handleCloseOtpDialog = useCallback(() => {
        dispatch(closeOtpDialog());
    }, [dispatch]);

    const handleSendOtp = useCallback(async () => {
        dispatch(setOtpLoading(true));
        dispatch(setOtpError(''));
        try {
            await dispatch(sendOtp({ identifier: otpIdentifier, purpose: otpPurpose, scope: otpScope })).unwrap();
            dispatch(setOtpSent(true));
        } catch (err) {
            dispatch(setOtpError(err.message || 'Failed to send OTP'));
        }
        dispatch(setOtpLoading(false));
    }, [dispatch, otpIdentifier, otpPurpose, otpScope]);

    const handleVerifyOtp = useCallback(async () => {
        dispatch(setOtpLoading(true));
        dispatch(setOtpError(''));
        try {
            await dispatch(verifyAndUpdateContact({
                identifier: otpIdentifier,
                otp: otpValue,
                purpose: otpPurpose,
                scope: otpScope,
            })).unwrap();

            if (otpPurpose === 'phone_change') {
                dispatch(markPhoneVerified(otpIdentifier));
            } else {
                dispatch(markEmailVerified(otpIdentifier));
            }
        } catch (err) {
            dispatch(setOtpError(err.message || 'Invalid OTP'));
        }
        dispatch(setOtpLoading(false));
    }, [dispatch, otpIdentifier, otpValue, otpPurpose, otpScope]);

    // ─── Navigation ────────────────────────────────
    const handleGoBack = useCallback(() => {
        navigate(-1);
    }, [navigate]);

    // Stable identity — callers list it in useCallback deps.
    const notify = useCallback((message, severity = 'success') => {
        dispatch(setSnackbar({ open: true, message, severity }));
    }, [dispatch]);

    return {
        // Profile data (from patientSlice)
        profile, profileLoading, profileError,
        houseGroup, houseGroupLoading, houseGroupActionLoading, houseGroupError,

        // Form
        formData,
        handleInputChange,
        handleDateChange,
        handleGenderSelect,
        handleOrgTypeChange,
        handleSaveProfile,
        phoneVerified,
        emailVerified,

        // Member dialog
        memberDialogOpen,
        editingMember,
        memberForm,
        handleOpenAddMember,
        handleOpenEditMember,
        handleCloseMemberDialog,
        handleMemberFormChange,
        handleMemberSubmit,
        handleDeleteMember,

        // OTP dialog
        otpDialogOpen,
        otpPurpose,
        otpIdentifier,
        otpValue,
        otpSent,
        otpLoading,
        otpError,
        handleOpenOtpDialog,
        handleCloseOtpDialog,
        handleSendOtp,
        handleVerifyOtp,
        setOtpIdentifier: (val) => dispatch(setOtpIdentifier(val)),
        setOtpValue: (val) => dispatch(setOtpValue(val)),

        // Snackbar
        snackbar,
        notify,
        handleCloseSnackbar: () => dispatch(clearSnackbar()),

        // Navigation
        handleGoBack,
    };
};

export default useProfileSetting;
