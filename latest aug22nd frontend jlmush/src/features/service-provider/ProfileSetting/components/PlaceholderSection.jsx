/**
 * PlaceholderSection — "Coming Soon" placeholder for unimplemented attendance sections.
 */
import { Box, Paper, Typography } from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

const PlaceholderSection = ({ title, description }) => (
    <Paper sx={{ p: 6, textAlign: 'center' }}>
        <ConstructionIcon sx={{ fontSize: 64, color: 'grey.400', mb: 2 }} />
        <Typography variant="h5" fontWeight={600} color="text.secondary" gutterBottom>
            {title}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500, mx: 'auto' }}>
            {description || 'This section is under development and will be available soon.'}
        </Typography>
    </Paper>
);

export default PlaceholderSection;
