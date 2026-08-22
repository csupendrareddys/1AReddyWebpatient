/**
 * useTenantSignup — self-serve tenant creation flow.
 *
 * Owns form state, submit handler, and server-error mapping so
 * ``TenantSignup.jsx`` is pure presentation.
 *
 * Flow:
 *   1. Read ``?plan=<code>`` from the URL (set by the landing-page CTA).
 *   2. POST ``/api/v1/public/signup/tenant`` with tenant + admin.
 *   3. On 201 the backend already set the JWT cookies — navigate into
 *      the new tenant's admin dashboard.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
    sendPreSignupEmailOtp, sendPreSignupPhoneOtp, setUserFromOtpLogin,
    verifyPreSignupEmailOtp, verifyPreSignupPhoneOtp,
} from '../redux/authSlice';
import { setSnackbar } from '../../admin/redux/adminSharedUiSlice';
import { useSignupTenantMutation } from '../../admin/api/publicEndpoints';


/** Subdomain slug rules: lowercase alnum + hyphen, 3–50 chars, not edge-hyphen. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;


/** Per-channel OTP verification state. ``token`` is the signed proof
 * the backend's signup gate demands; editing the field voids it. */
const EMPTY_VERIF = {
    sent: false, sending: false, verifying: false, otp: '', token: null,
};

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
    // A tenant without a plan is not possible — signup only makes sense
    // AFTER a plan was picked on the pricing page, which links here with
    // ``?plan=<code>``. A bare /signup/tenant used to silently fall back
    // to a hardcoded 'plan1' (which need not even exist); now it bounces
    // to the pricing page instead. See the redirect effect below.
    const planCode = params.get('plan') || null;
    // "additional team members" picked on the plan card: "code:qty,..."
    const addonPicks = useMemo(() => (params.get('addons') || '')
        .split(',')
        .map((pair) => {
            const [code, q] = pair.split(':');
            const quantity = parseInt(q, 10);
            return code && quantity > 0 ? { code, quantity } : null;
        })
        .filter(Boolean), [params]);
    useEffect(() => {
        if (!planCode) navigate('/pricing', { replace: true });
    }, [planCode, navigate]);
    // The pricing CTA also passes ``&billing=`` — thread it through so
    // picking "annual" on the cards actually books an annual cycle.
    // Only the cycles a subscription can hold; anything else (or the
    // param's absence) lets the backend default to monthly.
    const billingParam = params.get('billing');
    const billingCycle = ['monthly', 'quarterly', 'semi_annual',
        'annual', 'biennial', 'triennial'].includes(billingParam)
        ? billingParam : null;

    const [form, setForm] = useState(INITIAL_FORM);
    const [fieldErrors, setFieldErrors] = useState({});
    // Set once the workspace exists. The page swaps the form for a
    // "what happens next" screen instead of vanishing into a redirect.
    const [signupResult, setSignupResult] = useState(null);
    const [verif, setVerif] = useState({
        phone: { ...EMPTY_VERIF }, email: { ...EMPTY_VERIF },
    });
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
        // A verified contact that then changes is no longer verified —
        // the backend would reject the stale token anyway, so void it
        // here and bring the Verify UI back.
        if (name === 'phone_number') {
            setVerif((v) => ({ ...v, phone: { ...EMPTY_VERIF } }));
        }
        if (name === 'email') {
            setVerif((v) => ({ ...v, email: { ...EMPTY_VERIF } }));
        }
        setForm((f) => ({ ...f, [name]: value }));
    }, []);

    const setOtp = useCallback((channel, value) => {
        const otp = value.replace(/\D/g, '').slice(0, 6);
        setVerif((v) => ({ ...v, [channel]: { ...v[channel], otp } }));
    }, []);

    const sendOtp = useCallback(async (channel) => {
        const field = channel === 'phone' ? 'phone_number' : 'email';
        setFieldErrors((prev) => {
            if (!prev[field]) return prev;
            const next = { ...prev }; delete next[field]; return next;
        });
        setVerif((v) => ({
            ...v, [channel]: { ...v[channel], sending: true },
        }));
        try {
            if (channel === 'phone') {
                await dispatch(sendPreSignupPhoneOtp({
                    phoneNumber: form.phone_number,
                    firstName: form.first_name || undefined,
                })).unwrap();
            } else {
                await dispatch(sendPreSignupEmailOtp({
                    email: form.email,
                    firstName: form.first_name || undefined,
                })).unwrap();
            }
            setVerif((v) => ({
                ...v, [channel]: { ...v[channel], sending: false, sent: true },
            }));
            dispatch(setSnackbar({
                open: true, severity: 'success',
                message: channel === 'phone'
                    ? 'Code sent by SMS.' : 'Code sent to your email.',
            }));
        } catch (err) {
            setVerif((v) => ({
                ...v, [channel]: { ...v[channel], sending: false },
            }));
            // Put it on the FIELD as well as the toast: "already
            // registered" is about that input, and a toast alone is easy
            // to miss (and used to be swallowed entirely on public pages).
            const message = err?.data?.error || err?.error || err?.message
                || 'Could not send the code.';
            setFieldErrors((prev) => ({
                ...prev,
                [channel === 'phone' ? 'phone_number' : 'email']: message,
            }));
            dispatch(setSnackbar({
                open: true, severity: 'error', message,
            }));
        }
    }, [dispatch, form.phone_number, form.email, form.first_name]);

    const verifyOtp = useCallback(async (channel) => {
        setVerif((v) => ({
            ...v, [channel]: { ...v[channel], verifying: true },
        }));
        try {
            const res = channel === 'phone'
                ? await dispatch(verifyPreSignupPhoneOtp({
                    phone_number: form.phone_number, otp: verif.phone.otp,
                })).unwrap()
                : await dispatch(verifyPreSignupEmailOtp({
                    email: form.email, otp: verif.email.otp,
                })).unwrap();
            setVerif((v) => ({
                ...v,
                [channel]: {
                    ...v[channel], verifying: false, token: res?.token || null,
                },
            }));
            setFieldErrors((prev) => ({
                ...prev,
                [channel === 'phone' ? 'phone_number' : 'email']: undefined,
            }));
        } catch (err) {
            setVerif((v) => ({
                ...v, [channel]: { ...v[channel], verifying: false },
            }));
            dispatch(setSnackbar({
                open: true, severity: 'error',
                message: err?.error || err?.message
                    || 'Wrong or expired code — try again.',
            }));
        }
    }, [dispatch, form.phone_number, form.email, verif.phone.otp,
        verif.email.otp]);

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
        // Contact-ownership proof: the backend refuses the signup
        // without these tokens, so fail fast with a field hint.
        if (!errs.phone_number && !verif.phone.token) {
            errs.phone_number = 'Verify this number with the SMS code.';
        }
        if (!errs.email && form.email && !verif.email.token) {
            errs.email = 'Verify this email with the code we send.';
        }
        setFieldErrors(errs);
        return Object.keys(errs).length === 0;
    }, [form, verif.phone.token, verif.email.token]);

    const handleSubmit = useCallback(async () => {
        if (!validate()) return;
        try {
            const result = await signup({
                plan_code: planCode,
                phone_verification_token: verif.phone.token,
                ...(form.email
                    ? { email_verification_token: verif.email.token } : {}),
                ...(billingCycle ? { billing_cycle: billingCycle } : {}),
                ...(addonPicks.length ? { addons: addonPicks } : {}),
                tenant: { name: form.tenant_name, slug: form.tenant_slug },
                admin: {
                    first_name: form.first_name,
                    last_name: form.last_name,
                    phone_number: form.phone_number,
                    email: form.email || null,
                    password: form.password,
                },
            }).unwrap();
            // The 201 body is the standard envelope; the payload lives
            // under ``data`` (tolerate either shape).
            const payload = result?.data || result || {};

            if (payload.seller === 'reseller') {
                // Apex-storefront funnel: the workspace lives on ITS OWN
                // subdomain and no session was minted here (cookies set on
                // this host wouldn't travel there). Hand the new admin to
                // their subdomain's login with the password they just chose.
                // The backend's login_host is authoritative — it knows
                // whether the child lives on the apex's own zone (P4) or
                // the platform base; the local derivation is only the
                // fallback for older responses.
                const slug = payload.tenant?.slug || form.tenant_slug;
                const base = import.meta.env?.VITE_PUBLIC_BASE_DOMAIN || 'localhost';
                const host = payload.login_host || `${slug}.${base}`;
                const port = window.location.port ? `:${window.location.port}` : '';
                setSignupResult({
                    tenantName: payload.tenant?.name || form.tenant_name,
                    workspaceUrl:
                        `${window.location.protocol}//${host}${port}`,
                    loginUrl:
                        `${window.location.protocol}//${host}${port}/auth/admin/login`,
                    trialEndsAt: payload.subscription?.trial_ends_at || null,
                    addonsAttached: payload.addons_attached || [],
                    needsLogin: true,
                });
                return;
            }

            // Hydrate Redux auth state so ProtectedRoute lets us in on the
            // same render. Backend already set the cookies; this just
            // mirrors the user object the rest of the app reads from.
            const user = payload.user || result?.user;
            if (user) dispatch(setUserFromOtpLogin({ user }));

            setSignupResult({
                tenantName: payload.tenant?.name || form.tenant_name,
                workspaceUrl: window.location.origin,
                loginUrl: payload.redirect_url
                    || result?.redirect_url
                    || '/dashboard/admin/getting-started',
                trialEndsAt: payload.subscription?.trial_ends_at || null,
                addonsAttached: payload.addons_attached || [],
                needsLogin: false,
            });
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
    }, [validate, signup, planCode, billingCycle, addonPicks, form, verif, dispatch,
        navigate]);

    const continueAfterSignup = useCallback(() => {
        if (!signupResult) return;
        if (signupResult.needsLogin) {
            window.location.assign(signupResult.loginUrl);
        } else {
            navigate(signupResult.loginUrl.startsWith('http')
                ? '/dashboard/admin/getting-started'
                : signupResult.loginUrl);
        }
    }, [signupResult, navigate]);

    return {
        signupResult, continueAfterSignup,
        planCode,
        form,
        setField,
        fieldErrors,
        handleSubmit,
        isSubmitting: isLoading,
        serverError: error?.data?.error || null,
        verif,
        sendOtp,
        setOtp,
        verifyOtp,
    };
};

export default useTenantSignup;
