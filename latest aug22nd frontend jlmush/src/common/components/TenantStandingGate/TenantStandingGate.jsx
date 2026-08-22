/**
 * TenantStandingGate + HoldingPage — the whole-site wall for tenants
 * that are suspended (unpaid past grace) or inactive (switched off by
 * their seller), at every level: vendor's tenants and apex children
 * alike, since standing comes from the request host's tenant.
 *
 * The gate asks /public/tenant-standing once per load. ``suspended``
 * and ``inactive`` replace every page with the holding screen EXCEPT
 * the auth pages and the admin dashboard — the administrator must
 * still sign in and pay (or read the seller's answer). Errors and the
 * loading window fail OPEN: a network hiccup must never take a healthy
 * clinic offline.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Alert, Box, Button, Container, Link, Paper, Stack, Typography,
} from '@mui/material';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';

import axiosInstance from '../../../api/axiosConfig';

// The admin must reach these while the site is held: sign-in, the
// admin dashboard (billing / support live there), and the forced
// password screen.
const ALLOWED_PREFIXES = ['/auth', '/dashboard/admin', '/book/set-password', '/service-call'];

export const HoldingPage = ({ standing }) => {
    const suspended = standing.standing === 'suspended';
    const seller = standing.seller?.name || 'your provider';
    const purge = standing.data_purge_after
        ? standing.data_purge_after.slice(0, 10) : null;

    return (
        <Box sx={{
            minHeight: '100vh', display: 'flex', flexDirection: 'column',
            bgcolor: 'grey.100',
        }}>
            <Container maxWidth="sm" sx={{ my: 'auto', py: 6 }}>
                <Paper elevation={3} sx={{ p: { xs: 3, md: 5 }, textAlign: 'center', borderRadius: 3 }}>
                    <Stack spacing={2} alignItems="center">
                        {suspended
                            ? <PauseCircleOutlineIcon color="warning" sx={{ fontSize: 56 }} />
                            : <ReportGmailerrorredIcon color="error" sx={{ fontSize: 56 }} />}
                        <Typography variant="h5" sx={{ fontWeight: 700 }}>
                            {suspended
                                ? 'This account is suspended'
                                : 'This account is inactive'}
                        </Typography>
                        {suspended ? (
                            <>
                                <Typography color="text.secondary">
                                    The subscription payment is overdue, so all
                                    services on this site are paused. An
                                    administrator can sign in and complete the
                                    payment to bring everything back instantly.
                                </Typography>
                                {purge && (
                                    <Alert severity="warning" sx={{ textAlign: 'left' }}>
                                        Your data is kept safe until{' '}
                                        <b>{purge}</b>. After that it is moved
                                        to archive storage and this address is
                                        released.
                                    </Alert>
                                )}
                                <Button
                                    variant="contained" size="large"
                                    href="/auth/admin/login"
                                >
                                    Sign in & pay to continue
                                </Button>
                            </>
                        ) : (
                            <>
                                <Typography color="text.secondary">
                                    This workspace was deactivated by{' '}
                                    <b>{seller}</b>. To reactivate it, contact
                                    them — support chat is available to your
                                    administrators from the admin dashboard.
                                </Typography>
                                <Button
                                    variant="contained" size="large"
                                    href="/auth/admin/login"
                                >
                                    Administrator sign in
                                </Button>
                            </>
                        )}
                    </Stack>
                </Paper>
            </Container>
            <Box component="footer" sx={{ py: 2, textAlign: 'center' }}>
                <Link href="/auth/admin/login" underline="hover"
                    color="text.secondary" variant="body2">
                    Admin login
                </Link>
            </Box>
        </Box>
    );
};

const TenantStandingGate = ({ children }) => {
    const location = useLocation();
    const [standing, setStanding] = useState(null);

    useEffect(() => {
        let alive = true;
        const fetchStanding = () => {
            axiosInstance.get('/api/v1/public/tenant-standing')
                .then((res) => {
                    if (alive) setStanding(res?.data?.data || null);
                })
                .catch(() => { /* keep last known standing */ });
        };
        fetchStanding();
        // The wall must LIFT when the admin pays: re-check on focus and
        // on a slow poll, so a payment in another tab frees this one.
        window.addEventListener('focus', fetchStanding);
        const timer = setInterval(fetchStanding, 60000);
        return () => {
            alive = false;
            window.removeEventListener('focus', fetchStanding);
            clearInterval(timer);
        };
    }, []);

    const held = standing
        && ['suspended', 'inactive'].includes(standing.standing);
    const allowedPath = ALLOWED_PREFIXES.some(
        (p) => location.pathname.startsWith(p));

    if (held && !allowedPath) return <HoldingPage standing={standing} />;
    return children;
};

export default TenantStandingGate;
