/** Port of the mobile MVP's ``SectionHeader``. */
import { Box, Button, Typography } from '@mui/material';
import { colors, typography } from '../theme/tokens';

const NLSectionHeader = ({ title, subtitle, actionLabel, onAction, sx }) => (
    <Box
        sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1.5,
            mb: 1.5,
            ...sx,
        }}
    >
        <Box sx={{ flex: 1, pr: 1.5, minWidth: 0 }}>
            <Typography sx={typography.h2}>{title}</Typography>
            {subtitle ? (
                <Typography sx={{ ...typography.bodyMuted, mt: '2px' }}>{subtitle}</Typography>
            ) : null}
        </Box>
        {actionLabel ? (
            <Button
                onClick={onAction}
                sx={{
                    color: colors.primary,
                    fontSize: 13,
                    fontWeight: 600,
                    minWidth: 0,
                    px: 1,
                    flexShrink: 0,
                }}
            >
                {actionLabel}
            </Button>
        ) : null}
    </Box>
);

export default NLSectionHeader;
