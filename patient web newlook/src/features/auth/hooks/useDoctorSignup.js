import { useState, useCallback } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { storePreSignupData } from '../redux/authSlice';
import { validateDoctorSignup } from '../utils/validation';

/**
 * Custom hook for doctor signup logic
 * Handles form state, file uploads, qualifications, validation, and submission
 */
const useDoctorSignup = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Round 2 — marketplace plan selected on the apex pricing card.
    // Optional (back-compat with the pre-marketplace signup link). The
    // banner in DoctorSignupPage fetches the plan's name via this code;
    // ``submitSignup.js`` includes it in the multipart POST.
    const planCode = (searchParams.get('plan') || '').trim() || null;

    // Round 5 — in-tenant provider-plan id. Only relevant when the
    // signup is happening inside a non-apex tenant subdomain that has
    // authored ≥1 active doctor plan. The page sets this via
    // ``setTenantProviderPlanId``; the submit handler threads it
    // through Redux into the multipart POST.
    const [tenantProviderPlanId, setTenantProviderPlanId] = useState('');

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    // Form data state
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        email: '',
        phone_number: '',
        password: '',
        confirmPassword: '',
        referral_code: '',
        state: '',
        registration_number: '',
        aadhar_number: '',
    });

    // File uploads state
    const [files, setFiles] = useState({
        registration_certificate: null,
        aadhar_attachment: null,
    });

    // Dynamic qualifications array. Each row now also carries a
    // qualification_level ('ug' | 'pg' | 'super_speciality') plus the
    // ids of the selected degree / specialization / college, so the
    // backend can map the entry to the admin-managed master lists.
    // ``degree_name`` and ``institution`` are kept as denormalised
    // human-readable copies so existing validation + downstream
    // consumers continue to work.
    const [qualifications, setQualifications] = useState([
        {
            qualification_level: 'ug',
            degree_id: '',
            degree_name: '',
            specialization_id: '',
            specialization_name: '',
            college_id: '',
            institution: '',
            year_of_passing: '',
            certificate: null,
        },
    ]);

    // UI state
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [validationErrors, setValidationErrors] = useState({});

    // Handle text field changes
    const handleChange = useCallback((e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));

        // Clear specific validation error
        if (validationErrors[name]) {
            setValidationErrors((prev) => ({ ...prev, [name]: '' }));
        }
        if (error) {
            setError(null);
        }
    }, [validationErrors, error]);

    // Handle file uploads
    const handleFileChange = useCallback((e) => {
        const { name, files: fileList } = e.target;
        const file = fileList[0] || null;

        setFiles((prev) => ({ ...prev, [name]: file }));

        // Clear validation error
        if (validationErrors[name]) {
            setValidationErrors((prev) => ({ ...prev, [name]: '' }));
        }
    }, [validationErrors]);

    // Handle qualification field changes
    const handleQualificationChange = useCallback((index, field, value) => {
        setQualifications((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });

        // Clear qualification errors
        if (validationErrors.qualifications) {
            setValidationErrors((prev) => ({ ...prev, qualifications: null }));
        }
    }, [validationErrors]);

    // Handle qualification file change
    const handleQualificationFileChange = useCallback((index, file) => {
        setQualifications((prev) => {
            const updated = [...prev];
            updated[index] = { ...updated[index], certificate: file };
            return updated;
        });

        if (validationErrors.qualifications) {
            setValidationErrors((prev) => ({ ...prev, qualifications: null }));
        }
    }, [validationErrors]);

    // Add new qualification row
    const addQualification = useCallback(() => {
        setQualifications((prev) => [
            ...prev,
            {
                qualification_level: 'ug',
                degree_id: '',
                degree_name: '',
                specialization_id: '',
                specialization_name: '',
                college_id: '',
                institution: '',
                year_of_passing: '',
                certificate: null,
            },
        ]);
    }, []);

    // Remove qualification row
    const removeQualification = useCallback((index) => {
        if (qualifications.length > 1) {
            setQualifications((prev) => prev.filter((_, i) => i !== index));
        }
    }, [qualifications.length]);

    // Toggle password visibility
    const toggleShowPassword = useCallback(() => {
        setShowPassword((prev) => !prev);
    }, []);

    const toggleShowConfirmPassword = useCallback(() => {
        setShowConfirmPassword((prev) => !prev);
    }, []);

    // Validate form
    const validate = useCallback(() => {
        const errors = validateDoctorSignup(formData, files, qualifications);
        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    }, [formData, files, qualifications]);

    // Handle form submission — store form data + files in Redux and navigate to email OTP verification
    const handleSubmit = useCallback((e) => {
        e.preventDefault();

        if (!validate()) return;

        // Store all form data (including File objects) in Redux.
        // serializableCheck is disabled in store.js so File objects are safe.
        dispatch(storePreSignupData({
            formData: {
                ...formData,
                aadhar_number: formData.aadhar_number.replace(/\s/g, ''),
                role: 'doctor',
                // Persist plan_code through the OTP intermediate step
                // so the final multipart POST in submitSignup.js can
                // include it. Null when no ?plan= was on the URL.
                plan_code: planCode,
                // Round 5 — in-tenant provider-plan id. Falsy on apex
                // (the marketplace flow uses ``plan_code`` above);
                // truthy on tenant subdomains when the signup form's
                // plan picker had at least one selection. The backend
                // branches on tenant kind so only one of the two will
                // be honored on the actual write.
                tenant_provider_plan_id: tenantProviderPlanId || null,
                files,
                qualifications,
            },
            signupType: 'doctor',
        }));
        // Phone OTP via Combirds SMS is the only pre-signup verification.
        navigate('/auth/signup/verify-phone');
    }, [formData, files, qualifications, validate, dispatch, navigate,
        planCode, tenantProviderPlanId]);

    return {
        // Form state
        formData,
        files,
        qualifications,
        validationErrors,

        // Selected marketplace plan (from ?plan= on the URL). null when
        // the user landed on the signup page without picking a tier.
        planCode,
        // In-tenant plan picker plumbing. ``setTenantProviderPlanId`` is
        // wired to the dropdown rendered by DoctorSignupPage when running
        // inside a tenant subdomain whose admin has authored doctor plans.
        tenantProviderPlanId,
        setTenantProviderPlanId,

        // UI state
        showPassword,
        showConfirmPassword,

        // Loading/error state
        isLoading,
        error,

        // Handlers
        handleChange,
        handleFileChange,
        handleQualificationChange,
        handleQualificationFileChange,
        addQualification,
        removeQualification,
        handleSubmit,
        toggleShowPassword,
        toggleShowConfirmPassword,
    };
};

export default useDoctorSignup;
