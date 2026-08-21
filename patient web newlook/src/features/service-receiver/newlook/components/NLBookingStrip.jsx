/**
 * A dashboard shelf of bookings — Upcoming, In progress — port of the mobile
 * MVP's ``BookingStrip``, with the same view switcher the rest of the new-look
 * screens use so every shelf on the page behaves identically.
 *
 * Sliding is the default because it holds the whole list in two lines; list,
 * grid and table are for comparing rather than glancing, and cap themselves so
 * one shelf can't push the rest of the page off screen.
 *
 * ADAPTED FROM MOBILE: the mobile strip breaks the household total down by
 * family member (You 3 · Minors 1). The API doesn't return whose booking each
 * row is, so rather than invent that, the breakdown says what the total is made
 * OF by product type (Consultations 3 · Services 1) — same shape, same purpose,
 * real numbers. Each row's live status rides where the owner line used to,
 * which is what makes "Pending payment" visible inside Upcoming.
 */
import { useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import NLCard from './NLCard';
import NLBadge from './NLBadge';
import NLIcon from './NLIcon';
import NLTwoRowSlider from './NLTwoRowSlider';
import NLViewSwitcher from './NLViewSwitcher';
import { clamp, colors, radius, tint, typography } from '../theme/tokens';

/** A static view shows this many before deferring to the full list. */
const STATIC_CAP = 4;

const GRID_COLUMNS = { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' };

const toCard = (r) => ({
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    meta: r.meta,
    badge: r.statusLabel || r.kindLabel,
    icon: r.icon,
    tint: r.tint,
});

const NLBookingStrip = ({
    title,
    subtitle,
    items = [],
    emptyText,
    onSeeAll,
    onItemPress,
    initialMode = 'slide',
    breakdown = [],
    intervalSec = 22,
}) => {
    const [mode, setMode] = useState(initialMode);

    const shown = mode === 'slide' ? items : items.slice(0, STATIC_CAP);
    const hidden = items.length - shown.length;

    const statusLine = (r) => (r.statusLabel ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mt: '3px' }}>
            <NLIcon name="time-outline" size={11} color={colors.textMuted} />
            <Typography
                sx={{ fontSize: 11, fontWeight: 600, color: colors.textMuted, ...clamp(1) }}
            >
                {r.statusLabel}
            </Typography>
        </Box>
    ) : null);

    return (
        <Box sx={{ mt: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25, mb: 1.25 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={typography.h2}>{title}</Typography>
                        <Box
                            sx={{
                                minWidth: 22,
                                px: '6px',
                                py: '1px',
                                borderRadius: '11px',
                                bgcolor: colors.background,
                                textAlign: 'center',
                            }}
                        >
                            <Typography
                                sx={{ fontSize: 11.5, fontWeight: 700, color: colors.textSecondary }}
                            >
                                {items.length}
                            </Typography>
                        </Box>
                    </Box>
                    {subtitle ? (
                        <Typography sx={typography.bodyMuted}>{subtitle}</Typography>
                    ) : null}
                    {/* The total spans three product types, so say what it's made of. */}
                    {breakdown.length ? (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: '6px' }}>
                            {breakdown.map((b) => (
                                <Box
                                    key={b.label}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        px: '8px',
                                        py: '3px',
                                        borderRadius: '10px',
                                        bgcolor: colors.background,
                                    }}
                                >
                                    <NLIcon name={b.icon} size={11} color={colors.textSecondary} />
                                    <Typography
                                        sx={{ fontSize: 11, fontWeight: 700, color: colors.textSecondary }}
                                    >
                                        {b.label} {b.count}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
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
                        See all
                        <NLIcon name="chevron-forward" size={13} color={colors.primary} />
                    </ButtonBase>
                ) : null}
            </Box>

            {items.length ? (
                <>
                    <NLViewSwitcher
                        mode={mode}
                        onChange={setMode}
                        hint={mode === 'slide'
                            ? `Swipe · auto every ${intervalSec}s`
                            : `${shown.length} of ${items.length}`}
                    />

                    {/* ── Sliding ───────────────────────────────────────── */}
                    {mode === 'slide' ? (
                        <NLTwoRowSlider
                            items={items.map(toCard)}
                            intervalSec={intervalSec}
                            onPress={(id) => {
                                const item = items.find((x) => x.id === id);
                                if (item) onItemPress?.(item);
                            }}
                        />
                    ) : null}

                    {/* ── List ──────────────────────────────────────────── */}
                    {mode === 'list' ? shown.map((r) => (
                        <ButtonBase
                            key={r.id}
                            onClick={() => onItemPress?.(r)}
                            sx={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                borderRadius: `${radius.md}px`,
                                mb: '9px',
                            }}
                        >
                            <NLCard sx={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                                <Box
                                    sx={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: '50%',
                                        bgcolor: tint(r.tint, 0.1),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    <NLIcon name={r.icon} size={18} color={r.tint} />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={{ ...typography.h3, ...clamp(2) }}>
                                        {r.title}
                                    </Typography>
                                    <Typography sx={{ ...typography.bodyMuted, ...clamp(1) }}>
                                        {r.subtitle}
                                    </Typography>
                                    <Typography sx={{ ...typography.caption, ...clamp(1) }}>
                                        {r.meta}
                                    </Typography>
                                    {statusLine(r)}
                                </Box>
                                <Box
                                    sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        gap: '6px',
                                        flexShrink: 0,
                                    }}
                                >
                                    <NLBadge label={r.kindLabel} tone="neutral" />
                                    <NLIcon name="chevron-forward" size={15} color={colors.textMuted} />
                                </Box>
                            </NLCard>
                        </ButtonBase>
                    )) : null}

                    {/* ── Grid ──────────────────────────────────────────── */}
                    {mode === 'grid' ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: '10px' }}>
                            {shown.map((r) => (
                                <ButtonBase
                                    key={r.id}
                                    onClick={() => onItemPress?.(r)}
                                    sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'stretch',
                                        textAlign: 'left',
                                        gap: '4px',
                                        p: '12px',
                                        borderRadius: `${radius.md}px`,
                                        border: `1px solid ${colors.border}`,
                                        bgcolor: colors.surface,
                                        '&:hover': { boxShadow: '0 6px 18px rgba(15, 27, 45, 0.10)' },
                                    }}
                                >
                                    <Box
                                        sx={{
                                            width: 36,
                                            height: 36,
                                            borderRadius: '50%',
                                            bgcolor: tint(r.tint, 0.1),
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <NLIcon name={r.icon} size={18} color={r.tint} />
                                    </Box>
                                    <Typography
                                        sx={{
                                            fontSize: 12.5,
                                            fontWeight: 700,
                                            color: colors.textPrimary,
                                            mt: '4px',
                                            lineHeight: '17px',
                                            ...clamp(3),
                                        }}
                                    >
                                        {r.title}
                                    </Typography>
                                    <Typography sx={{ ...typography.caption, ...clamp(1) }}>
                                        {r.subtitle}
                                    </Typography>
                                    {statusLine(r)}
                                    <Typography
                                        sx={{ fontSize: 11, fontWeight: 700, color: r.tint, mt: '3px' }}
                                    >
                                        {r.kindLabel}
                                    </Typography>
                                </ButtonBase>
                            ))}
                        </Box>
                    ) : null}

                    {/* ── Table ─────────────────────────────────────────── */}
                    {mode === 'table' ? (
                        <NLCard sx={{ p: 0, overflow: 'hidden' }}>
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '9px',
                                    px: '14px',
                                    py: '9px',
                                    bgcolor: colors.background,
                                }}
                            >
                                <Box sx={{ width: 15, flexShrink: 0 }} />
                                <Typography sx={{ ...TH, flex: 2.4 }}>Booking</Typography>
                                <Typography sx={{ ...TH, flex: 1 }}>Type</Typography>
                                <Box sx={{ width: 14, flexShrink: 0 }} />
                            </Box>
                            {shown.map((r) => (
                                <ButtonBase
                                    key={r.id}
                                    onClick={() => onItemPress?.(r)}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '9px',
                                        px: '14px',
                                        py: '11px',
                                        width: '100%',
                                        textAlign: 'left',
                                        borderTop: `1px solid ${colors.border}`,
                                        '&:hover': { bgcolor: colors.background },
                                    }}
                                >
                                    <NLIcon name={r.icon} size={15} color={r.tint} />
                                    <Box sx={{ flex: 2.4, minWidth: 0 }}>
                                        <Typography
                                            sx={{
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: colors.textPrimary,
                                                ...clamp(1),
                                            }}
                                        >
                                            {r.title}
                                        </Typography>
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                color: colors.textMuted,
                                                mt: '1px',
                                                ...clamp(1),
                                            }}
                                        >
                                            {r.statusLabel ? `${r.statusLabel} · ${r.meta}` : r.meta}
                                        </Typography>
                                    </Box>
                                    <Typography
                                        sx={{ fontSize: 12, color: colors.textSecondary, flex: 1, ...clamp(2) }}
                                    >
                                        {r.kindLabel}
                                    </Typography>
                                    <NLIcon name="chevron-forward" size={14} color={colors.textMuted} />
                                </ButtonBase>
                            ))}
                        </NLCard>
                    ) : null}

                    {/* A capped view must say what it's hiding, or it reads as the
                        whole shelf. */}
                    {mode !== 'slide' && hidden > 0 ? (
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
                </>
            ) : (
                <NLCard>
                    <Typography sx={typography.bodyMuted}>{emptyText}</Typography>
                </NLCard>
            )}
        </Box>
    );
};

const TH = {
    fontSize: 10.5,
    fontWeight: 700,
    color: colors.textMuted,
    textTransform: 'uppercase',
};

export default NLBookingStrip;
