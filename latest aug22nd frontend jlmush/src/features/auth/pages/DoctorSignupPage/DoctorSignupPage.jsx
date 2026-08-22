import { useState } from 'react';
import { Link as RouterLink, Navigate } from 'react-router-dom';
import {
    Box,
    TextField,
    Button,
    Typography,
    Link,
    Alert,
    InputAdornment,
    IconButton,
    CircularProgress,
    Grid,
    MenuItem,
    Paper,
    Divider,
    Tooltip,
    Skeleton,
    Autocomplete,
    createFilterOptions,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import LockIcon from '@mui/icons-material/Lock';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';
import PasswordStrengthIndicator from '../../components/PasswordStrengthIndicator/PasswordStrengthIndicator';
import useDoctorSignup from '../../hooks/useDoctorSignup';
import useDoctorSignupPageConfig from '../../hooks/useDoctorSignupPageConfig';
import { INDIAN_STATES } from '../../utils/validation';
import { useGetPublicMembershipPlanByCodeQuery } from '../../../admin/api/publicEndpoints';
import { useListTenantProviderPlansForSignupQuery } from '../../../admin/api/tenantProviderPlanEndpoints';
import useIsOnPlatformDomain from '../../../../common/hooks/useIsOnPlatformDomain';

// Render-side fallbacks. Used when the live config request fails or is
// still loading — the form always renders something usable even with no
// backend signal.
const FALLBACK_LABELS = {
    first_name: 'First Name',
    last_name: 'Last Name',
    email: 'Email',
    phone_number: 'Phone Number',
    password: 'Password',
    confirm_password: 'Confirm Password',
    referral_code: 'Referral Code',
    state: 'State',
    registration_number: 'Medical Registration Number',
    registration_certificate: 'Registration Certificate',
    aadhaar_number: 'Aadhaar Number',
    aadhaar_attachment: 'Aadhaar Attachment',
};
const FALLBACK_PLACEHOLDERS = {
    phone_number: '9876543210',
    registration_number: 'e.g., MCI-12345',
    aadhaar_number: '1234 5678 9012',
};

// Adornment to mark fields the admin can't disable, so the user knows
// they're system-required.
const LockBadge = () => (
    <Tooltip title="This field is required by the platform and can't be disabled by the admin.">
        <LockIcon fontSize="inherit" sx={{ ml: 0.5, fontSize: 14, opacity: 0.5 }} />
    </Tooltip>
);

// ── Free-solo dropdown for degree / specialization / college ──────────
// The admin curates a master list per qualification level (UG / PG /
// Super-speciality). A doctor whose degree, specialization, or college
// isn't on that list used to be blocked at signup — the previous fixed
// Select forced them to pick from the curated set. With this component
// the doctor can either pick from the list (which sets *_id + *_name)
// or type their own value that becomes the *_name with *_id cleared.
// Backend already accepts both shapes (validators have *_id as
// optional, *_name as the required string with min 2 / max 200|300
// chars).
const _autocompleteFilter = createFilterOptions({
    matchFrom: 'any',
    stringify: (option) => option?.name || '',
});

const FreeSoloDropdown = ({
    label, placeholder, options, selectedId, selectedName,
    onPick, error, helperText,
}) => {
    // ``value`` for Autocomplete must be either an option object, a
    // string, or null. Prefer the matching option so the dropdown
    // highlights the chosen row, but fall back to a string so a custom
    // value the doctor typed in a previous render stays visible.
    const matched = options.find((o) => String(o.id) === String(selectedId));
    const value = matched || (selectedName ? { id: '', name: selectedName } : null);

    return (
        <Autocomplete
            fullWidth
            size="small"
            freeSolo
            selectOnFocus
            handleHomeEndKeys
            clearOnBlur={false}
            options={options}
            value={value}
            getOptionLabel={(opt) => {
                // MUI fires this with both objects and bare strings
                // (the latter when the doctor's typed value hasn't
                // been confirmed yet). Coerce both safely.
                if (!opt) return '';
                if (typeof opt === 'string') return opt;
                return opt.name || '';
            }}
            isOptionEqualToValue={(opt, val) =>
                String(opt?.id ?? '') === String(val?.id ?? '')
                && (opt?.name || '') === (val?.name || '')
            }
            filterOptions={_autocompleteFilter}
            onChange={(_, picked) => {
                // Three shapes can arrive here:
                //   1. null               — user cleared
                //   2. string             — user pressed Enter on text
                //                           they typed that doesn't
                //                           match any option (freeSolo)
                //   3. { id, name }       — picked from dropdown
                if (picked == null) {
                    onPick({ id: '', name: '' });
                    return;
                }
                if (typeof picked === 'string') {
                    onPick({ id: '', name: picked.trim() });
                    return;
                }
                onPick({
                    id: String(picked.id ?? ''),
                    name: picked.name || '',
                });
            }}
            onInputChange={(_, newInput, reason) => {
                // Keep the typed value live in form state even before
                // the user blurs / presses Enter. Otherwise a doctor
                // who types a custom institution then submits without
                // pressing Enter would send the previous (or empty)
                // value. ``reason === 'input'`` covers human typing;
                // 'reset' / 'clear' come from picks + clears which
                // ``onChange`` already handles, so skip those here.
                //
                // CRITICAL: Do NOT ``.trim()`` here. Trimming on every
                // keystroke strips the trailing space the moment the
                // user hits the spacebar, which then flows back into
                // the controlled input value — so the doctor literally
                // cannot type a multi-word college name like "Christian
                // Medical College" because the space between words gets
                // eaten before the next letter arrives. Persist the
                // raw input. Trimming happens at submit time
                // (submitSignup.js sends ``q.institution`` as-is, but
                // the backend validator's min-length check naturally
                // ignores trailing whitespace).
                if (reason !== 'input') return;
                const raw = newInput || '';
                // Match against trimmed values so existing options
                // still resolve (e.g. user typed "AIIMS " — still
                // matches the catalog "AIIMS"). Storage stays raw so
                // the trailing space the user is mid-typing survives.
                const lookupKey = raw.trim().toLowerCase();
                const exists = lookupKey
                    ? options.find(
                        (o) => (o.name || '').toLowerCase() === lookupKey
                    )
                    : null;
                if (exists) {
                    onPick({ id: String(exists.id), name: exists.name });
                } else {
                    onPick({ id: '', name: raw });
                }
            }}
            renderInput={(params) => (
                <TextField
                    {...params}
                    label={label}
                    placeholder={placeholder}
                    required
                    margin="dense"
                    error={error}
                    helperText={helperText}
                />
            )}
        />
    );
};

const DoctorSignupPage = () => {
    const {
        formData,
        files,
        qualifications,
        validationErrors,
        planCode,
        tenantProviderPlanId,
        setTenantProviderPlanId,
        showPassword,
        showConfirmPassword,
        isLoading,
        error,
        handleChange,
        handleFileChange,
        handleQualificationChange,
        handleQualificationFileChange,
        addQualification,
        removeQualification,
        handleSubmit,
        toggleShowPassword,
        toggleShowConfirmPassword,
    } = useDoctorSignup();

    // Branch by tenant context. Apex (``larazen.in``) = marketplace
    // signup, required plan_code from the /join funnel. Any other
    // hostname = in-tenant signup, which has its own plan picker fed
    // by ``/api/v1/tenant-provider-plans/public/doctor``.
    const isApex = useIsOnPlatformDomain();

    // ── Apex (marketplace) gate ────────────────────────────────────
    // Doctors must come through the /join → /join/doctor →
    // signup?plan=<code> funnel. A bare URL hit bounces back to the
    // persona's vertical pricing page so the user can pick a tier.
    // The backend re-validates plan_code on the multipart POST so a
    // stripped query string can't slip through.
    if (isApex && !planCode) {
        return <Navigate to="/join/doctor" replace />;
    }

    // Fetch the chosen apex marketplace plan so the banner can render
    // its name. Only relevant on apex; skip on tenant subdomains so we
    // don't 404 against a marketplace plan that isn't theirs.
    const { data: selectedPlan, error: planFetchError } =
        useGetPublicMembershipPlanByCodeQuery(planCode, {
            skip: !isApex || !planCode,
        });
    if (isApex && planFetchError?.status === 404) {
        return <Navigate to="/join/doctor" replace />;
    }

    // ── In-tenant signup picker (non-apex) ─────────────────────────
    // The endpoint returns ``{ plans: [...], selection_required: bool }``.
    // When the tenant holds the doctor-plan add-on AND has authored
    // ≥ 1 active plan, ``selection_required`` is true and the picker
    // is mandatory. Otherwise the form proceeds without a plan id.
    const { data: inTenantPicker = { plans: [], selection_required: false } } =
        useListTenantProviderPlansForSignupQuery('doctor', { skip: isApex });

    const {
        loading: configLoading,
        getField,
        getFieldProp,
        getOptions,
        isPresent,
        isLocked,
    } = useDoctorSignupPageConfig('en');

    // ── Field-level config helpers ─────────────────────────────────────
    // ``key`` is the field_key from the backend default_fields.py.
    const labelFor = (key) => getFieldProp(key, 'label', FALLBACK_LABELS[key] || key);
    const placeholderFor = (key) =>
        getFieldProp(key, 'placeholder', FALLBACK_PLACEHOLDERS[key] || '');
    const helperFor = (key, fallback = '') =>
        getFieldProp(key, 'helper_text', fallback);
    const showField = (key) => isPresent(key, /*defaultIfMissing*/ true);

    // ── Dropdown option resolvers ──────────────────────────────────────
    // State options come from the config's resolved master_states. Fall
    // back to the legacy hardcoded list if the config didn't ship any.
    const configStateOptions = getOptions('master_states');
    const stateOptions =
        configStateOptions && configStateOptions.length
            ? configStateOptions.map((s) => ({ id: s.id, name: s.name }))
            : INDIAN_STATES.map((s) => ({ id: s, name: s }));

    // For each qualification row we resolve the per-level dropdowns.
    //
    // Two sources can populate a dropdown:
    //   1. The field's own ``options`` JSON — what the admin typed
    //      directly into the editor's "Options" block on the field row.
    //   2. The resolved data_source — derived from the tenant's master
    //      tables (``master_degrees:ug`` → Category rows with type=degree,
    //      level=ug, etc.).
    //
    // The editor's FieldEditor component already follows the rule
    // "field.options if non-empty, else fall back to resolved
    // data_source". Mirror it here so an admin adding "Ginda" via the
    // Options block ACTUALLY shows up on the public signup form
    // (previously the form only ever read from data_sources, so any
    // typed options were silently ignored for data-source-backed
    // fields).
    const KIND_TO_FIELD_KEY = {
        degrees: 'degree',
        specializations: 'specialization',
        colleges: 'college',
    };
    const normalizeOption = (o) => {
        if (o == null) return null;
        if (typeof o === 'string') return { id: o, name: o };
        if (typeof o === 'object' && (o.name || o.label || o.id)) {
            return { id: String(o.id ?? o.value ?? o.name ?? o.label), name: o.name ?? o.label ?? String(o.value ?? o.id) };
        }
        return null;
    };
    const optionsForLevel = (level, kind) => {
        if (!level) return [];
        const fieldKey = `${level}_${KIND_TO_FIELD_KEY[kind] || kind}`;
        const field = getField(fieldKey);
        const fieldOptions = Array.isArray(field?.options) ? field.options : [];
        if (fieldOptions.length > 0) {
            return fieldOptions.map(normalizeOption).filter(Boolean);
        }
        return getOptions(`master_${kind}:${level}`) || [];
    };

    // Helper to get file name for display
    const getFileName = (file) => (file ? file.name : 'No file selected');

    // While we're still pulling the config, show a top-of-page skeleton
    // strip so the user knows the form is dynamic — but render the
    // form below anyway so the page isn't blocked.
    return (
        <Box>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                <Box
                    sx={{
                        p: 2,
                        borderRadius: '50%',
                        bgcolor: 'secondary.light',
                        color: 'secondary.contrastText',
                    }}
                >
                    <LocalHospitalIcon sx={{ fontSize: 40 }} />
                </Box>
            </Box>

            <Typography variant="h4" component="h1" gutterBottom align="center" color="primary">
                Doctor Registration
            </Typography>
            <Typography variant="body1" color="text.secondary" align="center" sx={{ mb: 3 }}>
                Join our healthcare network
            </Typography>

            {selectedPlan && (
                <Alert
                    severity="success"
                    icon={<WorkspacePremiumIcon />}
                    sx={{ mb: 2 }}
                >
                    You're signing up for the <strong>{selectedPlan.name}</strong> plan.
                    {selectedPlan.trial_days > 0 && (
                        <>
                            {' '}
                            Your {selectedPlan.trial_days}-day free trial starts the moment your
                            credentials are verified.
                        </>
                    )}
                </Alert>
            )}

            {/* In-tenant plan picker. Only shown on non-apex hosts when
                the tenant has authored ≥1 active doctor plan. If no
                plans exist this collapses (no picker, no requirement). */}
            {!isApex && inTenantPicker.plans.length > 0 && (
                <Alert
                    severity={
                        inTenantPicker.selection_required
                            && !tenantProviderPlanId
                                ? 'warning'
                                : 'info'
                    }
                    icon={<WorkspacePremiumIcon />}
                    sx={{ mb: 2 }}
                >
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
                        {inTenantPicker.selection_required
                            ? 'Please choose a plan to continue'
                            : 'Optional — choose a plan'}
                    </Typography>
                    <TextField
                        select
                        size="small"
                        fullWidth
                        value={tenantProviderPlanId || ''}
                        onChange={(e) => setTenantProviderPlanId(e.target.value)}
                        label="Plan"
                        required={inTenantPicker.selection_required}
                    >
                        {!inTenantPicker.selection_required && (
                            <MenuItem value="">
                                <em>No plan</em>
                            </MenuItem>
                        )}
                        {inTenantPicker.plans.map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                                {p.name}
                                {p.price_inr_monthly != null
                                    ? ` — ₹${p.price_inr_monthly}/mo`
                                    : ''}
                                {p.trial_days > 0
                                    ? ` (${p.trial_days}-day trial)`
                                    : ''}
                            </MenuItem>
                        ))}
                    </TextField>
                </Alert>
            )}

            <Alert severity="info" sx={{ mb: 2 }}>
                Your account will be reviewed and activated by an administrator after registration.
            </Alert>

            {configLoading && (
                <Skeleton variant="rounded" height={8} sx={{ mb: 2 }} />
            )}

            {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                    {error}
                </Alert>
            )}

            <Box component="form" onSubmit={handleSubmit}>
                {/* Personal Details Section */}
                <Typography variant="h6" sx={{ mb: 2, mt: 2 }}>Personal Details</Typography>

                <Grid container spacing={2}>
                    {showField('first_name') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={
                                    <>
                                        {labelFor('first_name')}
                                        {isLocked('first_name') && <LockBadge />}
                                    </>
                                }
                                name="first_name"
                                value={formData.first_name}
                                onChange={handleChange}
                                required
                                placeholder={placeholderFor('first_name')}
                                error={!!validationErrors.first_name}
                                helperText={
                                    validationErrors.first_name || helperFor('first_name')
                                }
                                autoFocus
                            />
                        </Grid>
                    )}
                    {showField('last_name') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={
                                    <>
                                        {labelFor('last_name')}
                                        {isLocked('last_name') && <LockBadge />}
                                    </>
                                }
                                name="last_name"
                                value={formData.last_name}
                                onChange={handleChange}
                                required
                                placeholder={placeholderFor('last_name')}
                                error={!!validationErrors.last_name}
                                helperText={
                                    validationErrors.last_name || helperFor('last_name')
                                }
                            />
                        </Grid>
                    )}
                </Grid>

                {showField('email') && (
                    <TextField
                        fullWidth
                        label={labelFor('email')}
                        name="email"
                        type="email"
                        value={formData.email}
                        onChange={handleChange}
                        required={!!getFieldProp('email', 'required', true)}
                        margin="normal"
                        placeholder={placeholderFor('email')}
                        error={!!validationErrors.email}
                        helperText={validationErrors.email || helperFor('email')}
                    />
                )}

                {showField('phone_number') && (
                    <TextField
                        fullWidth
                        label={
                            <>
                                {labelFor('phone_number')}
                                {isLocked('phone_number') && <LockBadge />}
                            </>
                        }
                        name="phone_number"
                        value={formData.phone_number}
                        onChange={handleChange}
                        required
                        margin="normal"
                        placeholder={placeholderFor('phone_number')}
                        InputProps={{
                            startAdornment: <InputAdornment position="start">+91</InputAdornment>,
                        }}
                        inputProps={{ maxLength: 10 }}
                        error={!!validationErrors.phone_number}
                        helperText={
                            validationErrors.phone_number ||
                            helperFor('phone_number', "We'll send an OTP to verify this number.")
                        }
                    />
                )}

                <Grid container spacing={2} sx={{ mt: 0 }}>
                    {showField('password') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={
                                    <>
                                        {labelFor('password')}
                                        {isLocked('password') && <LockBadge />}
                                    </>
                                }
                                name="password"
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={handleChange}
                                required
                                placeholder={placeholderFor('password')}
                                error={!!validationErrors.password}
                                helperText={validationErrors.password || helperFor('password')}
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton onClick={toggleShowPassword} edge="end">
                                                {showPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                }}
                            />
                        </Grid>
                    )}
                    {showField('confirm_password') && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                fullWidth
                                label={
                                    <>
                                        {labelFor('confirm_password')}
                                        {isLocked('confirm_password') && <LockBadge />}
                                    </>
                                }
                                name="confirmPassword"
                                type={showConfirmPassword ? 'text' : 'password'}
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                required
                                placeholder={placeholderFor('confirm_password')}
                                error={!!validationErrors.confirmPassword}
                                helperText={
                                    validationErrors.confirmPassword || helperFor('confirm_password')
                                }
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton onClick={toggleShowConfirmPassword} edge="end">
                                                {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                }}
                            />
                        </Grid>
                    )}
                </Grid>

                {showField('password') && (
                    <PasswordStrengthIndicator password={formData.password} />
                )}

                {/* Referral code stays opt-in — not part of the configurable surface */}
                <TextField
                    fullWidth
                    label="Referral Code"
                    name="referral_code"
                    value={formData.referral_code}
                    onChange={handleChange}
                    margin="normal"
                    error={!!validationErrors.referral_code}
                    helperText={validationErrors.referral_code || 'Optional'}
                />

                {showField('state') && (
                    <TextField
                        fullWidth
                        select
                        label={labelFor('state')}
                        name="state"
                        value={formData.state}
                        onChange={handleChange}
                        required={!!getFieldProp('state', 'required', true)}
                        margin="normal"
                        error={!!validationErrors.state}
                        helperText={validationErrors.state || helperFor('state')}
                    >
                        <MenuItem value="">{placeholderFor('state') || 'Select State'}</MenuItem>
                        {stateOptions.map((s) => (
                            <MenuItem key={s.id} value={s.name}>
                                {s.name}
                            </MenuItem>
                        ))}
                    </TextField>
                )}

                <Divider sx={{ my: 3 }} />

                {/* Professional Details Section */}
                <Typography variant="h6" sx={{ mb: 2 }}>Professional Details</Typography>

                {showField('registration_number') && (
                    <TextField
                        fullWidth
                        label={
                            <>
                                {labelFor('registration_number')}
                                {isLocked('registration_number') && <LockBadge />}
                            </>
                        }
                        name="registration_number"
                        value={formData.registration_number}
                        onChange={handleChange}
                        required
                        margin="normal"
                        placeholder={placeholderFor('registration_number')}
                        error={!!validationErrors.registration_number}
                        helperText={
                            validationErrors.registration_number || helperFor('registration_number')
                        }
                    />
                )}

                {/* Registration Certificate Upload */}
                {showField('registration_certificate') && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {labelFor('registration_certificate')}{' '}
                            {getFieldProp('registration_certificate', 'required', true) && '*'}
                        </Typography>
                        <Button
                            component="label"
                            variant="outlined"
                            startIcon={<CloudUploadIcon />}
                            sx={{ width: '100%', justifyContent: 'flex-start', py: 1.5 }}
                        >
                            {getFileName(files.registration_certificate)}
                            <input
                                type="file"
                                name="registration_certificate"
                                hidden
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={handleFileChange}
                            />
                        </Button>
                        {validationErrors.registration_certificate && (
                            <Typography color="error" variant="caption">
                                {validationErrors.registration_certificate}
                            </Typography>
                        )}
                    </Box>
                )}

                {(showField('aadhaar_number') || showField('aadhaar_attachment')) && (
                    <>
                        <Divider sx={{ my: 3 }} />
                        <Typography variant="h6" sx={{ mb: 2 }}>Aadhaar Details</Typography>
                    </>
                )}

                {showField('aadhaar_number') && (
                    <TextField
                        fullWidth
                        label={labelFor('aadhaar_number')}
                        name="aadhar_number"
                        value={formData.aadhar_number}
                        onChange={handleChange}
                        required={!!getFieldProp('aadhaar_number', 'required', false)}
                        margin="normal"
                        placeholder={placeholderFor('aadhaar_number')}
                        inputProps={{ maxLength: 14 }}
                        error={!!validationErrors.aadhar_number}
                        helperText={validationErrors.aadhar_number || helperFor('aadhaar_number')}
                    />
                )}

                {/* Aadhaar Attachment Upload */}
                {showField('aadhaar_attachment') && (
                    <Box sx={{ mt: 2 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            {labelFor('aadhaar_attachment')}{' '}
                            {getFieldProp('aadhaar_attachment', 'required', false) && '*'}
                        </Typography>
                        <Button
                            component="label"
                            variant="outlined"
                            startIcon={<CloudUploadIcon />}
                            sx={{ width: '100%', justifyContent: 'flex-start', py: 1.5 }}
                        >
                            {getFileName(files.aadhar_attachment)}
                            <input
                                type="file"
                                name="aadhar_attachment"
                                hidden
                                accept=".pdf,.jpg,.jpeg,.png"
                                onChange={handleFileChange}
                            />
                        </Button>
                        {validationErrors.aadhar_attachment && (
                            <Typography color="error" variant="caption">
                                {validationErrors.aadhar_attachment}
                            </Typography>
                        )}
                    </Box>
                )}

                <Divider sx={{ my: 3 }} />

                {/* Qualifications Section — admin-curated dropdowns per UG/PG/SS */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6">Qualification / Education Details</Typography>
                    <IconButton color="primary" onClick={addQualification} title="Add Qualification">
                        <AddCircleOutlineIcon />
                    </IconButton>
                </Box>

                {typeof validationErrors.qualifications === 'string' && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {validationErrors.qualifications}
                    </Alert>
                )}

                {qualifications.map((qual, index) => {
                    const level = qual.qualification_level || 'ug';
                    const degreeOptions = optionsForLevel(level, 'degrees');
                    const specOptions = optionsForLevel(level, 'specializations');
                    const collegeOptions = optionsForLevel(level, 'colleges');

                    // When the admin picks an option, also store the
                    // human-readable name so the existing backend payload
                    // (degree_name / institution / specialization_name)
                    // stays populated.
                    const pickFromOptions = (options, id) =>
                        (options.find((o) => String(o.id) === String(id)) || {}).name || '';

                    const onSelectDegree = (e) => {
                        const id = e.target.value;
                        handleQualificationChange(index, 'degree_id', id);
                        handleQualificationChange(
                            index, 'degree_name', pickFromOptions(degreeOptions, id),
                        );
                    };
                    const onSelectSpecialization = (e) => {
                        const id = e.target.value;
                        handleQualificationChange(index, 'specialization_id', id);
                        handleQualificationChange(
                            index, 'specialization_name', pickFromOptions(specOptions, id),
                        );
                    };
                    const onSelectCollege = (e) => {
                        const id = e.target.value;
                        handleQualificationChange(index, 'college_id', id);
                        handleQualificationChange(
                            index, 'institution', pickFromOptions(collegeOptions, id),
                        );
                    };
                    const onChangeLevel = (e) => {
                        // Switching level invalidates any previously
                        // selected degree / specialization / college since
                        // they belong to that level's master list.
                        handleQualificationChange(index, 'qualification_level', e.target.value);
                        handleQualificationChange(index, 'degree_id', '');
                        handleQualificationChange(index, 'degree_name', '');
                        handleQualificationChange(index, 'specialization_id', '');
                        handleQualificationChange(index, 'specialization_name', '');
                        handleQualificationChange(index, 'college_id', '');
                        handleQualificationChange(index, 'institution', '');
                    };

                    return (
                        <Paper key={index} elevation={1} sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                <Typography variant="subtitle2">Qualification {index + 1}</Typography>
                                {qualifications.length > 1 && (
                                    <IconButton
                                        color="error"
                                        size="small"
                                        onClick={() => removeQualification(index)}
                                        title="Remove"
                                    >
                                        <RemoveCircleOutlineIcon />
                                    </IconButton>
                                )}
                            </Box>

                            <TextField
                                fullWidth
                                select
                                label="Level"
                                value={level}
                                onChange={onChangeLevel}
                                required
                                margin="dense"
                                size="small"
                                helperText="Determines which admin-curated lists you pick from."
                            >
                                <MenuItem value="ug">Graduation (UG)</MenuItem>
                                <MenuItem value="pg">Post Graduation (PG)</MenuItem>
                                <MenuItem value="super_speciality">Super Speciality</MenuItem>
                            </TextField>

                            <FreeSoloDropdown
                                label={labelFor(`${level}_degree`) || 'Degree'}
                                placeholder={placeholderFor(`${level}_degree`) || 'Start typing or select your degree'}
                                options={degreeOptions}
                                selectedId={qual.degree_id}
                                selectedName={qual.degree_name}
                                onPick={(picked) => {
                                    // ``picked`` is { id, name } when the doctor picks
                                    // from the dropdown; ``{ id: '', name: 'custom' }``
                                    // when they type a value that doesn't exist.
                                    handleQualificationChange(index, 'degree_id', picked.id);
                                    handleQualificationChange(index, 'degree_name', picked.name);
                                }}
                                error={!!validationErrors.qualifications?.[index]?.degree_name}
                                helperText={
                                    validationErrors.qualifications?.[index]?.degree_name ||
                                    (degreeOptions.length
                                        ? "Pick from the list, or type your own if it's not there."
                                        : "Type your degree — none uploaded yet for this level.")
                                }
                            />

                            <FreeSoloDropdown
                                label={labelFor(`${level}_specialization`) || 'Specialization'}
                                placeholder={
                                    placeholderFor(`${level}_specialization`) ||
                                    'Start typing or select your specialization'
                                }
                                options={specOptions}
                                selectedId={qual.specialization_id}
                                selectedName={qual.specialization_name || qual.specialization}
                                onPick={(picked) => {
                                    handleQualificationChange(index, 'specialization_id', picked.id);
                                    handleQualificationChange(index, 'specialization_name', picked.name);
                                }}
                                error={!!validationErrors.qualifications?.[index]?.specialization}
                                helperText={
                                    validationErrors.qualifications?.[index]?.specialization ||
                                    (specOptions.length
                                        ? "Pick from the list, or type your own if it's not there."
                                        : "Type your specialization — none uploaded yet for this level.")
                                }
                            />

                            <FreeSoloDropdown
                                label={labelFor(`${level}_college`) || 'College / Institution'}
                                placeholder={
                                    placeholderFor(`${level}_college`) ||
                                    'Start typing or select your college'
                                }
                                options={collegeOptions}
                                selectedId={qual.college_id}
                                selectedName={qual.institution}
                                onPick={(picked) => {
                                    handleQualificationChange(index, 'college_id', picked.id);
                                    handleQualificationChange(index, 'institution', picked.name);
                                }}
                                error={!!validationErrors.qualifications?.[index]?.institution}
                                helperText={
                                    validationErrors.qualifications?.[index]?.institution ||
                                    (collegeOptions.length
                                        ? "Pick from the list, or type your own if it's not there."
                                        : "Type your college — none uploaded yet for this level.")
                                }
                            />


                            <TextField
                                fullWidth
                                type="number"
                                label={labelFor(`${level}_year_of_passing`) || 'Year of Passing'}
                                value={qual.year_of_passing || ''}
                                onChange={(e) =>
                                    handleQualificationChange(index, 'year_of_passing', e.target.value)
                                }
                                margin="dense"
                                size="small"
                                placeholder="YYYY"
                                inputProps={{ min: 1900, max: 2100, maxLength: 4 }}
                            />

                            <Box sx={{ mt: 1 }}>
                                <Button
                                    component="label"
                                    variant="outlined"
                                    size="small"
                                    startIcon={<CloudUploadIcon />}
                                    sx={{ width: '100%', justifyContent: 'flex-start' }}
                                >
                                    {qual.certificate
                                        ? qual.certificate.name
                                        : (labelFor(`${level}_certificate`) || 'Attach Certificate') + ' *'}
                                    <input
                                        type="file"
                                        hidden
                                        accept=".pdf,.jpg,.jpeg,.png"
                                        onChange={(e) =>
                                            handleQualificationFileChange(index, e.target.files[0])
                                        }
                                    />
                                </Button>
                                {validationErrors.qualifications?.[index]?.certificate && (
                                    <Typography color="error" variant="caption">
                                        {validationErrors.qualifications[index].certificate}
                                    </Typography>
                                )}
                            </Box>
                        </Paper>
                    );
                })}

                {/* Submit Button */}
                <Button
                    type="submit"
                    fullWidth
                    variant="contained"
                    size="large"
                    disabled={isLoading}
                    sx={{ mt: 3, mb: 2, py: 1.5 }}
                >
                    {isLoading ? <CircularProgress size={24} color="inherit" /> : 'Register as Doctor'}
                </Button>

                <Typography variant="body2" align="center">
                    Already registered?{' '}
                    <Link component={RouterLink} to="/auth/service-provider/login" underline="hover">
                        Sign In
                    </Link>
                </Typography>

                <Box sx={{ mt: 3, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="body2" align="center" color="text.secondary">
                        By signing up, you agree to our{' '}
                        <Link component={RouterLink} to="/terms-and-conditions" underline="hover">
                            Terms & Conditions
                        </Link>{' '}
                        and{' '}
                        <Link component={RouterLink} to="/privacy-policy" underline="hover">
                            Privacy Policy
                        </Link>
                    </Typography>
                </Box>
            </Box>
        </Box>
    );
};

export default DoctorSignupPage;
