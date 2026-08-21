/**
 * Final signup submitter — invoked from the last pre-signup OTP step.
 *
 * Doctor signup uploads files (registration certificate, aadhar
 * attachment, qualification certs) → multipart/form-data.
 * Patient / pharmacy / etc. signups are JSON.
 *
 * Called from BOTH PreSignupPhoneOtpPage (when no email was supplied)
 * and PreSignupEmailOtpPage (after email OTP verifies). Either path
 * passes the same set of tokens; ``emailToken`` is ``null`` when the
 * user signed up phone-only.
 *
 * Returns:
 *   { ok: true }                        on success (caller navigates)
 *   { ok: false, error: '...string' }   on failure (caller surfaces)
 */
import axiosInstance from '../../../api/axiosConfig';


/**
 * Build the multipart form-data body shared by clinic + hospital
 * signups. Both verticals have an identical field set apart from
 * ``hospital_type`` (which clinic doesn't have). The branch in the
 * caller picks the right POST URL and tacks on hospital_type when
 * needed.
 */
function _buildFacilityFormData({ formData, phoneToken, emailToken }) {
    const fd = new FormData();
    fd.append('first_name', formData.first_name);
    fd.append('last_name', formData.last_name || '');
    if (formData.email) fd.append('email', formData.email);
    fd.append('phone_number', formData.phone_number);
    fd.append('password', formData.password);
    fd.append('state', formData.state);

    // Facility-level fields
    fd.append('name', formData.name);
    if (formData.registration_number) {
        fd.append('registration_number', formData.registration_number);
    }
    fd.append('address', formData.address);
    fd.append('city', formData.city);
    fd.append('pincode', formData.pincode);
    if (formData.phone) fd.append('phone', formData.phone);
    if (formData.website) fd.append('website', formData.website);

    // OTP tokens — clinic + hospital both require phone + email OTP
    // (mirrors doctor signup).
    fd.append('phone_verification_token', phoneToken);
    if (emailToken) fd.append('email_verification_token', emailToken);

    // Round 2/3+4 — marketplace plan (optional, set when the user
    // came via the apex pricing card).
    if (formData.plan_code) {
        fd.append('plan_code', formData.plan_code);
    }

    // Legal-entity core fields (corporate facilities). Sent flat; the backend
    // persists an EntityProfile when entity_type is non-individual. Docs/logos/
    // personnel are completed later in the profile.
    const entity = formData.entity;
    if (entity && entity.entity_type && entity.entity_type !== 'individual') {
        fd.append('entity_type', entity.entity_type);
        [
            'entity_name', 'legal_name', 'trade_name', 'promoters',
            'year_of_establishment', 'registration_license_number',
            'cin_number', 'gst_number', 'pan_number',
        ].forEach((k) => {
            if (entity[k]) fd.append(k, entity[k]);
        });
    }

    // File uploads — both required per the Round 3+4 product call.
    const { files } = formData;
    if (files?.registration_certificate) {
        fd.append('registration_certificate', files.registration_certificate);
    }
    if (files?.admin_aadhaar_attachment) {
        fd.append('admin_aadhaar_attachment', files.admin_aadhaar_attachment);
    }

    return fd;
}


