/**
 * useTenantSignup — self-serve tenant creation flow.
 *
 * Owns form state, submit handler, and server-error mapping so
 * ``TenantSignup.jsx`` is pure presentation.
 *
 * Flow:
 *   1. Read ``?plan=<code>`` from the URL (set by the landing-page CTA).
 *   2. POST ``/api/public/signup/tenant`` with tenant + admin.
 *   3. On 201 the backend already set the JWT cookies — navigate into
 *      the new tenant's admin dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { setUserFromOtpLogin } from '../redux/authSlice';
import { setSnackbar } from '../../admin/redux/adminSharedUiSlice';
import { useSignupTenantMutation } from '../../admin/api/publicEndpoints';


/** Subdomain slug rules: lowercase alnum + hyphen, 3–50 chars, not edge-hyphen. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;


const INITIAL_FORM = {
    tenant_name: '',
    tenant_slug: '',
    first_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    password: '',
    confirm_password: '',
    agree_terms: false,
};


export const useTenantSignup = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch();
    const [params] = useSearchParams();
    const planCode = params.get('plan') || 'plan1';

    const [form, setForm] = useState(INITIAL_FORM);
    const [fieldErrors, setFieldErrors] = useState({});
    const [signup, { isLoading, error }] = useSignupTenantMutation();

    // Autofill the slug from the clinic name — "Demo Clinic" → "demo-clinic".
    // Only runs until the user types into the slug field themselves.
    const [slugDirty, setSlugDirty] = useState(false);
    useEffect(() => {
        if (slugDirty) return;
        const autoSlug = (form.tenant_name || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .slice(0, 40);
        if (autoSlug !== form.tenant_slug) {
            setForm((f) => ({ ...f, tenant_slug: autoSlug }));
        }
    }, [form.tenant_name, slugDirty]);  // eslint-disable-line react-hooks/exhaustive-deps

    const setField = useCallback((name, value) => {
        if (name === 'tenant_slug') setSlugDirty(true);
        setForm((f) => ({ ...f, [name]: value }));
    }, []);

    const validate = useCallback(() => {
        const errs = {};
        if (!form.tenant_name.trim()) errs.tenant_name = 'Required';
        if (!form.tenant_slug.trim()) errs.tenant_slug = 'Required';
        else if (!SLUG_RE.test(form.tenant_slug))
            errs.tenant_slug = '3–50 chars, lowercase letters, digits, hyphens; not edge-hyphen.';
        if (!form.first_name.trim()) errs.first_name = 'Required';
        if (!form.last_name.trim()) errs.last_name = 'Required';
        if (!form.phone_number.trim()) errs.phone_number = 'Required';
        else if (!/^[6-9]\d{9}$/.test(form.phone_number.replace(/\D/g, '').replace(/^91/, '')))
            errs.phone_number = '10-digit Indian number starting 6–9';
        if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email))
            errs.email = 'Invalid email';
        if (!form.password) errs.password = 'Required';
        else if (form.password.length < 8) errs.password = 'Min 8 characters';
        if (form.password !== form.confirm_password)
            errs.confirm_password = 'Passwords do not match';
        if (!form.agree_terms) errs.agree_terms = 'Required';
        setFieldErrors(errs);
        return Object.keys(errs).length === 0;
    }, [form]);

    const handleSubmit = useCallback(async () => {
        if (!validate()) return;
        try {
            const result = await signup({
                plan_code: planCode,
                tenant: { name: form.tenant_name, slug: form.tenant_slug },
                admin: {
                    first_name: form.first_name,
                    last_name: form.last_name,
                    phone_number: form.phone_number,
                    email: form.email || null,
                    password: form.password,
                },
            }).unwrap();

            // Hydrate Redux auth state so ProtectedRoute lets us in on the
            // same render. Backend already set the cookies; this just
            // mirrors the user object the rest of the app reads from.
            if (result?.user) dispatch(setUserFromOtpLogin({ user: result.user }));

            dispatch(setSnackbar({
                open: true, severity: 'success',
                message: `Welcome to ${form.tenant_name}! Your 14-day trial has started.`,
            }));
            navigate(result?.redirect_url || '/dashboard/admin');
        } catch (err) {
            const apiErrors = err?.data?.errors || {};
            const mapped = {};
            // Server-side field keys look like ``tenant.slug`` / ``admin.email``
            // — flatten for the form, which uses ``tenant_slug`` / ``email``.
            for (const [k, v] of Object.entries(apiErrors)) {
                if (k === 'tenant.slug' || k === 'tenant.missing') mapped.tenant_slug = Array.isArray(v) ? v.join(', ') : v;
                if (k === 'admin.phone_number') mapped.phone_number = Array.isArray(v) ? v.join(', ') : v;
                if (k === 'admin.email') mapped.email = Array.isArray(v) ? v.join(', ') : v;
                if (k === 'admin.password') mapped.password = Array.isArray(v) ? v.join(', ') : v;
            }
            setFieldErrors((prev) => ({ ...prev, ...mapped }));
            dispatch(setSnackbar({
                open: true, severity: 'error',
                message: err?.data?.error || 'Signup failed — please review the form.',
            }));
        }
    }, [validate, signup, planCode, form, dispatch, navigate]);

    return {
        planCode,
        form,
        setField,
        fieldErrors,
        handleSubmit,
        isSubmitting: isLoading,
        serverError: error?.data?.error || null,
    };
};

export default useTenantSignup;
