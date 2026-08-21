/**
 * Port of the mobile MVP's ``StatTile``.
 *
 * The chevron appears only on a tile that actually goes somewhere — the mobile
 * comment calls this "honest affordance", and it survives the port.
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import { cardSx, colors, tint } from '../theme/tokens';

const NLStatTile = ({ icon, label, value, tint: tone = colors.primary, onClick }) => {
    const body = (
        <Box
            sx={{
                ...cardSx,
                flex: 1,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 0.75,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    alignSelf: 'stretch',
                }}
            >
                <Box
                    sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        bgcolor: tint(tone, 0.1),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <NLIcon name={icon} size={18} color={tone} />
                </Box>
                {onClick ? <NLIcon name="chevron-forward" size={14} color={colors.textMuted} /> : null}
            </Box>
            <Typography sx={{ fontSize: 18, fontWeight: 700, color: colors.textPrimary }}>
                {value}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: colors.textSecondary }}>{label}</Typography>
        </Box>
    );

    if (!onClick) return body;
    return (
        <ButtonBase
            onClick={onClick}
            sx={{
                flex: 1,
                textAlign: 'left',
                borderRadius: '12px',
                alignItems: 'stretch',
                transition: 'box-shadow .18s, transform .18s',
                '&:hover': { boxShadow: '0 6px 18px rgba(15, 27, 45, 0.10)' },
            }}
        >
            {body}
        </ButtonBase>
    );
};

export default NLStatTile;
