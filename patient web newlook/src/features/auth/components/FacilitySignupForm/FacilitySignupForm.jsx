/**
 * FacilitySignupForm — shared layout for clinic + hospital marketplace
 * signup pages. Renders the personal-info section, facility-info
 * section (with an optional Hospital Type select), file uploads, and
 * the plan banner.
 *
 * Hospital page passes ``vertical='hospital'`` to show the
 * ``hospital_type`` select; clinic passes ``vertical='clinic'`` to
 * hide it. Beyond that and the page headline + accent color, the two
 * pages are identical.
 *
 * Reused utilities:
 *   * ``useGetPublicMembershipPlanByCodeQuery`` for the "You're signing
 *     up for X" banner (Round 2 endpoint).
 *   * ``PasswordStrengthIndicator`` from the Round 2 doctor signup.
 *   * ``INDIAN_STATES`` from validation utils.
 */
import {
    Alert, Box, Button, Divider, Grid, IconButton, InputAdornment,
    MenuItem, TextField, Typography,
} from '@mui/material';
import { Navigate } from 'react-router-dom';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import WorkspacePremiumIcon from '@mui/icons-material/WorkspacePremium';

import PasswordStrengthIndicator
    from '../PasswordStrengthIndicator/PasswordStrengthIndicator';
import { useGetPublicMembershipPlanByCodeQuery }
    from '../../../admin/api/publicEndpoints';
import { INDIAN_STATES } from '../../utils/validation';
import EntityCoreFields from '../../../../common/components/EntityCoreFields/EntityCoreFields';


// Hospital type vocabulary — small fixed list for Round 3+4. Operator
// can introduce a master-list later if the menu needs to be configurable.
const HOSPITAL_TYPES = [
    'Multi-Speciality',
    'Super-Speciality',
    'General',
    'Maternity',
    'Paediatric',
    'Day Care',
    'Other',
];


function fileName(f) {
    return f?.name || 'No file selected';
}


