/** Port of the mobile MVP's ``Badge`` — same six tones, same hex pairs. */
import { Box } from '@mui/material';
import { colors, radius } from '../theme/tokens';

const toneColors = {
    primary: { bg: '#E8F1FC', fg: colors.primaryDark },
    secondary: { bg: '#E3F5F3', fg: colors.secondaryDark },
    success: { bg: '#E8F5E9', fg: '#2e7d32' },
    warning: { bg: colors.warningLight, fg: colors.warningDark },
    error: { bg: '#FDECEA', fg: '#c62828' },
    neutral: { bg: '#EEF1F4', fg: colors.textSecondary },
};

const NLBadge = ({ label, tone = 'neutral', sx }) => {
    const c = toneColors[tone] || toneColors.neutral;
    return (
        <Box
            component="span"
            sx={{
                display: 'inline-block',
                px: '10px',
                py: '4px',
                borderRadius: `${radius.pill}px`,
                bgcolor: c.bg,
                color: c.fg,
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                ...sx,
            }}
        >
            {label}
        </Box>
    );
};

export default NLBadge;
