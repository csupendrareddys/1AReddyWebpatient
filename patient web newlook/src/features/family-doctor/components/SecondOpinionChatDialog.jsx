/**
 * SecondOpinionChatDialog — opens the family-doctor second-opinion conversation
 * as an inline popup (instead of navigating away to My Services). Reuses the
 * exact same ChannelChat + ScheduledCallsPanel used on the My Services page, so
 * chat (max 5 messages) and calls (doctor schedules, patient proposes, ≤5 min)
 * behave identically here.
 */
import {
    Box, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { useGetServiceChannelQuery } from '../../service-provider/api/scopedDoctorApi';
import ChannelChat from '../../communication/components/ChannelChat';
import ScheduledCallsPanel from '../../communication/components/ScheduledCallsPanel';

export default function SecondOpinionChatDialog({ channelId, open, onClose }) {
    const { data: channel, isLoading } = useGetServiceChannelQuery(channelId, {
        skip: !open || !channelId,
    });

    return (
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm"
            PaperProps={{ sx: { height: '80vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', py: 1.5 }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    Second opinion
                    <Typography variant="caption" color="text.secondary" display="block">
                        Chat up to 5 messages · calls up to 5 minutes
                    </Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
                {isLoading || !channel ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', flex: 1, alignItems: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                        <ScheduledCallsPanel channel={channel} />
                        <Box sx={{ flex: 1, minHeight: 0 }}>
                            <ChannelChat channel={channel} />
                        </Box>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}
