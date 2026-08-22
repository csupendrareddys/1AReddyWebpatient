/**
 * SellerSupportInbox — the seller half of the support channel, shared
 * by the vendor console (scope='platform': direct tenants) and the
 * apex console (scope='reseller': children). Threads on the left; the
 * selected conversation on the right is the FULL channel stack —
 * chat, documents, scheduled video/audio calls.
 *
 * While a thread is open, service-communication requests carry the
 * customer tenant's slug (setSupportTenantOverride) so the backend
 * resolves the right tenant; the seller sits on the channel as a real
 * participant (operator seat), so membership is the permission.
 */
import { useEffect, useState } from 'react';
import {
    Alert, Badge, Box, Container, Divider, List, ListItemButton,
    ListItemText, Paper, Stack, Typography,
} from '@mui/material';

import { setSupportTenantOverride } from '../../../../api/axiosConfig';
import { useListPlatformTenantsQuery } from '../../api/platformEndpoints';
import { useListResellerTenantsQuery } from '../../Reseller/api/resellerEndpoints';
import ChannelChat from '../../../communication/components/ChannelChat';
import ChannelDocumentsPanel from '../../../communication/components/ChannelDocumentsPanel';
import ScheduledCallsPanel from '../../../communication/components/ScheduledCallsPanel';
import { useGetServiceChannelQuery } from '../../api/serviceCommunicationEndpoints';
import {
    useListChildSupportThreadsQuery,
    useListSupportThreadsQuery,
    useOpenChildSupportChannelMutation,
    useOpenSupportChannelMutation,
} from '../../api/supportEndpoints';

const SellerSupportInbox = ({ scope = 'platform' }) => {
    const isPlatform = scope === 'platform';
    // {tenantId, slug, channelId} of the open conversation.
    const [active, setActive] = useState(null);

    const platformThreads = useListSupportThreadsQuery(undefined, { skip: !isPlatform, pollingInterval: 15000 });
    const resellerThreads = useListChildSupportThreadsQuery(undefined, { skip: isPlatform, pollingInterval: 15000 });
    const threadsQ = isPlatform ? platformThreads : resellerThreads;
    const threads = threadsQ.data || [];

    const [openPlatform] = useOpenSupportChannelMutation();
    const [openReseller] = useOpenChildSupportChannelMutation();

    // "New conversation": every tenant this seller could talk to, so a
    // thread can start from THIS side too (the open endpoint
    // get-or-creates the channel; the tenant sees it on their end).
    const platformTenants = useListPlatformTenantsQuery(undefined, { skip: !isPlatform });
    const resellerTenants = useListResellerTenantsQuery(undefined, { skip: isPlatform });
    const startables = (isPlatform
        ? (platformTenants.data || []).filter((t) => !t.is_platform)
        : (resellerTenants.data || []))
        .filter((t) => !threads.some((th) => th.tenant_id === (t.id || t.tenant_id)));

    // The override must be live BEFORE the channel query fires, and
    // must be cleared whenever the conversation closes or the page
    // unmounts — other console requests keep the seller's own context
    // either way (the override only touches /service-communication).
    useEffect(() => {
        setSupportTenantOverride(active?.slug || null);
        return () => setSupportTenantOverride(null);
    }, [active?.slug]);

    const channelQ = useGetServiceChannelQuery(active?.channelId, {
        skip: !active?.channelId,
    });
    const channel = channelQ.data;

    const pick = async (t) => {
        try {
            const opened = isPlatform
                ? await openPlatform(t.tenant_id).unwrap()
                : await openReseller(t.tenant_id).unwrap();
            setActive({
                tenantId: t.tenant_id,
                slug: opened.tenant_slug,
                channelId: opened.channel_id,
                name: opened.tenant_name,
            });
        } catch {
            setActive(null);
        }
    };

    return (
        <Container maxWidth="lg" sx={{ py: 3 }}>
            <Typography variant="h5" sx={{ mb: 0.5 }}>Support inbox</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {isPlatform
                    ? 'Conversations with your tenants — chat, documents and calls. Suspended workspaces asking to pay land here.'
                    : 'Conversations with the tenants you operate.'}
            </Typography>
            {threadsQ.error && (
                <Alert severity={threadsQ.error?.status === 403 ? 'warning' : 'error'}>
                    {threadsQ.error?.status === 403
                        ? 'Support chat is not included in your role.'
                        : 'Failed to load support threads.'}
                </Alert>
            )}
            {!threadsQ.error && (
                <Paper variant="outlined" sx={{ display: 'flex', minHeight: '70vh' }}>
                    <Box sx={{ width: 300, borderRight: 1, borderColor: 'divider', overflowY: 'auto' }}>
                        {threads.length === 0 && !threadsQ.isLoading && (
                            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                                No conversations yet. A thread appears when a
                                tenant opens Support — or pick one up from a
                                tenant page.
                            </Typography>
                        )}
                        {startables.length > 0 && (
                            <Box sx={{ p: 1, borderBottom: 1, borderColor: 'divider' }}>
                                <select
                                    aria-label="New conversation"
                                    style={{ width: '100%', padding: 6 }}
                                    value=""
                                    onChange={(e) => {
                                        const id = e.target.value;
                                        if (id) pick({ tenant_id: id });
                                    }}
                                >
                                    <option value="">New conversation…</option>
                                    {startables.map((t) => (
                                        <option key={t.id || t.tenant_id}
                                            value={t.id || t.tenant_id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </select>
                            </Box>
                        )}
                        <List dense disablePadding>
                            {threads.map((t) => (
                                <ListItemButton
                                    key={t.tenant_id}
                                    selected={active?.tenantId === t.tenant_id}
                                    onClick={() => pick(t)}
                                    divider
                                >
                                    <ListItemText
                                        primary={(
                                            <Stack direction="row" spacing={1.5} alignItems="center">
                                                <span>{t.tenant_name}</span>
                                                {t.unread > 0 && (
                                                    <Badge color="error" badgeContent={t.unread} />
                                                )}
                                            </Stack>
                                        )}
                                        secondary={t.last_message?.body || null}
                                        secondaryTypographyProps={{ noWrap: true }}
                                    />
                                </ListItemButton>
                            ))}
                        </List>
                    </Box>
                    <Divider orientation="vertical" flexItem />
                    <Box sx={{ flex: 1, p: 2, overflowY: 'auto' }}>
                        {!active && (
                            <Typography variant="body2" color="text.secondary" sx={{ m: 'auto', mt: 8, textAlign: 'center' }}>
                                Pick a conversation on the left.
                            </Typography>
                        )}
                        {active && channel && (
                            <>
                                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                                    {active.name}
                                </Typography>
                                <ScheduledCallsPanel channel={channel} />
                                <Box sx={{ height: '46vh', display: 'flex', my: 1 }}>
                                    <ChannelChat channel={channel} />
                                </Box>
                                <ChannelDocumentsPanel channel={channel} />
                            </>
                        )}
                    </Box>
                </Paper>
            )}
        </Container>
    );
};

export default SellerSupportInbox;
