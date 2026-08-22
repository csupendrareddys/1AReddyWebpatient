/**
 * InviteUserDialog — single-tab dialog for the three Round-9 invite flows:
 *
 *   1. Tenant SUPER_ADMIN / PLATFORM_OWNER invites a DOCTOR into the tenant.
 *      (mode='doctor', mutationHook=useAdminInviteDoctorMutation)
 *   2. Tenant SUPER_ADMIN / PLATFORM_OWNER invites a PATIENT into the tenant.
 *      (mode='patient', mutationHook=useAdminInvitePatientMutation)
 *   3. A DOCTOR invites a PATIENT into their own tenant.
 *      (mode='patient', mutationHook=useDoctorInvitePatientMutation)
 *
 * Single-tab on purpose — the hospital "Enter code" affiliation path is
 * facility-specific and irrelevant here. The dialog only renders the
 * fields actually needed for the chosen mode (patients skip the
 * credentials + documents sections; doctors keep them).
 *
 * Reuses the existing activation backend so the invitee experience is
 * identical: receives email + SMS with /auth/activate?token=… link,
 * sets password, verifies email OTP + phone OTP, then can sign in.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, IconButton, Stack, TextField, Typography,
    MenuItem, FormControl, InputLabel, Select, FormHelperText,
    CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import {
    useListPublicTenantProviderPlansQuery,
} from '../../api/publicEndpoints';

const doctorInitial = {
    first_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    state: '',
    registration_number: '',
    aadhar_number: '',
};

const patientInitial = {
    first_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    dob: '',
    gender: '',
};

// Hospital + Clinic share the same field set with one exception:
// hospital_type is only collected for hospitals. The dialog renders
// the conditional below based on ``mode``.
const facilityInitial = {
    first_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    state: '',
    // Facility-level fields
    name: '',
    registration_number: '',
    address: '',
    city: '',
    pincode: '',
    phone: '',
    website: '',
    hospital_type: '',
    plan_code: '',
};

/**
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   onResult?: (severity, message) => void — caller's snackbar bridge
 *   mode: 'doctor' | 'patient'
 *   mutationHook: an RTK Query useXxxMutation hook (the slice's, not
 *     a destructured tuple — we call it inside the component).
 *   title?: string — overrides the dialog title; defaults to
 *     "Add doctor" or "Add patient" based on mode.
 */