export async function submitSignupWithTokens({
    formData, signupType, phoneToken, emailToken, dispatch, signupAction,
}) {
    // ── Marketplace clinic signup (Round 3+4) ──────────────────
    if (signupType === 'clinic') {
        try {
            const fd = _buildFacilityFormData({
                formData, phoneToken, emailToken,
            });
            await axiosInstance.post('/auth/signup/clinic', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return { ok: true };
        } catch (err) {
            const msg =
                err.response?.data?.error
                || err.response?.data?.message
                || 'Clinic registration failed.';
            return { ok: false, error: msg };
        }
    }

    // ── Marketplace hospital signup (Round 3+4) ────────────────
    if (signupType === 'hospital') {
        try {
            const fd = _buildFacilityFormData({
                formData, phoneToken, emailToken,
            });
            // Hospital-only extra field — shared facility builder
            // doesn't emit this.
            if (formData.hospital_type) {
                fd.append('hospital_type', formData.hospital_type);
            }
            await axiosInstance.post('/auth/signup/hospital', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return { ok: true };
        } catch (err) {
            const msg =
                err.response?.data?.error
                || err.response?.data?.message
                || 'Hospital registration failed.';
            return { ok: false, error: msg };
        }
    }

    if (signupType === 'doctor') {
        try {
            const fd = new FormData();
            fd.append('first_name', formData.first_name);
            fd.append('last_name', formData.last_name || '');
            if (formData.email) fd.append('email', formData.email);
            fd.append('phone_number', formData.phone_number);
            fd.append('password', formData.password);
            fd.append('referral_code', formData.referral_code || '');
            fd.append('state', formData.state);
            fd.append('registration_number', formData.registration_number);
            fd.append('aadhar_number', formData.aadhar_number);
            fd.append('role', 'doctor');
            fd.append('phone_verification_token', phoneToken);
            // Doctor signup REQUIRES email + email token (validator enforces).
            if (emailToken) fd.append('email_verification_token', emailToken);
            // Round 2 — marketplace plan selected on the apex pricing
            // grid. Optional: empty / missing is back-compat with the
            // pre-marketplace direct-to-signup link, which the doctor
            // signup endpoint accepts as "no plan chosen".
            if (formData.plan_code) {
                fd.append('plan_code', formData.plan_code);
            }
            // Round 5 — in-tenant provider plan id. Sent only when the
            // signup happens inside a non-apex tenant subdomain whose
            // admin has authored doctor plans. The backend decides which
            // of ``plan_code`` vs ``tenant_provider_plan_id`` to honor
            // based on the tenant kind, so it's safe to always thread.
            if (formData.tenant_provider_plan_id) {
                fd.append(
                    'tenant_provider_plan_id',
                    formData.tenant_provider_plan_id,
                );
            }

            const { files, qualifications } = formData;
            if (files?.registration_certificate) {
                fd.append('registration_certificate', files.registration_certificate);
            }
            if (files?.aadhar_attachment) {
                fd.append('aadhar_attachment', files.aadhar_attachment);
            }

            // Send every qualification field the backend validator
            // accepts. Previously only ``degree_name`` and
            // ``institution`` were forwarded, which silently dropped
            // qualification_level + specialization + the master-list
            // IDs every time — so a doctor's typed specialization
            // never made it into the database, and the level-scoped
            // dropdowns the admin curates couldn't be linked back
            // to the row that referenced them.
            //
            // The IDs become empty strings when the doctor types a
            // custom value the admin hasn't seeded; the backend
            // schema marks them ``allow_none=True`` so an empty
            // string is fine — only the *_name strings are required.
            const qualificationsData = (qualifications || []).map((q) => ({
                degree_name: q.degree_name || '',
                institution: q.institution || '',
                specialization_name: q.specialization_name || '',
                qualification_level: q.qualification_level || '',
                degree_id: q.degree_id || '',
                specialization_id: q.specialization_id || '',
                college_id: q.college_id || '',
                year_of_passing: q.year_of_passing || '',
            }));
            fd.append('qualifications', JSON.stringify(qualificationsData));

            (qualifications || []).forEach((q, i) => {
                if (q.certificate) {
                    fd.append(`qualification_certificate_${i}`, q.certificate);
                }
            });

            await axiosInstance.post('/auth/signup/doctor', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return { ok: true };
        } catch (err) {
            const msg =
                err.response?.data?.error
                || err.response?.data?.message
                || 'Registration failed.';
            return { ok: false, error: msg };
        }
    }

    // Patient / pharmacy / sub-admin / etc. — JSON via the signup() thunk.
    const payload = { ...formData, phone_verification_token: phoneToken };
    if (emailToken) payload.email_verification_token = emailToken;
    delete payload.files;
    delete payload.qualifications;
    dispatch(signupAction(payload));
    // signupAction handles success/failure via redux state — caller watches
    // signupSuccess to redirect.
    return { ok: true };
}
