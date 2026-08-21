/**
 * Patient login (new look) — port of the mobile MVP's ``(auth)/welcome.tsx`` +
 * ``(auth)/signin.tsx`` as one screen: the onboarding value props on the left,
 * the sign-in card on the right (stacked on a phone, exactly like the app).
 *
 * Wired to the REAL auth: the same ``login`` thunk and role-routing the classic
 * login page uses, so a session from here is indistinguishable from one made
 * there. OTP sign-in, signup and forgot-password are real multi-step flows that
 * already exist — this page links to them rather than forking them.
 */
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    Alert, Box, Button, IconButton, InputAdornment, TextField, Typography,
} from '@mui/material';
import NLIcon from '../../components/NLIcon';
import { login } from '../../../../auth/redux/authSlice';
import { colors, radius, tint, typography } from '../../theme/tokens';

/** The mobile welcome screen's three slides, verbatim. */
const SLIDES = [
    {
        icon: 'medkit-outline',
        title: 'Care without the commute',
        body: 'Consult trusted doctors from home — no waiting rooms, no travel.',
    },
    {
        icon: 'videocam-outline',
        title: 'Video, audio or chat',
        body: 'Pick the consultation that fits your day.',
    },
    {
        icon: 'documents-outline',
        title: 'Everything in one place',
        body: 'Prescriptions, lab reports and your whole family, on one account.',
    },
];

/** Same role → dashboard map as the classic login, so no role dead-ends here. */
const DASHBOARDS = {
    patient: '/dashboard/patient/newlook',
    doctor: '/dashboard/doctor',
    pharmacy: '/dashboard/pharmacy',
    diagnosis: '/dashboard/diagnosis',
    clinic: '/dashboard/clinic',
    hospital: '/dashboard/hospital',
    provider_staff: '/dashboard/staff',
    patient_staff: '/dashboard/patient-staff',
    super_admin: '/dashboard/admin',
    sub_admin: '/dashboard/admin',
};

const NLLogin = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { isLoading } = useSelector((state) => state.auth);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState(null);

    const submit = async (e) => {
        e.preventDefault();
        setError(null);
        const id = username.trim();
        if (!id || !password) {
            setError('Enter your email or phone, and your password.');
            return;
        }
        // Same identifier detection the classic page uses.
        const payload = { password };
        if (/^[6-9]\d{9}$/.test(id.replace(/\s/g, ''))) payload.phone_number = id.replace(/\s/g, '');
        else payload.email = id;
        try {
            const result = await dispatch(login(payload)).unwrap();
            navigate(DASHBOARDS[result?.user?.role] || '/dashboard/patient/newlook');
        } catch (err) {
            // The session-limit dialog is handled globally in App.jsx.
            setError(err?.message || err?.error || 'Sign in failed. Check your details and try again.');
        }
    };

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                bgcolor: colors.background,
            }}
        >
            {/* ── The mobile welcome screen, as the left panel ─────────── */}
            <Box
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 3,
                    p: { xs: 3, md: 6 },
                    color: colors.white,
                    background: `linear-gradient(150deg, ${colors.primary}, ${colors.secondary})`,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                        sx={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            bgcolor: colors.white,
                        }}
                    />
                    <Typography sx={{ fontSize: 18, fontWeight: 800 }}>Healthcare</Typography>
                </Box>
                <Typography sx={{ fontSize: { xs: 26, md: 34 }, fontWeight: 800, lineHeight: 1.2 }}>
                    Your doctors, records and family&apos;s care — one account.
                </Typography>
                {SLIDES.map((sl) => (
                    <Box key={sl.title} sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start' }}>
                        <Box
                            sx={{
                                width: 42,
                                height: 42,
                                borderRadius: '50%',
                                bgcolor: 'rgba(255,255,255,0.18)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <NLIcon name={sl.icon} size={20} color={colors.white} />
                        </Box>
                        <Box>
                            <Typography sx={{ fontSize: 15.5, fontWeight: 700 }}>{sl.title}</Typography>
                            <Typography sx={{ fontSize: 13, opacity: 0.9 }}>{sl.body}</Typography>
                        </Box>
                    </Box>
                ))}
            </Box>

            {/* ── The mobile sign-in screen, as the right panel ────────── */}
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    p: { xs: 2.5, md: 6 },
                }}
            >
                <Box
                    component="form"
                    onSubmit={submit}
                    sx={{
                        width: '100%',
                        maxWidth: 420,
                        bgcolor: colors.surface,
                        borderRadius: `${radius.lg}px`,
                        border: `1px solid ${colors.border}`,
                        p: { xs: 2.5, md: 3.5 },
                    }}
                >
                    <Box
                        sx={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            bgcolor: tint(colors.primary, 0.1),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            mx: 'auto',
                            mb: 1.5,
                        }}
                    >
                        <NLIcon name="person-outline" size={26} color={colors.primary} />
                    </Box>
                    <Typography sx={{ ...typography.h1, textAlign: 'center' }}>
                        Welcome back
                    </Typography>
                    <Typography sx={{ ...typography.bodyMuted, textAlign: 'center', mb: 3 }}>
                        Sign in to manage appointments, records, and your care team.
                    </Typography>

                    {error ? (
                        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
                            {error}
                        </Alert>
                    ) : null}

                    <Typography sx={{ ...typography.label, mb: 0.75 }}>EMAIL OR PHONE</Typography>
                    <TextField
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="you@example.com"
                        size="small"
                        fullWidth
                        autoComplete="username"
                        sx={{ mb: 2 }}
                    />

                    <Typography sx={{ ...typography.label, mb: 0.75 }}>PASSWORD</Typography>
                    <TextField
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        type={showPw ? 'text' : 'password'}
                        size="small"
                        fullWidth
                        autoComplete="current-password"
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        size="small"
                                        onClick={() => setShowPw((v) => !v)}
                                        aria-label={showPw ? 'Hide password' : 'Show password'}
                                    >
                                        <NLIcon name="eye-outline" size={18} color={colors.textSecondary} />
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }}
                    />

                    <Box sx={{ textAlign: 'right', mt: 0.75, mb: 2 }}>
                        <Button size="small" onClick={() => navigate('/auth/forgot-password')}>
                            Forgot password?
                        </Button>
                    </Box>

                    <Button
                        type="submit"
                        variant="contained"
                        fullWidth
                        disabled={isLoading}
                        sx={{ height: 48, fontSize: 15, fontWeight: 700 }}
                    >
                        {isLoading ? 'Signing in…' : 'Sign in'}
                    </Button>

                    {/* OTP is a real multi-step flow on the classic page. */}
                    <Button
                        fullWidth
                        sx={{ mt: 1.5 }}
                        startIcon={<NLIcon name="chatbubble-outline" size={15} />}
                        onClick={() => navigate('/auth/service-receiver/login')}
                    >
                        Sign in with OTP instead
                    </Button>

                    <Box sx={{ textAlign: 'center', mt: 2 }}>
                        <Typography component="span" sx={typography.bodyMuted}>
                            New patient?{' '}
                        </Typography>
                        <Button size="small" onClick={() => navigate('/auth/service-receiver/signup')}>
                            Create an account
                        </Button>
                    </Box>
                    <Box sx={{ textAlign: 'center', mt: 0.5 }}>
                        <Button
                            size="small"
                            sx={{ color: colors.textMuted }}
                            onClick={() => window.open('/terms-and-conditions', '_blank', 'noopener')}
                        >
                            Terms &amp; Conditions
                        </Button>
                    </Box>
                </Box>
            </Box>
        </Box>
    );
};

export default NLLogin;