export default function FacilitySignupForm({
    vertical,           // 'clinic' | 'hospital'
    headline,
    sub,
    formData,
    files,
    validationErrors,
    planCode,
    showPassword,
    showConfirmPassword,
    handleChange,
    handleFileChange,
    handleEntityChange,
    toggleShowPassword,
    toggleShowConfirmPassword,
    handleSubmit,
}) {
    const isHospital = vertical === 'hospital';

    // Marketplace plan gate — clinic / hospital admins must come through
    // /join → /join/<vertical> → signup?plan=<code>. No plan code on
    // the URL means a direct hit; bounce them to the vertical pricing
    // page so they pick a tier. The backend re-validates the plan code
    // on POST so a stripped query string can't sneak past.
    if (!planCode) {
        return <Navigate to={`/join/${vertical}`} replace />;
    }

    const { data: selectedPlan, error: planFetchError } =
        useGetPublicMembershipPlanByCodeQuery(planCode);
    // Stale / archived plan code → 404 from /api/public/membership-plans
    // (ACTIVE-only). Treat the same as "no plan picked" so the user
    // refreshes onto the pricing page.
    if (planFetchError?.status === 404) {
        return <Navigate to={`/join/${vertical}`} replace />;
    }

    return (
        <Box>
            <Typography
                variant="h4" component="h1" gutterBottom align="center"
                color="primary"
            >
                {headline}
            </Typography>
            <Typography
                variant="body1" color="text.secondary"
                align="center" sx={{ mb: 3 }}
            >
                {sub}
            </Typography>

            {selectedPlan && (
                <Alert
                    severity="success"
                    icon={<WorkspacePremiumIcon />}
                    sx={{ mb: 2 }}
                >
                    You're signing up for the <strong>{selectedPlan.name}</strong> plan.
                    {selectedPlan.trial_days > 0 && (
                        <> Your {selectedPlan.trial_days}-day free trial starts the moment your facility is verified.</>
                    )}
                </Alert>
            )}

            <Alert severity="info" sx={{ mb: 2 }}>
                Your account will be reviewed and activated by an administrator after registration.
            </Alert>

            <Box component="form" onSubmit={handleSubmit}>
                {/* Personal details */}
                <Typography variant="h6" sx={{ mb: 2, mt: 2 }}>
                    Admin account
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth required
                            label="First name" name="first_name"
                            value={formData.first_name}
                            onChange={handleChange}
                            error={!!validationErrors.first_name}
                            helperText={validationErrors.first_name}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Last name" name="last_name"
                            value={formData.last_name}
                            onChange={handleChange}
                            error={!!validationErrors.last_name}
                            helperText={validationErrors.last_name}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth required type="email"
                            label="Email" name="email"
                            value={formData.email}
                            onChange={handleChange}
                            error={!!validationErrors.email}
                            helperText={validationErrors.email}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth required
                            label="Phone number" name="phone_number"
                            value={formData.phone_number}
                            onChange={handleChange}
                            placeholder="9876543210"
                            error={!!validationErrors.phone_number}
                            helperText={validationErrors.phone_number}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth required
                            label="Password" name="password"
                            type={showPassword ? 'text' : 'password'}
                            value={formData.password}
                            onChange={handleChange}
                            error={!!validationErrors.password}
                            helperText={validationErrors.password}
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
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth required
                            label="Confirm password" name="confirmPassword"
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            error={!!validationErrors.confirmPassword}
                            helperText={validationErrors.confirmPassword}
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
                    <Grid item xs={12}>
                        <PasswordStrengthIndicator password={formData.password} />
                    </Grid>
                </Grid>

                <Divider sx={{ my: 3 }} />

                {/* Facility details */}
                <Typography variant="h6" sx={{ mb: 2 }}>
                    {isHospital ? 'Hospital details' : 'Clinic details'}
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={isHospital ? 6 : 12}>
                        <TextField
                            fullWidth required
                            label={isHospital ? 'Hospital name' : 'Clinic name'}
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            error={!!validationErrors.name}
                            helperText={validationErrors.name}
                        />
                    </Grid>
                    {isHospital && (
                        <Grid item xs={12} sm={6}>
                            <TextField
                                select fullWidth required
                                label="Hospital type" name="hospital_type"
                                value={formData.hospital_type}
                                onChange={handleChange}
                                error={!!validationErrors.hospital_type}
                                helperText={validationErrors.hospital_type}
                            >
                                {HOSPITAL_TYPES.map((t) => (
                                    <MenuItem key={t} value={t}>{t}</MenuItem>
                                ))}
                            </TextField>
                        </Grid>
                    )}
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Registration number" name="registration_number"
                            value={formData.registration_number}
                            onChange={handleChange}
                            error={!!validationErrors.registration_number}
                            helperText={validationErrors.registration_number}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth
                            label="Public phone" name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            helperText="Optional — defaults to your admin phone"
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth required
                            label="Address" name="address"
                            value={formData.address}
                            onChange={handleChange}
                            error={!!validationErrors.address}
                            helperText={validationErrors.address}
                            multiline minRows={2}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth required
                            label="City" name="city"
                            value={formData.city}
                            onChange={handleChange}
                            error={!!validationErrors.city}
                            helperText={validationErrors.city}
                        />
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            select fullWidth required
                            label="State" name="state"
                            value={formData.state}
                            onChange={handleChange}
                            error={!!validationErrors.state}
                            helperText={validationErrors.state}
                        >
                            {INDIAN_STATES.map((s) => (
                                <MenuItem key={s} value={s}>{s}</MenuItem>
                            ))}
                        </TextField>
                    </Grid>
                    <Grid item xs={12} sm={4}>
                        <TextField
                            fullWidth required
                            label="Pincode" name="pincode"
                            value={formData.pincode}
                            onChange={handleChange}
                            error={!!validationErrors.pincode}
                            helperText={validationErrors.pincode}
                            inputProps={{ maxLength: 6 }}
                        />
                    </Grid>
                    <Grid item xs={12}>
                        <TextField
                            fullWidth
                            label="Website" name="website"
                            value={formData.website}
                            onChange={handleChange}
                            helperText="Optional"
                        />
                    </Grid>
                </Grid>

                <Divider sx={{ my: 3 }} />

                {/* Entity / legal-entity details */}
                <Typography variant="h6" sx={{ mb: 1 }}>
                    Entity details
                </Typography>
                <EntityCoreFields
                    values={formData.entity}
                    onChange={handleEntityChange}
                    errors={validationErrors.entity || {}}
                />

                <Divider sx={{ my: 3 }} />

                {/* File uploads */}
                <Typography variant="h6" sx={{ mb: 2 }}>
                    Verification documents
                </Typography>
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <Button
                            component="label"
                            variant="outlined" fullWidth
                            startIcon={<CloudUploadIcon />}
                            color={validationErrors.registration_certificate ? 'error' : 'primary'}
                        >
                            Registration certificate
                            <input
                                type="file" hidden
                                name="registration_certificate"
                                onChange={handleFileChange}
                                accept=".pdf,.jpg,.jpeg,.png"
                            />
                        </Button>
                        <Typography variant="caption" color={validationErrors.registration_certificate ? 'error' : 'text.secondary'}>
                            {validationErrors.registration_certificate || fileName(files.registration_certificate)}
                        </Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <Button
                            component="label"
                            variant="outlined" fullWidth
                            startIcon={<CloudUploadIcon />}
                            color={validationErrors.admin_aadhaar_attachment ? 'error' : 'primary'}
                        >
                            Admin Aadhaar
                            <input
                                type="file" hidden
                                name="admin_aadhaar_attachment"
                                onChange={handleFileChange}
                                accept=".pdf,.jpg,.jpeg,.png"
                            />
                        </Button>
                        <Typography variant="caption" color={validationErrors.admin_aadhaar_attachment ? 'error' : 'text.secondary'}>
                            {validationErrors.admin_aadhaar_attachment || fileName(files.admin_aadhaar_attachment)}
                        </Typography>
                    </Grid>
                </Grid>

                <Box sx={{ mt: 4 }}>
                    <Button
                        type="submit" variant="contained" size="large" fullWidth
                    >
                        Continue to verification
                    </Button>
                </Box>
            </Box>
        </Box>
    );
}
