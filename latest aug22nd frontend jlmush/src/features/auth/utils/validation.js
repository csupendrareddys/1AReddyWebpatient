// Password validation
export const validatePassword = (password) => {
    const errors = [];

    if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }

    return errors;
};

// Email validation
export const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

// Phone validation (Indian 10-digit)
export const validatePhone = (phone) => {
    const phoneRegex = /^[6-9]\d{9}$/;
    return phoneRegex.test(phone);
};

// Calculate password strength (0-4)
export const getPasswordStrength = (password) => {
    let strength = 0;

    if (password.length >= 8) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[0-9]/.test(password)) strength++;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) strength++;

    return Math.min(strength, 4);
};

// Get password strength label
export const getPasswordStrengthLabel = (strength) => {
    const labels = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong'];
    return labels[strength] || 'Very Weak';
};

// Get password strength color
export const getPasswordStrengthColor = (strength) => {
    const colors = ['#f44336', '#ff9800', '#ffeb3b', '#8bc34a', '#4caf50'];
    return colors[strength] || '#f44336';
};

// Indian states list
export const INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
    'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir',
    'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra',
    'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
    'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
    'Uttar Pradesh', 'Uttarakhand', 'West Bengal'
];

// Name validation (letters and spaces only)
export const validateName = (name, fieldName = 'Name') => {
    if (!name || !name.trim()) {
        return `${fieldName} is required`;
    }
    if (!/^[a-zA-Z\s]+$/.test(name)) {
        return `${fieldName} can only contain letters and spaces`;
    }
    if (name.length < 5) {
        return `${fieldName} must be at least 5 characters`;
    }
    if (name.length > 50) {
        return `${fieldName} must not exceed 50 characters`;
    }
    return null;
};

// State validation
export const validateState = (state) => {
    if (!state || !state.trim()) {
        return 'State is required';
    }
    if (!INDIAN_STATES.includes(state)) {
        return 'Please select a valid state';
    }
    return null;
};

// Referral code validation (optional, alphanumeric)
export const validateReferralCode = (code) => {
    if (!code) return null; // Optional field
    if (!/^[a-zA-Z0-9]+$/.test(code)) {
        return 'Referral code must be alphanumeric';
    }
    if (code.length < 4 || code.length > 20) {
        return 'Referral code must be 4-20 characters';
    }
    return null;
};

// Complete patient signup validation
export const validatePatientSignup = (formData) => {
    const errors = {};

    // First name - required
    const firstNameError = validateName(formData.first_name, 'First name');
    if (firstNameError) {
        errors.first_name = firstNameError;
    }

    // Last name - optional, but validate format if provided
    if (formData.last_name && formData.last_name.trim()) {
        if (!/^[a-zA-Z\s]+$/.test(formData.last_name)) {
            errors.last_name = 'Last name can only contain letters and spaces';
        }
    }

    // Email - optional, but validate format if provided
    if (formData.email && formData.email.trim()) {
        if (!validateEmail(formData.email)) {
            errors.email = 'Please enter a valid email address';
        }
    }

    // State - required
    const stateError = validateState(formData.state);
    if (stateError) {
        errors.state = stateError;
    }

    // Phone number - required
    if (!formData.phone_number) {
        errors.phone_number = 'Phone number is required';
    } else if (!validatePhone(formData.phone_number)) {
        errors.phone_number = 'Please enter a valid 10-digit phone number starting with 6-9';
    }

    // Referral code - optional
    const referralError = validateReferralCode(formData.referral_code);
    if (referralError) {
        errors.referral_code = referralError;
    }

    // Password - required
    if (!formData.password) {
        errors.password = 'Password is required';
    } else {
        const passwordErrors = validatePassword(formData.password);
        if (passwordErrors.length > 0) {
            errors.password = passwordErrors[0];
        }
    }

    // Confirm password - required
    if (!formData.confirmPassword) {
        errors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
    }

    return errors;
};

// Aadhaar validation (12 digits, starts with 2-9)
export const validateAadhaar = (aadhar) => {
    if (!aadhar || !aadhar.trim()) {
        return 'Aadhaar number is required';
    }
    const cleanAadhar = aadhar.replace(/\s/g, '');
    if (!/^\d{12}$/.test(cleanAadhar)) {
        return 'Aadhaar number must be exactly 12 digits';
    }
    if (/^[01]/.test(cleanAadhar)) {
        return 'Invalid Aadhaar number format';
    }
    return null;
};

// Registration number validation
export const validateRegistrationNumber = (regNumber) => {
    if (!regNumber || !regNumber.trim()) {
        return 'Registration number is required';
    }
    if (regNumber.length < 4) {
        return 'Registration number must be at least 4 characters';
    }
    if (regNumber.length > 50) {
        return 'Registration number must not exceed 50 characters';
    }
    return null;
};

