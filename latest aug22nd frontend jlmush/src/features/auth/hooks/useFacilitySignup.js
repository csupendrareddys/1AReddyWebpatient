/**
 * useFacilitySignup — shared hook for clinic + hospital marketplace signup.
 *
 * Both flows have the same form shape (personal info + facility
 * address + two file uploads + OTPs). The only delta is whether a
 * ``hospital_type`` field is collected. Keeping the form-state +
 * validation here keeps the two page components thin.
 *
 * Mirrors the Round 2 ``useDoctorSignup`` pattern:
 *   * reads ``?plan=`` from the URL and persists it through the
 *     OTP-verify intermediate step,
 *   * stores form data + File objects in Redux via ``storePreSignupData``
 *     (serializableCheck disabled at the store level for this slice),
 *   * navigates to ``/auth/signup/verify-phone`` after handleSubmit;
 *     the final multipart POST happens in
 *     ``submitSignup.js:submitSignupWithTokens`` once both OTPs are
 *     verified.
 *
 * ``signupType`` is the routing discriminator picked up by
 * ``submitSignup.js``. Accepts ``'clinic'`` or ``'hospital'``.
 */
import { useCallback, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { storePreSignupData } from '../redux/authSlice';


const PHONE_RE = /^[6-9]\d{9}$/;
const PINCODE_RE = /^\d{6}$/;


function _validate(formData, files, { includeHospitalType }) {
    const errors = {};

    // Personal
    if (!formData.first_name?.trim()) errors.first_name = 'First name required';
    if (!formData.email?.trim()) errors.email = 'Email required';
    if (!formData.phone_number || !PHONE_RE.test(formData.phone_number)) {
        errors.phone_number = 'Enter a valid 10-digit phone';
    }
    if (!formData.password || formData.password.length < 8) {
        errors.password = 'Password must be at least 8 characters';
    }
    if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
    }

    // Facility
    if (!formData.name?.trim()) errors.name = 'Facility name required';
    if (!formData.address?.trim()) errors.address = 'Address required';
    if (!formData.city?.trim()) errors.city = 'City required';
    if (!formData.state?.trim()) errors.state = 'State required';
    if (!formData.pincode || !PINCODE_RE.test(formData.pincode)) {
        errors.pincode = 'Enter a valid 6-digit pincode';
    }
    if (includeHospitalType && !formData.hospital_type?.trim()) {
        errors.hospital_type = 'Hospital type required';
    }

    // Files (both required — per the user's signup-docs choice).
    if (!files.registration_certificate) {
        errors.registration_certificate = 'Registration certificate required';
    }
    if (!files.admin_aadhaar_attachment) {
        errors.admin_aadhaar_attachment = "Admin's Aadhaar attachment required";
    }

    return errors;
}


export default function useFacilitySignup({ signupType }) {
    if (signupType !== 'clinic' && signupType !== 'hospital') {
        // Defensive — only these two values produce a working final
        // POST in submitSignup.js. Catches a typo at the page level.
        throw new Error(
            `useFacilitySignup: unsupported signupType "${signupType}"`,
        );
    }
    const includeHospitalType = signupType === 'hospital';

    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const planCode = (searchParams.get('plan') || '').trim() || null;

    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        email: '',
        phone_number: '',
        password: '',
        confirmPassword: '',
        // Facility-level
        name: '',
        registration_number: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        phone: '',
        website: '',
        ...(includeHospitalType ? { hospital_type: '' } : {}),
        // Legal-entity core (corporate facilities). entity_type === 'individual'
        // means no entity details persisted. Docs/logos/personnel come later.
        entity: {
            entity_type: 'individual',
            entity_name: '',
            legal_name: '',
            trade_name: '',
            promoters: '',
            year_of_establishment: '',
            registration_license_number: '',
            cin_number: '',
            gst_number: '',
            pan_number: '',
        },
    });

    const [files, setFiles] = useState({
        registration_certificate: null,
        admin_aadhaar_attachment: null,
    });

    const [validationErrors, setValidationErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (validationErrors[name]) {
            setValidationErrors((prev) => ({ ...prev, [name]: '' }));
        }
    }, [validationErrors]);

    const handleFileChange = useCallback((e) => {
        const { name, files: fileList } = e.target;
        setFiles((prev) => ({ ...prev, [name]: fileList[0] || null }));
        if (validationErrors[name]) {
            setValidationErrors((prev) => ({ ...prev, [name]: '' }));
        }
    }, [validationErrors]);

    const handleEntityChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, entity: { ...prev.entity, [name]: value } }));
    }, []);

    const toggleShowPassword = useCallback(
        () => setShowPassword((p) => !p), [],
    );
    const toggleShowConfirmPassword = useCallback(
        () => setShowConfirmPassword((p) => !p), [],
    );

    const validate = useCallback(() => {
        const errs = _validate(formData, files, { includeHospitalType });
        setValidationErrors(errs);
        return Object.keys(errs).length === 0;
    }, [formData, files, includeHospitalType]);

    const handleSubmit = useCallback((e) => {
        e?.preventDefault?.();
        if (!validate()) return;
        dispatch(storePreSignupData({
            formData: {
                ...formData,
                role: signupType,            // 'clinic' or 'hospital'
                files,
                plan_code: planCode,
            },
            signupType,
        }));
        // Phone OTP first — same intermediate route doctor uses; the
        // pre-signup pages route by signupType to pick the right
        // final POST in submitSignup.js.
        navigate('/auth/signup/verify-phone');
    }, [
        formData, files, signupType, planCode,
        validate, dispatch, navigate,
    ]);

    // Memo so re-renders don't recreate the return shape unnecessarily.
    return useMemo(() => ({
        formData, files, validationErrors, planCode,
        showPassword, showConfirmPassword,
        handleChange, handleFileChange, handleEntityChange,
        toggleShowPassword, toggleShowConfirmPassword,
        handleSubmit,
    }), [
        formData, files, validationErrors, planCode,
        showPassword, showConfirmPassword,
        handleChange, handleFileChange,
        toggleShowPassword, toggleShowConfirmPassword,
        handleSubmit,
    ]);
}
