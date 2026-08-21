/**
 * The four-way view control used by every shelf and list on the new-look
 * screens — port of the mobile MVP's ``ViewSwitcher``.
 *
 * It lives in one place so the control is identical wherever it appears: a
 * toggle that looks the same but behaves differently from screen to screen is
 * worse than having no toggle at all.
 */
import { Box, ButtonBase, Tooltip, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import { colors, radius } from '../theme/tokens';

export const MODES4 = [
    { key: 'slide', icon: 'albums-outline', label: 'Sliding view' },
    { key: 'list', icon: 'reorder-four-outline', label: 'List view' },
    { key: 'grid', icon: 'grid-outline', label: 'Grid view' },
    { key: 'table', icon: 'list-outline', label: 'Table view' },
];

const NLViewSwitcher = ({ mode, onChange, hint, modes, inline, sx }) => {
    const shown = modes ? MODES4.filter((m) => modes.includes(m.key)) : MODES4;

    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                mb: inline ? 0 : 1.5,
                flexWrap: 'wrap',
                ...sx,
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    bgcolor: colors.surface,
                    borderRadius: `${radius.sm}px`,
                    border: `1px solid ${colors.border}`,
                    p: '3px',
                    gap: '2px',
                }}
            >
                {shown.map((m) => {
                    const active = mode === m.key;
                    return (
                        <Tooltip key={m.key} title={m.label} arrow>
                            <ButtonBase
                                onClick={() => onChange(m.key)}
                                aria-label={m.label}
                                aria-pressed={active}
                                sx={{
                                    px: '9px',
                                    py: '5px',
                                    borderRadius: `${radius.sm - 2}px`,
                                    bgcolor: active ? colors.primary : 'transparent',
                                    '&:hover': { bgcolor: active ? colors.primary : colors.background },
                                }}
                            >
                                <NLIcon
                                    name={m.icon}
                                    size={14}
                                    color={active ? colors.white : colors.textSecondary}
                                />
                            </ButtonBase>
                        </Tooltip>
                    );
                })}
            </Box>
            {hint ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                    {mode === 'slide' ? (
                        <NLIcon name="swap-horizontal-outline" size={12} color={colors.textMuted} />
                    ) : null}
                    <Typography
                        sx={{ fontSize: 11, fontWeight: 600, color: colors.textMuted }}
                        noWrap
                    >
                        {hint}
                    </Typography>
                </Box>
            ) : null}
        </Box>
    );
};

export default NLViewSwitcher;