// File validation
export const validateFileUpload = (file, fieldName = 'File', required = true, maxSizeMB = 5) => {
    if (!file) {
        return required ? `${fieldName} is required` : null;
    }

    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowedTypes.includes(file.type)) {
        return `${fieldName} must be PDF, JPG, or PNG`;
    }

    const maxSize = maxSizeMB * 1024 * 1024;
    if (file.size > maxSize) {
        return `${fieldName} must be less than ${maxSizeMB}MB`;
    }

    return null;
};

// Single qualification validation
export const validateQualification = (qualification, index) => {
    const errors = {};
    const prefix = `Qualification ${index + 1}`;

    if (!qualification.degree_name || !qualification.degree_name.trim()) {
        errors.degree_name = `${prefix}: Degree name is required`;
    }

    if (!qualification.institution || !qualification.institution.trim()) {
        errors.institution = `${prefix}: Institution is required`;
    }

    if (!qualification.certificate) {
        errors.certificate = `${prefix}: Certificate is required`;
    } else {
        const fileError = validateFileUpload(qualification.certificate, `${prefix} Certificate`);
        if (fileError) {
            errors.certificate = fileError;
        }
    }

    return Object.keys(errors).length > 0 ? errors : null;
};

// Complete doctor signup validation
export const validateDoctorSignup = (formData, files, qualifications) => {
    const errors = {};

    // First name - required
    const firstNameError = validateName(formData.first_name, 'First name');
    if (firstNameError) {
        errors.first_name = firstNameError;
    }

    // Last name - optional
    if (formData.last_name && formData.last_name.trim()) {
        if (!/^[a-zA-Z\s]+$/.test(formData.last_name)) {
            errors.last_name = 'Last name can only contain letters and spaces';
        }
    }

    // Email - required
    if (!formData.email || !formData.email.trim()) {
        errors.email = 'Email is required';
    } else if (!validateEmail(formData.email)) {
        errors.email = 'Please enter a valid email address';
    }

    // Phone number - required
    if (!formData.phone_number) {
        errors.phone_number = 'Phone number is required';
    } else if (!validatePhone(formData.phone_number)) {
        errors.phone_number = 'Please enter a valid 10-digit phone number';
    }

    // State - required
    const stateError = validateState(formData.state);
    if (stateError) {
        errors.state = stateError;
    }

    // Referral code - optional
    const referralError = validateReferralCode(formData.referral_code);
    if (referralError) {
        errors.referral_code = referralError;
    }

    // Registration number - required
    const regError = validateRegistrationNumber(formData.registration_number);
    if (regError) {
        errors.registration_number = regError;
    }

    // Registration certificate - required
    const regCertError = validateFileUpload(files.registration_certificate, 'Registration certificate');
    if (regCertError) {
        errors.registration_certificate = regCertError;
    }

    // Aadhaar number - required
    const aadharError = validateAadhaar(formData.aadhar_number);
    if (aadharError) {
        errors.aadhar_number = aadharError;
    }

    // Aadhaar attachment - required
    const aadharFileError = validateFileUpload(files.aadhar_attachment, 'Aadhaar attachment');
    if (aadharFileError) {
        errors.aadhar_attachment = aadharFileError;
    }

    // Password - required
    if (!formData.password) {
        errors.password = 'Password is required';
    } else {
        const passwordErrors = validatePassword(formData.password);
        if (passwordErrors.length > 0) {
            errors.password = passwordErrors[0];
        }
    }

    // Confirm password - required
    if (!formData.confirmPassword) {
        errors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
    }

    // Qualifications - at least one required
    if (!qualifications || qualifications.length === 0) {
        errors.qualifications = 'At least one qualification is required';
    } else {
        const qualErrors = [];
        qualifications.forEach((qual, index) => {
            const qualError = validateQualification(qual, index);
            if (qualError) {
                qualErrors.push(qualError);
            }
        });
        if (qualErrors.length > 0) {
            errors.qualifications = qualErrors;
        } else {
            // Education ladder: a higher qualification can't be claimed
            // without the ones beneath it. PG requires UG; super-speciality
            // requires both PG and UG. Mirrors the backend
            // SignupSchemaDoctor.validate_qualification_dependencies check.
            const levels = new Set(
                qualifications
                    .map((q) => (q.qualification_level || '').toLowerCase())
                    .filter(Boolean)
            );
            if (levels.has('super_speciality')) {
                const missing = ['ug', 'pg'].filter((l) => !levels.has(l));
                if (missing.length > 0) {
                    errors.qualifications =
                        'A super-speciality qualification requires both UG and PG '
                        + `qualifications. Please add: ${missing.map((m) => m.toUpperCase()).join(' and ')}.`;
                }
            } else if (levels.has('pg') && !levels.has('ug')) {
                errors.qualifications =
                    'A PG qualification requires a UG qualification. '
                    + 'Please add your UG qualification.';
            }
        }
    }

    return errors;
};
