/**
 * NLMenuRow — port of the mobile MVP's ``MenuRow``.
 *
 * The row the Records / Money / Account hubs are built from: a tinted glyph, a
 * title, a line of explanation, an optional live value on the right, and a
 * chevron. One row design across all three hubs, as in the mobile app.
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import NLBadge from './NLBadge';
import { clamp, colors, tint, typography } from '../theme/tokens';

const NLMenuRow = ({
    icon, title, subtitle, value, badge, badgeTone = 'neutral',
    tint: tone = colors.primary, onClick, disabled, last,
}) => (
    <ButtonBase
        onClick={onClick}
        disabled={disabled || !onClick}
        sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            width: '100%',
            px: '12px',
            py: '13px',
            textAlign: 'left',
            borderBottom: last ? 'none' : `1px solid ${colors.border}`,
            opacity: disabled ? 0.55 : 1,
            '&:hover': onClick && !disabled ? { bgcolor: colors.background } : undefined,
        }}
    >
        <Box
            sx={{
                width: 38,
                height: 38,
                borderRadius: '50%',
                bgcolor: tint(tone, 0.1),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
            }}
        >
            <NLIcon name={icon} size={19} color={tone} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary }}>
                    {title}
                </Typography>
                {badge ? <NLBadge label={badge} tone={badgeTone} /> : null}
            </Box>
            {subtitle ? (
                <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>{subtitle}</Typography>
            ) : null}
        </Box>
        {/* A live figure earns its place on the row — it saves opening the page
            just to read one number. */}
        {value != null && value !== '' ? (
            <Typography
                sx={{ fontSize: 14, fontWeight: 700, color: tone, flexShrink: 0, ml: 1 }}
            >
                {value}
            </Typography>
        ) : null}
        {onClick && !disabled
            ? <NLIcon name="chevron-forward" size={16} color={colors.textMuted} />
            : null}
    </ButtonBase>
);

export default NLMenuRow;
