import { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clearError, storePreSignupData, signup, clearSignupSuccess } from '../redux/authSlice';
import { validatePatientSignup } from '../utils/validation';

/**
 * Custom hook for patient signup logic
 * Handles form state, validation, submission, and navigation
 */
const usePatientSignup = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { error, isLoading } = useSelector((state) => state.auth);

    // A "Book Now" deep-link carried in via ?redirect= — preserved through
    // the multi-step signup so the final hop to the login page keeps it,
    // and the (already redirect-aware) login lands the new patient on the
    // product instead of the dashboard. Same-origin absolute paths only.
    const redirectParam = searchParams.get('redirect');
    const safeRedirect = redirectParam
        && redirectParam.startsWith('/') && !redirectParam.startsWith('//')
        ? redirectParam : null;

    // Form state
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        email: '',
        state: '',
        phone_number: '',
        referral_code: '',
        password: '',
        confirmPassword: '',
        // Optional marketplace (receiver) membership plan chosen at signup.
        plan_code: '',
        // Corporate/entity sub-form. entity_type === 'individual' means a
        // plain individual patient (no entity details persisted).
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

    // UI state
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [validationErrors, setValidationErrors] = useState({});

    // Handle form field changes
    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));

        // Clear specific validation error
        if (validationErrors[name]) {
            setValidationErrors((prev) => ({ ...prev, [name]: '' }));
        }
        if (error) {
            dispatch(clearError());
        }
    }, [validationErrors, error, dispatch]);

    // Entity sub-form field changes (merged into formData.entity).
    const handleEntityChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, entity: { ...prev.entity, [name]: value } }));
    }, []);

    // Toggle password visibility
    const toggleShowPassword = useCallback(() => {
        setShowPassword((prev) => !prev);
    }, []);

    const toggleShowConfirmPassword = useCallback(() => {
        setShowConfirmPassword((prev) => !prev);
    }, []);

    // Validate form
    const validate = useCallback(() => {
        const errors = validatePatientSignup(formData);
        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData]);

    // Handle form submission — if email provided, go to email OTP; otherwise signup directly
    const handleSubmit = useCallback(async (e) => {
        e.preventDefault();

        if (!validate()) return;

        const formPayload = {
            first_name: formData.first_name,
            last_name: formData.last_name || undefined,
            email: formData.email || undefined,
            state: formData.state,
            phone_number: formData.phone_number,
            referral_code: formData.referral_code || undefined,
            password: formData.password,
            plan_code: formData.plan_code || undefined,
            role: 'patient',
        };

        // Corporate patient → attach the core entity details. The entity
        // type is the discriminator: 'individual' means no entity payload.
        const ent = formData.entity || {};
        if (ent.entity_type && ent.entity_type !== 'individual') {
            formPayload.account_type = 'corporate';
            formPayload.entity = {
                entity_type: ent.entity_type,
                entity_name: ent.entity_name || undefined,
                legal_name: ent.legal_name || undefined,
                trade_name: ent.trade_name || undefined,
                promoters: ent.promoters
                    ? ent.promoters.split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined,
                year_of_establishment: ent.year_of_establishment
                    ? Number(ent.year_of_establishment) : undefined,
                registration_license_number: ent.registration_license_number || undefined,
                cin_number: ent.cin_number || undefined,
                gst_number: ent.gst_number || undefined,
                pan_number: ent.pan_number || undefined,
            };
        }

        // Remove undefined fields
        Object.keys(formPayload).forEach(key => {
            if (formPayload[key] === undefined) {
                delete formPayload[key];
            }
        });

        // Phone OTP is the only pre-signup verification (Combirds SMS).
        // Email is collected for contact only and skips verification.
        dispatch(storePreSignupData({
            formData: formPayload, signupType: 'patient', redirect: safeRedirect,
        }));
        navigate('/auth/signup/verify-phone');
    }, [formData, validate, dispatch, navigate, safeRedirect]);

    return {
        // Form state
        formData,
        validationErrors,

        // UI state
        showPassword,
        showConfirmPassword,

        // Redux state
        error,
        isLoading,

        // Handlers
        handleChange,
        handleEntityChange,
        handleSubmit,
        toggleShowPassword,
        toggleShowConfirmPassword,
    };
};

export default usePatientSignup;
