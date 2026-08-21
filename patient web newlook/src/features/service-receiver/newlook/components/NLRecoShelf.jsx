/**
 * One recommendation shelf — port of the mobile MVP's ``RecoShelf``: a tinted
 * heading, the four-way view switcher, and a way into the full list, so every
 * shelf on the dashboard behaves identically.
 *
 * Sliding is the default because it holds the whole list in two lines; list,
 * grid and table are for comparing rather than glancing, and cap themselves so
 * one shelf can't push the rest of the page off screen.
 */
import { useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import NLItemViews from './NLItemViews';
import NLViewSwitcher from './NLViewSwitcher';
import { clamp, colors, radius, tint, typography } from '../theme/tokens';

/** A static view shows this many before deferring to the full list. */
const STATIC_CAP = 4;

const NLRecoShelf = ({
    title, subtitle, icon = 'sparkles-outline', tint: tone = colors.primary,
    items = [], intervalSec = 20, onPress, onSeeAll, seeAllLabel = 'View all',
    showPrice = true,
}) => {
    const [mode, setMode] = useState('slide');

    if (!items.length) return null;
    const shown = mode === 'slide' ? items : items.slice(0, STATIC_CAP);
    const hidden = items.length - shown.length;

    return (
        <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mb: 1.25 }}>
                <Box
                    sx={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        bgcolor: tint(tone, 0.1),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <NLIcon name={icon} size={16} color={tone} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ ...typography.h2, ...clamp(2) }}>{title}</Typography>
                    {subtitle ? (
                        <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>
                            {subtitle}
                        </Typography>
                    ) : null}
                </Box>
                {onSeeAll ? (
                    <ButtonBase
                        onClick={onSeeAll}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '2px',
                            pt: '3px',
                            flexShrink: 0,
                            color: colors.primary,
                            fontSize: 13,
                            fontWeight: 700,
                        }}
                    >
                        {seeAllLabel}
                        <NLIcon name="chevron-forward" size={13} color={colors.primary} />
                    </ButtonBase>
                ) : null}
            </Box>

            <NLViewSwitcher
                mode={mode}
                onChange={setMode}
                hint={mode === 'slide'
                    ? `Swipe · auto every ${intervalSec}s`
                    : `${shown.length} of ${items.length}`}
            />

            <NLItemViews
                mode={mode}
                intervalSec={intervalSec}
                showPrice={showPrice}
                tableTypeLabel="Type"
                items={shown}
                onPress={onPress}
            />

            {/* A capped static view must say what it's hiding, or it reads as
                the whole shelf. */}
            {mode !== 'slide' && hidden > 0 && onSeeAll ? (
                <ButtonBase
                    onClick={onSeeAll}
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        width: '100%',
                        mt: 1.25,
                        py: '11px',
                        borderRadius: `${radius.sm}px`,
                        bgcolor: colors.background,
                        color: colors.primary,
                        fontSize: 12.5,
                        fontWeight: 700,
                    }}
                >
                    View all {items.length}
                    <NLIcon name="arrow-forward" size={14} color={colors.primary} />
                </ButtonBase>
            ) : null}
        </Box>
    );
};

export default NLRecoShelf;
