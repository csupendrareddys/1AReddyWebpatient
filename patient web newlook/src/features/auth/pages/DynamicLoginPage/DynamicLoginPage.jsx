/**
 * DynamicLoginPage
 * Dynamic, admin-configurable login page matching reference design
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Visibility, VisibilityOff, Person, Lock, Phone, ErrorOutline } from '@mui/icons-material';
import { CircularProgress } from '@mui/material';

import { useLoginPageConfig, getDefaultConfig } from '../../hooks/useLoginPageConfig';
import { login, clearError } from '../../redux/authSlice';
import LegalContentModal from '../../components/LegalContentModal/LegalContentModal';
import './DynamicLoginPage.css';

// Icon mapping for dynamic icons
const iconMap = {
    Person: Person,
    Lock: Lock,
    Phone: Phone,
};

const DynamicLoginPage = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const { config, loading: configLoading, error: configError } = useLoginPageConfig();
    const { isLoading: authLoading, error: authError } = useSelector((state) => state.auth);

    // Use fetched config or default
    const pageConfig = config || getDefaultConfig();

    // Form state
    const [activeTab, setActiveTab] = useState('login');
    const [selectedUserType, setSelectedUserType] = useState('');
    const [formData, setFormData] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [validationError, setValidationError] = useState('');

    // Modal state for legal content
    const [modalOpen, setModalOpen] = useState(false);
    const [modalType, setModalType] = useState('terms');

    // Set default selected user type when config loads
    useEffect(() => {
        if (pageConfig.user_types && pageConfig.user_types.length > 0) {
            const defaultType = pageConfig.user_types.find(ut => ut.default_selected);
            setSelectedUserType(defaultType?.type_key || pageConfig.user_types[0].type_key);
        }
    }, [pageConfig.user_types]);

    // Initialize form data when fields load
    useEffect(() => {
        if (pageConfig.fields) {
            const initialData = {};
            pageConfig.fields.forEach(field => {
                initialData[field.field_key] = '';
            });
            setFormData(initialData);
        }
    }, [pageConfig.fields]);

    const handleFieldChange = (fieldKey, value) => {
        setFormData(prev => ({ ...prev, [fieldKey]: value }));
        setValidationError('');
        if (authError) {
            dispatch(clearError());
        }
    };

    const handleOpenModal = (type) => {
        setModalType(type);
        setModalOpen(true);
    };

    const handleCloseModal = () => {
        setModalOpen(false);
    };

    const validateForm = () => {
        // Check required fields
        for (const field of pageConfig.fields || []) {
            if (field.required && !formData[field.field_key]?.trim()) {
                setValidationError(`${field.label} is required`);
                return false;
            }
        }

        // Check terms if required
        if (pageConfig.terms_is_present && pageConfig.terms_required && !termsAccepted) {
            setValidationError('Please accept the Terms & Conditions');
            return false;
        }

        return true;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) return;

        // Build login payload
        const loginPayload = {
            password: formData.password,
        };

        // Detect identifier type from username field
        const username = formData.username?.trim() || '';
        if (username.includes('@')) {
            loginPayload.email = username;
        } else if (/^[6-9]\d{9}$/.test(username.replace(/\s/g, ''))) {
            loginPayload.phone_number = username.replace(/\s/g, '');
        } else {
            loginPayload.email = username; // Default to email
        }

        try {
            const result = await dispatch(login(loginPayload)).unwrap();

            // Redirect based on user role
            const dashboardRoutes = {
                patient: '/dashboard/patient',
                doctor: '/dashboard/doctor',
                pharmacy: '/dashboard/pharmacy',
                diagnosis: '/dashboard/diagnosis',
                // Marketplace facility admins (Round 3+4).
                clinic: '/dashboard/clinic',
                hospital: '/dashboard/hospital',
                // A practice's own staff — same portal as their practice.
                provider_staff: '/dashboard/staff',
                patient_staff: '/dashboard/patient-staff',
                super_admin: '/dashboard/admin',
                sub_admin: '/dashboard/admin',
            };

            navigate(dashboardRoutes[result.user.role] || '/dashboard/patient');
        } catch (err) {
            console.error('Login error:', err);
            // session limit is handled globally in App.jsx via Redux
        }
    };

    const handleSignupClick = () => {
        const currentUserType = pageConfig.user_types?.find(ut => ut.type_key === selectedUserType);
        if (currentUserType?.signup_route) {
            let route = currentUserType.signup_route;
            if (!route.startsWith('/') && !route.startsWith('http')) {
                route = '/' + route;
            }
            navigate(route);
        }
    };

    const getFieldIcon = (iconName) => {
        const IconComponent = iconMap[iconName];
        return IconComponent ? <IconComponent className="field-icon" /> : null;
    };

    // Loading state
    if (configLoading) {
        return (
            <div className="login-page-container" style={{ background: pageConfig.background_color || '#fff9f0' }}>
                <div className="login-card" style={{ backgroundColor: pageConfig.card_background_color || '#ffffff' }}>
                    <div className="loading-container">
                        <div className="loading-spinner"></div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="login-page-container" style={{ background: pageConfig.background_color || '#fff9f0' }}>
            <div className="login-card" style={{ backgroundColor: pageConfig.card_background_color || '#ffffff' }}>
                {/* Logo Section */}
                {pageConfig.logo_is_present && (
                    <div className="logo-section">
                        <div className="logo-container">
                            {pageConfig.logo_url ? (
                                <img
                                    src={pageConfig.logo_url}
                                    alt={pageConfig.logo_alt_text}
                                    className="logo-image"
                                />
                            ) : (
                                <>
                                    <div style={{
                                        width: 0,
                                        height: 0,
                                        borderLeft: '35px solid transparent',
                                        borderRight: '35px solid transparent',
                                        borderBottom: '60px solid #e67e22',
                                        marginBottom: '5px'
                                    }} />
                                </>
                            )}
                            <span className="logo-text">{pageConfig.logo_alt_text || 'JLMUSH'}</span>
                        </div>
                    </div>
                )}

                {/* User Type Selector */}
                {pageConfig.user_type_selector_is_present && pageConfig.user_types?.length > 0 && (
                    <div className="user-type-selector">
                        {pageConfig.user_types.map((userType) => (
                            <label
                                key={userType.id || userType.type_key}
                                className={`user-type-option ${selectedUserType === userType.type_key ? 'selected' : ''}`}
                            >
                                <input
                                    type="radio"
                                    name="userType"
                                    value={userType.type_key}
                                    checked={selectedUserType === userType.type_key}
                                    onChange={(e) => setSelectedUserType(e.target.value)}
                                />
                                {userType.display_name}
                            </label>
                        ))}
                    </div>
                )}

                {/* Login/Signup Tabs */}
                <div className="tab-switcher">
                    <button
                        type="button"
                        className={`tab-button ${activeTab === 'login' ? 'active' : ''}`}
                        onClick={() => setActiveTab('login')}
                    >
                        {pageConfig.login_tab_text}
                    </button>
                    {pageConfig.signup_tab_is_present && (
                        <button
                            type="button"
                            className={`tab-button ${activeTab === 'signup' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('signup');
                                handleSignupClick();
                            }}
                        >
                            {pageConfig.signup_tab_text}
                        </button>
                    )}
                </div>

                {/* Error Display */}
                {(authError || validationError) && (
                    <div className="error-alert">
                        <ErrorOutline fontSize="small" />
                        {authError || validationError}
                    </div>
                )}

                {/* Login Form */}
                <form onSubmit={handleSubmit}>
                    {/* Dynamic Form Fields */}
                    {pageConfig.fields?.map((field) => (
                        <div key={field.id || field.field_key} className="form-field">
                            <div className="field-wrapper">
                                {field.icon && getFieldIcon(field.icon)}
                                <input
                                    type={field.field_type === 'password' && !showPassword ? 'password' : 'text'}
                                    className="field-input"
                                    placeholder={field.placeholder || field.label}
                                    value={formData[field.field_key] || ''}
                                    onChange={(e) => handleFieldChange(field.field_key, e.target.value)}
                                    required={field.required}
                                />
                                {field.field_type === 'password' && (
                                    <button
                                        type="button"
                                        className="password-toggle"
                                        onClick={() => setShowPassword(!showPassword)}
                                    >
                                        {showPassword ? <VisibilityOff /> : <Visibility />}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}

                    {/* Remember Me & Forgot Password */}
                    <div className="form-options-row">
                        {pageConfig.remember_me_is_present && (
                            <label className="remember-me">
                                <input
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                />
                                {pageConfig.remember_me_text}
                            </label>
                        )}
                        {pageConfig.forgot_password_is_present && (
                            <span
                                className="forgot-password-link"
                                onClick={() => navigate('/auth/forgot-password')}
                            >
                                {pageConfig.forgot_password_text}
                            </span>
                        )}
                    </div>

                    {/* Terms Checkbox */}
                    {(pageConfig.terms_is_present || pageConfig.privacy_is_present) && (
                        <label className="terms-checkbox">
                            <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(e) => setTermsAccepted(e.target.checked)}
                            />
                            <span>
                                {pageConfig.terms_checkbox_text}{' '}
                                {pageConfig.terms_is_present && (
                                    <span
                                        className="terms-link"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (pageConfig.terms_url) {
                                                window.open(pageConfig.terms_url, '_blank', 'noopener,noreferrer');
                                            } else {
                                                handleOpenModal('terms');
                                            }
                                        }}
                                    >
                                        {pageConfig.terms_link_text}
                                    </span>
                                )}
                                {pageConfig.terms_is_present && pageConfig.privacy_is_present && ' and '}
                                {pageConfig.privacy_is_present && (
                                    <span
                                        className="terms-link"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (pageConfig.privacy_url) {
                                                window.open(pageConfig.privacy_url, '_blank', 'noopener,noreferrer');
                                            } else {
                                                handleOpenModal('privacy');
                                            }
                                        }}
                                    >
                                        {pageConfig.privacy_link_text}
                                    </span>
                                )}
                            </span>
                        </label>
                    )}

                    {/* Login Button */}
                    <button
                        type="submit"
                        className="login-button"
                        disabled={authLoading}
                    >
                        {authLoading ? (
                            <CircularProgress size={24} color="inherit" />
                        ) : (
                            pageConfig.login_button_text
                        )}
                    </button>
                </form>

                {/* OTP Section */}
                {pageConfig.otp_section_is_present && (
                    <>
                        <div className="divider">Or</div>
                        <div className="otp-section">
                            <div className="otp-section-left">
                                <Phone className="otp-section-icon" />
                                <span>{pageConfig.otp_section_text}</span>
                            </div>
                            <button
                                type="button"
                                className="otp-button"
                                onClick={() => navigate('/auth/otp-login')}
                            >
                                {pageConfig.otp_button_text}
                            </button>
                        </div>
                    </>
                )}

                {/* Register Link */}
                {pageConfig.register_is_present && (
                    <div className="register-section">
                        {pageConfig.register_text}
                        <span
                            className="register-link"
                            onClick={handleSignupClick}
                            style={{ cursor: 'pointer' }}
                        >
                            {pageConfig.register_link_text}
                        </span>
                    </div>
                )}

                {/* Extra Buttons */}
                {pageConfig.extra_buttons?.length > 0 && (
                    <div className="extra-buttons-section">
                        {pageConfig.extra_buttons.map((button) => (
                            <button
                                key={button.id}
                                type="button"
                                className={`extra-button ${button.button_type || 'outlined'}`}
                                onClick={() => {
                                    if (button.action_type === 'link' && button.action_value) {
                                        if (button.action_value.startsWith('http')) {
                                            window.open(button.action_value, '_blank');
                                        } else {
                                            navigate(button.action_value);
                                        }
                                    }
                                }}
                            >
                                {button.icon && iconMap[button.icon] && React.createElement(iconMap[button.icon], { fontSize: 'small' })}
                                {button.button_text}
                            </button>
                        ))}
                    </div>
                )}

                {/* Legal Content Modal */}
                <LegalContentModal
                    open={modalOpen}
                    onClose={handleCloseModal}
                    type={modalType}
                />
            </div>
        </div>
    );
};

export default DynamicLoginPage;
