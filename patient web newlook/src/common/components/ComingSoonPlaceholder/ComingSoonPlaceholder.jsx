/**
 * ComingSoonPlaceholder — a lightweight, honest placeholder for navigation
 * entries that are reserved in the UI but not yet functional. Keeps the sidebar
 * item real (routes cleanly) while making it clear the feature is upcoming.
 */
import { Box, Typography, Paper, Chip, Stack } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

const ComingSoonPlaceholder = ({ title, description, tabs = [] }) => (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>{title}</Typography>
        {tabs.length > 0 && (
            <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
                {tabs.map((t) => <Chip key={t} label={t} variant="outlined" />)}
            </Stack>
        )}
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderStyle: 'dashed' }}>
            <ConstructionIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>Coming soon</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480, mx: 'auto' }}>
                {description || 'This section is reserved and will be available soon.'}
            </Typography>
        </Paper>
    </Box>
);

export default ComingSoonPlaceholder;
