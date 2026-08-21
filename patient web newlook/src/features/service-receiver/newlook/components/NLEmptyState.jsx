/** Port of the mobile MVP's ``EmptyState``. */
import { Box, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import { colors, typography } from '../theme/tokens';

const NLEmptyState = ({ icon, title, subtitle }) => (
    <Box
        sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            py: 4.5,
            px: 3,
            textAlign: 'center',
        }}
    >
        <NLIcon name={icon} size={36} color={colors.textMuted} />
        <Typography sx={{ ...typography.h3, mt: 1.25 }}>{title}</Typography>
        {subtitle ? (
            <Typography sx={{ ...typography.bodyMuted, mt: 0.5 }}>{subtitle}</Typography>
        ) : null}
    </Box>
);

export default NLEmptyState;