export default function InviteUserDialog({
    open, onClose, onResult, mode = 'patient',
    mutationHook, title,
}) {
    const isDoctor = mode === 'doctor';
    const isFacility = mode === 'hospital' || mode === 'clinic';
    const isHospital = mode === 'hospital';
    const initial = isDoctor
        ? doctorInitial
        : isFacility ? facilityInitial : patientInitial;

    const [identity, setIdentity] = useState(initial);
    const [regCert, setRegCert] = useState(null);
    const [aadharFile, setAadharFile] = useState(null);
    const [qualCert, setQualCert] = useState(null);
    const [activationLink, setActivationLink] = useState('');
    const [localError, setLocalError] = useState('');
    const [invite, { isLoading: inviting }] = mutationHook();

    // For facility invites, fetch the tenant's published provider plans
    // for the relevant vertical so the operator can pick from a
    // dropdown instead of typing a code. RTK skips the call entirely
    // for non-facility modes so we don't pay the network round-trip
    // on doctor / patient invites where the field isn't shown.
    //
    // Backend response includes a ``selection_required`` flag — the
    // tenant super-admin can mark provider signup as plan-mandatory,
    // and that flag is the SAME source of truth the public-signup
    // form uses. We mirror it here so an admin invite is gated the
    // same way a self-signup would be: required when published,
    // optional when no plans exist yet.
    const planVertical = isFacility ? mode : null;
    const {
        data: tenantPlanData = { plans: [], selection_required: false },
        isLoading: plansLoading,
    } = useListPublicTenantProviderPlansQuery(planVertical, {
        skip: !isFacility || !open,
    });
    const availablePlans = tenantPlanData?.plans || [];
    const planSelectionRequired = (
        !!tenantPlanData?.selection_required && availablePlans.length > 0
    );

    const setField = (k) => (e) =>
        setIdentity((p) => ({ ...p, [k]: e.target.value }));

    const errText = (e) =>
        e?.data?.error || e?.data?.message ||
        e?.response?.data?.error || e?.response?.data?.message ||
        e?.error || e?.message || 'Operation failed.';

    const reset = () => {
        setIdentity(initial);
        setRegCert(null);
        setAadharFile(null);
        setQualCert(null);
        setActivationLink('');
        setLocalError('');
    };

    const handleClose = () => { reset(); onClose?.(); };

    const submit = async () => {
        setLocalError('');

        const required = isDoctor
            ? ['first_name', 'last_name', 'phone_number', 'email',
               'state', 'registration_number', 'aadhar_number']
            : isFacility
                ? ['first_name', 'last_name', 'phone_number', 'email',
                   'name', 'address', 'city', 'pincode']
                : ['first_name', 'last_name', 'phone_number', 'email'];
        for (const k of required) {
            if (!identity[k]) {
                setLocalError(`Missing field: ${k.replace('_', ' ')}`);
                return;
            }
        }

        try {
            let payload;
            if (isDoctor) {
                if (!regCert) { setLocalError('Upload registration certificate.'); return; }
                if (!aadharFile) { setLocalError('Upload Aadhaar document.'); return; }
                const fd = new FormData();
                Object.entries(identity).forEach(([k, v]) => fd.append(k, v));
                // Minimal qualification scaffold — doctor fills the
                // rest after activation. Matches what AddDoctorDialog
                // does for the facility-invite path.
                fd.append('qualifications', JSON.stringify([{
                    qualification_level: 'ug',
                    degree_name: 'MBBS',
                    institution: identity.state || 'To be updated',
                }]));
                fd.append('registration_certificate', regCert);
                fd.append('aadhar_attachment', aadharFile);
                if (qualCert) fd.append('qualification_certificate_0', qualCert);
                payload = fd;
            } else if (isFacility) {
                if (!regCert) { setLocalError('Upload registration certificate.'); return; }
                if (!aadharFile) { setLocalError("Upload admin's Aadhaar document."); return; }
                // Plan-code gate. If the tenant has published any
                // provider plans for this vertical AND marked them as
                // selection-required, refuse to invite without a code
                // — same rule the public-signup form enforces, so
                // admin-invited and self-signed facilities can't end
                // up on different lifecycle paths.
                if (planSelectionRequired && !identity.plan_code) {
                    setLocalError(
                        'This tenant requires a plan selection for new '
                        + `${mode} signups. Pick one from the dropdown.`,
                    );
                    return;
                }
                const fd = new FormData();
                Object.entries(identity).forEach(([k, v]) => {
                    // Skip hospital_type for clinics so the backend doesn't
                    // see an empty string where it expects null.
                    if (k === 'hospital_type' && !isHospital) return;
                    if (v == null || v === '') return;
                    fd.append(k, v);
                });
                fd.append('registration_certificate', regCert);
                // Backend field name is admin_aadhaar_attachment for
                // facility uploads (vs ``aadhar_attachment`` for doctor).
                fd.append('admin_aadhaar_attachment', aadharFile);
                payload = fd;
            } else {
                // JSON payload for patient — strip empty optional fields
                // so the backend doesn't see empty strings where it
                // expected null.
                payload = { ...identity };
                if (!payload.dob) delete payload.dob;
                if (!payload.gender) delete payload.gender;
            }

            const res = await invite(payload).unwrap();
            const link = res?.data?.activation_link;
            const emailSent = res?.data?.invite_email_sent_to;
            const smsSent = res?.data?.invite_sms_sent_to;
            const label = isDoctor
                ? 'Doctor'
                : isHospital ? 'Hospital'
                : mode === 'clinic' ? 'Clinic'
                : 'Patient';
            if (link) {
                setActivationLink(link);
                onResult?.('success',
                    `${label} invited. Activation link sent to `
                    + `${emailSent} and ${smsSent}.`);
            } else {
                onResult?.('success', `${label} invited.`);
                handleClose();
            }
        } catch (e) {
            setLocalError(errText(e));
        }
    };

    const resolvedTitle = title || (
        isDoctor ? 'Add doctor'
        : isHospital ? 'Add hospital'
        : mode === 'clinic' ? 'Add clinic'
        : 'Add patient'
    );

    return (
        <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {resolvedTitle}
                <IconButton onClick={handleClose} size="small">
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {localError && (
                    <Alert severity="error" sx={{ mb: 2 }}>{localError}</Alert>
                )}

                {activationLink ? (
                    <Stack spacing={2}>
                        <Alert severity="success">
                            Invite sent. The {
                                isDoctor ? 'doctor'
                                : isHospital ? 'hospital admin'
                                : mode === 'clinic' ? 'clinic admin'
                                : 'patient'
                            } will receive an email + SMS with an activation link.
                            They'll set their own password and verify both contacts
                            before signing in.
                        </Alert>
                        <Typography variant="caption" color="text.secondary">
                            Activation link (can be shared manually too):
                        </Typography>
                        <TextField
                            fullWidth size="small"
                            value={activationLink}
                            InputProps={{ readOnly: true, style: { fontFamily: 'monospace' } }}
                        />
                        <Button onClick={handleClose} variant="contained">Done</Button>
                    </Stack>
                ) : (
                    <>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            {isDoctor
                                ? "Fill in the doctor's identity and upload documents. They'll receive an email + SMS with an activation link."
                                : isFacility
                                    ? `Fill in the ${isHospital ? 'hospital' : 'clinic'} details + the admin contact. They'll receive an email + SMS with an activation link; the admin sets their own password and verifies both contacts before signing in.`
                                    : "Fill in the patient's identity and contact. They'll receive an email + SMS with an activation link; they'll set their own password and verify both contacts before signing in."}
                        </Typography>

                        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>Identity</Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <TextField label="First name" value={identity.first_name} onChange={setField('first_name')} fullWidth />
                            <TextField label="Last name" value={identity.last_name} onChange={setField('last_name')} fullWidth />
                        </Stack>

                        <Divider sx={{ my: 2 }} />
                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Contact (activation link will be sent here)
                        </Typography>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                            <TextField label="Phone (10 digits, no +91)" value={identity.phone_number} onChange={setField('phone_number')} fullWidth />
                            <TextField label="Email" value={identity.email} onChange={setField('email')} fullWidth />
                        </Stack>

                        {isDoctor && (
                            <>
                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Credentials</Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <TextField label="State" value={identity.state} onChange={setField('state')} fullWidth />
                                    <TextField label="MCI registration number" value={identity.registration_number} onChange={setField('registration_number')} fullWidth />
                                </Stack>
                                <TextField label="Aadhaar (12 digits, 2-9 start)" value={identity.aadhar_number} onChange={setField('aadhar_number')} fullWidth sx={{ mt: 2 }} />

                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Documents</Typography>
                                <Stack spacing={1.5}>
                                    <Button variant="outlined" component="label">
                                        {regCert ? `Registration certificate: ${regCert.name}` : 'Upload registration certificate'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setRegCert(e.target.files?.[0])} />
                                    </Button>
                                    <Button variant="outlined" component="label">
                                        {aadharFile ? `Aadhaar: ${aadharFile.name}` : 'Upload Aadhaar document'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setAadharFile(e.target.files?.[0])} />
                                    </Button>
                                    <Button variant="outlined" component="label">
                                        {qualCert ? `Qualification certificate: ${qualCert.name}` : 'Upload qualification certificate (optional)'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setQualCert(e.target.files?.[0])} />
                                    </Button>
                                </Stack>
                            </>
                        )}

                        {isFacility && (
                            <>
                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    {isHospital ? 'Hospital' : 'Clinic'} details
                                </Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <TextField
                                        label={`${isHospital ? 'Hospital' : 'Clinic'} name`}
                                        value={identity.name}
                                        onChange={setField('name')}
                                        fullWidth
                                    />
                                    <TextField
                                        label="Registration number"
                                        value={identity.registration_number}
                                        onChange={setField('registration_number')}
                                        fullWidth
                                    />
                                </Stack>
                                {isHospital && (
                                    <TextField
                                        label="Hospital type (e.g. General, Specialty)"
                                        value={identity.hospital_type}
                                        onChange={setField('hospital_type')}
                                        fullWidth
                                        sx={{ mt: 2 }}
                                    />
                                )}
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
                                    <TextField label="Address" value={identity.address} onChange={setField('address')} fullWidth />
                                    <TextField label="City" value={identity.city} onChange={setField('city')} fullWidth />
                                </Stack>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
                                    <TextField label="State" value={identity.state} onChange={setField('state')} fullWidth />
                                    <TextField label="Pincode" value={identity.pincode} onChange={setField('pincode')} fullWidth />
                                </Stack>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
                                    <TextField label="Facility phone (optional)" value={identity.phone} onChange={setField('phone')} fullWidth />
                                    <TextField label="Website (optional)" value={identity.website} onChange={setField('website')} fullWidth />
                                </Stack>

                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                    {planSelectionRequired ? 'Plan' : 'Plan (optional)'}
                                </Typography>
                                {plansLoading ? (
                                    <Stack
                                        direction="row" spacing={1}
                                        alignItems="center" sx={{ mb: 1 }}
                                    >
                                        <CircularProgress size={16} />
                                        <Typography variant="caption" color="text.secondary">
                                            Loading available plans…
                                        </Typography>
                                    </Stack>
                                ) : availablePlans.length === 0 ? (
                                    // Tenant hasn't authored any provider plans
                                    // for this vertical yet. Field is optional
                                    // by definition — operator can invite
                                    // without a plan and attach one later via
                                    // Billing → Subscriptions.
                                    <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
                                        This tenant hasn't published any{' '}
                                        {isHospital ? 'hospital' : 'clinic'} plans
                                        yet. The {isHospital ? 'hospital' : 'clinic'}{' '}
                                        will be invited without a plan; you can
                                        attach one later from Billing →
                                        Subscriptions.
                                    </Alert>
                                ) : (
                                    <FormControl
                                        fullWidth
                                        required={planSelectionRequired}
                                        error={planSelectionRequired && !identity.plan_code}
                                    >
                                        <InputLabel id="invite-plan-label">
                                            {planSelectionRequired
                                                ? 'Pick a plan'
                                                : 'Pick a plan (or leave blank)'}
                                        </InputLabel>
                                        <Select
                                            labelId="invite-plan-label"
                                            value={identity.plan_code || ''}
                                            label={planSelectionRequired
                                                ? 'Pick a plan'
                                                : 'Pick a plan (or leave blank)'}
                                            onChange={setField('plan_code')}
                                        >
                                            {!planSelectionRequired && (
                                                <MenuItem value="">
                                                    <em>No plan</em>
                                                </MenuItem>
                                            )}
                                            {availablePlans.map((p) => {
                                                const price = p.price_inr_monthly == null
                                                    ? 'Custom'
                                                    : p.price_inr_monthly === 0
                                                        ? 'Free'
                                                        : `₹${Math.round(p.price_inr_monthly).toLocaleString()}/mo`;
                                                return (
                                                    <MenuItem key={p.code} value={p.code}>
                                                        {p.name} — {price}
                                                    </MenuItem>
                                                );
                                            })}
                                        </Select>
                                        <FormHelperText>
                                            {planSelectionRequired
                                                ? 'This tenant requires a plan for new ' +
                                                  `${mode} signups.`
                                                : 'Optional — pick one of the published plans, or leave blank.'}
                                        </FormHelperText>
                                    </FormControl>
                                )}

                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Documents</Typography>
                                <Stack spacing={1.5}>
                                    <Button variant="outlined" component="label">
                                        {regCert ? `Registration certificate: ${regCert.name}` : 'Upload registration certificate'}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setRegCert(e.target.files?.[0])} />
                                    </Button>
                                    <Button variant="outlined" component="label">
                                        {aadharFile ? `Admin Aadhaar: ${aadharFile.name}` : "Upload admin's Aadhaar document"}
                                        <input hidden type="file" accept=".pdf,.jpg,.jpeg,.png"
                                            onChange={(e) => setAadharFile(e.target.files?.[0])} />
                                    </Button>
                                </Stack>
                            </>
                        )}

                        {!isDoctor && !isFacility && (
                            <>
                                <Divider sx={{ my: 2 }} />
                                <Typography variant="subtitle2" sx={{ mb: 1 }}>Optional details</Typography>
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <TextField
                                        label="Date of birth (YYYY-MM-DD)"
                                        value={identity.dob}
                                        onChange={setField('dob')}
                                        placeholder="1990-01-15"
                                        fullWidth
                                    />
                                    <TextField
                                        label="Gender (M / F / O)"
                                        value={identity.gender}
                                        onChange={setField('gender')}
                                        fullWidth
                                    />
                                </Stack>
                            </>
                        )}
                    </>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose}>Cancel</Button>
                {!activationLink && (
                    <Button onClick={submit} variant="contained" disabled={inviting}>
                        {inviting ? 'Inviting…' : 'Send invite'}
                    </Button>
                )}
            </DialogActions>
        </Dialog>
    );
}
