/**
 * QuotaCard — "how many tenants can I still create" header for the
 * reseller pages. Reads the live /admin/reseller/quota summary; the
 * create-tenant mutation invalidates it so the numbers move without a
 * refresh.
 */
import {
    Box, Card, CardContent, LinearProgress, Stack, Typography,
} from '@mui/material';

import { useGetResellerQuotaQuery } from '../api/resellerEndpoints';

function QuotaBar({ label, used, allowed, note }) {
    const pct = allowed > 0 ? Math.min(100, (used / allowed) * 100) : 0;
    return (
        <Box sx={{ minWidth: 220 }}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                <Typography variant="body2" fontWeight={600}>{label}</Typography>
                <Typography variant="body2" color="text.secondary">
                    {used} / {allowed}
                </Typography>
            </Stack>
            <LinearProgress
                variant="determinate"
                value={pct}
                color={used >= allowed ? 'error' : 'primary'}
                sx={{ height: 8, borderRadius: 4 }}
            />
            {note && (
                <Typography variant="caption" color="text.secondary">
                    {note}
                </Typography>
            )}
        </Box>
    );
}

export default function QuotaCard() {
    const { data: quota } = useGetResellerQuotaQuery();
    if (!quota?.is_apex) return null;
    const sub = quota.quotas?.subdomains || { used: 0, allowed: 0 };
    const dom = quota.quotas?.custom_domains || { used: 0, allowed: 0 };
    return (
        <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={4}
                    alignItems={{ sm: 'center' }}
                >
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="subtitle1" fontWeight={700}>
                            Reseller quota
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Tenant slots included in your plan. Need more? Contact
                            your provider about an upgrade.
                        </Typography>
                    </Box>
                    <QuotaBar label="Tenants (subdomains)"
                              used={sub.used} allowed={sub.allowed} />
                    <QuotaBar label="Custom domains"
                              used={dom.used} allowed={dom.allowed}
                              note="Domains your tenants attach to their sites" />
                </Stack>
            </CardContent>
        </Card>
    );
}
