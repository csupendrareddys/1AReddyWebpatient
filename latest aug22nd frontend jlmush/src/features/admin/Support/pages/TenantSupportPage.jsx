/**
 * TenantSupportPage — the tenant admin's channel with their seller
 * (the vendor, or the parent apex for a child tenant), on the full
 * service-communication stack: chat + scheduled video/audio calls +
 * document exchange, exactly like the vendor holding chats.
 *
 * Reachable even while the tenant is SUSPENDED or INACTIVE — this
 * page is how they sort that out. Sub-admins need the
 * ``support_chat`` grant; the backend enforces the same.
 */
import { Alert, Box, Container, Paper, Typography } from '@mui/material';

import ChannelChat from '../../../communication/components/ChannelChat';
import ChannelDocumentsPanel from '../../../communication/components/ChannelDocumentsPanel';
import ScheduledCallsPanel from '../../../communication/components/ScheduledCallsPanel';
import { useGetServiceChannelQuery } from '../../api/serviceCommunicationEndpoints';
import { useGetMySupportChannelQuery } from '../../api/supportEndpoints';

const TenantSupportPage = () => {
    const boot = useGetMySupportChannelQuery();
    const channelId = boot.data?.channel_id;
    const channelQ = useGetServiceChannelQuery(channelId, { skip: !channelId });
    const channel = channelQ.data;

    const denied = boot.error?.status === 403;

    return (
        <Container maxWidth="md" sx={{ py: 3 }}>
            <Typography variant="h5" sx={{ mb: 0.5 }}>Support</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Talk to {boot.data?.seller_name || 'your provider'} — chat,
                share documents, or get on a call. Billing, reactivation,
                anything about your workspace.
            </Typography>
            {denied && (
                <Alert severity="warning">
                    Support chat is not included in your role. Ask a
                    super-admin to grant it.
                </Alert>
            )}
            {!denied && boot.error && (
                <Alert severity="error">
                    Could not open the support conversation — try refreshing.
                </Alert>
            )}
            {channel && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                    <ScheduledCallsPanel channel={channel} />
                    <Box sx={{ height: '52vh', display: 'flex', my: 1 }}>
                        <ChannelChat channel={channel} />
                    </Box>
                    <ChannelDocumentsPanel channel={channel} />
                </Paper>
            )}
        </Container>
    );
};

export default TenantSupportPage;
