/**
 * Renders one list of things in whichever of the four views is selected —
 * port of the mobile MVP's ``ItemViews``.
 *
 * Product catalogues, category listings and booking lists all want the same
 * four shapes, so they share this renderer rather than each growing their own,
 * which is what kept the old screens drifting apart.
 *
 * The one web-specific change: what the mobile file lays out as two 47.5%
 * columns becomes a responsive grid, so a wide dashboard shows four across
 * instead of two enormous cards. Narrow widths keep the mobile's two-up.
 */
import { Box, ButtonBase, Typography } from '@mui/material';
import NLCard from './NLCard';
import NLBadge from './NLBadge';
import NLTwoRowSlider from './NLTwoRowSlider';
import NLIcon from './NLIcon';
import { clamp, colors, radius, tint, typography } from '../theme/tokens';
import { inr } from '../utils/format';

const GRID_COLUMNS = { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' };

const NLItemViews = ({
    items = [],
    mode,
    onPress,
    intervalSec = 0,
    tableTypeLabel = 'Type',
    showPrice = true,
}) => {
    const toCard = (r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        meta: showPrice && r.price != null
            ? `${r.price === 0 ? 'Free' : inr(r.price)}${r.meta ? ` · ${r.meta}` : ''}`
            : r.meta,
        badge: r.note ?? r.badge,
        icon: r.icon,
        tint: r.tint,
    });

    const priceText = (r) => (r.price == null ? '' : r.price === 0 ? 'Free' : inr(r.price));

    // Showing the capabilities on the row means a patient doesn't have to open
    // a booking to learn whether it includes messaging or calls.
    const caps = (r) => {
        const c = r.caps;
        if (!c || !(c.chat || c.voice || c.video || c.files)) return null;
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '7px', mt: '5px' }}>
                {c.video ? <NLIcon name="videocam-outline" size={12} color={r.tint} /> : null}
                {c.voice ? <NLIcon name="call-outline" size={12} color={r.tint} /> : null}
                {c.chat ? <NLIcon name="chatbubble-outline" size={12} color={r.tint} /> : null}
                {c.files ? <NLIcon name="document-attach-outline" size={12} color={r.tint} /> : null}
            </Box>
        );
    };

    /**
     * An outcome tag that sits beside the type badge — how a rejected or expired
     * booking says so while still living in the Completed list.
     */
    const tag = (r) => (r.tag
        ? <NLBadge label={r.tag} tone={r.tagTone || 'error'} />
        : null);

    const note = (r) => (r.note ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '4px', mt: '4px' }}>
            <NLIcon name={r.noteIcon || 'sparkles-outline'} size={10} color={r.tint} />
            <Typography
                sx={{ fontSize: 10.5, fontWeight: 700, color: r.tint, ...clamp(1) }}
            >
                {r.note}
            </Typography>
        </Box>
    ) : null);

    if (mode === 'slide') {
        return (
            <NLTwoRowSlider
                items={items.map(toCard)}
                intervalSec={intervalSec}
                onPress={onPress}
            />
        );
    }

    if (mode === 'grid') {
        return (
            <Box sx={{ display: 'grid', gridTemplateColumns: GRID_COLUMNS, gap: '10px' }}>
                {items.map((r) => (
                    <ButtonBase
                        key={r.id}
                        onClick={onPress ? () => onPress(r.id) : undefined}
                        disabled={!onPress}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            textAlign: 'left',
                            gap: '4px',
                            p: '12px',
                            borderRadius: `${radius.md}px`,
                            border: r.selected
                                ? `2px solid ${r.tint}`
                                : `1px solid ${colors.border}`,
                            bgcolor: r.selected ? tint(r.tint, 0.06) : colors.surface,
                            '&:hover': onPress
                                ? { boxShadow: '0 6px 18px rgba(15, 27, 45, 0.10)' }
                                : undefined,
                        }}
                    >
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}
                        >
                            <Box
                                sx={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: '50%',
                                    bgcolor: tint(r.tint, 0.1),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <NLIcon name={r.icon} size={18} color={r.tint} />
                            </Box>
                            {r.selected ? (
                                <NLIcon name="checkmark-circle" size={20} color={r.tint} />
                            ) : null}
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
                        {r.subtitle ? (
                            <Typography sx={{ ...typography.caption, ...clamp(1) }}>
                                {r.subtitle}
                            </Typography>
                        ) : null}
                        {note(r)}
                        {caps(r)}
                        {r.tag ? <Box sx={{ mt: '6px' }}>{tag(r)}</Box> : null}
                        {showPrice && r.price != null ? (
                            <Typography sx={{ fontSize: 15, fontWeight: 800, color: r.tint }}>
                                {priceText(r)}
                            </Typography>
                        ) : null}
                    </ButtonBase>
                ))}
            </Box>
        );
    }

    if (mode === 'table') {
        return (
            <NLCard sx={{ p: 0, overflow: 'hidden' }}>
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        px: '13px',
                        py: '9px',
                        bgcolor: colors.background,
                    }}
                >
                    <Box sx={{ width: 14, flexShrink: 0 }} />
                    <Typography sx={{ ...TH, flex: 2.3 }}>Name</Typography>
                    <Typography sx={{ ...TH, flex: 1.1 }}>{tableTypeLabel}</Typography>
                    {showPrice ? (
                        <Typography sx={{ ...TH, width: 62, textAlign: 'right' }}>Price</Typography>
                    ) : null}
                </Box>
                {items.map((r) => (
                    <ButtonBase
                        key={r.id}
                        onClick={onPress ? () => onPress(r.id) : undefined}
                        disabled={!onPress}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            px: '13px',
                            py: '11px',
                            width: '100%',
                            textAlign: 'left',
                            borderTop: `1px solid ${colors.border}`,
                            bgcolor: r.selected ? tint(r.tint, 0.07) : 'transparent',
                            '&:hover': onPress ? { bgcolor: colors.background } : undefined,
                        }}
                    >
                        <NLIcon
                            name={r.selected ? 'checkmark-circle' : r.icon}
                            size={14}
                            color={r.tint}
                        />
                        <Box sx={{ flex: 2.3, minWidth: 0 }}>
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    color: colors.textPrimary,
                                    ...clamp(1),
                                }}
                            >
                                {r.title}
                            </Typography>
                            <Typography
                                sx={{ fontSize: 10.5, color: colors.textMuted, mt: '1px', ...clamp(1) }}
                            >
                                {r.subtitle ?? r.meta ?? ''}
                            </Typography>
                        </Box>
                        <Box sx={{ flex: 1.1, minWidth: 0 }}>
                            <Typography
                                sx={{ fontSize: 11.5, color: colors.textSecondary, ...clamp(2) }}
                            >
                                {r.badge ?? ''}
                            </Typography>
                            {r.tag ? <Box sx={{ mt: '3px' }}>{tag(r)}</Box> : null}
                        </Box>
                        {showPrice ? (
                            <Typography
                                sx={{
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    color: colors.textPrimary,
                                    width: 62,
                                    textAlign: 'right',
                                    ...clamp(1),
                                }}
                            >
                                {priceText(r)}
                            </Typography>
                        ) : null}
                    </ButtonBase>
                ))}
            </NLCard>
        );
    }

    // ── List ──────────────────────────────────────────────────────────────
    return (
        <Box>
            {items.map((r) => (
                <ButtonBase
                    key={r.id}
                    onClick={onPress ? () => onPress(r.id) : undefined}
                    disabled={!onPress}
                    sx={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        borderRadius: `${radius.md}px`,
                        mb: '10px',
                    }}
                >
                    <NLCard
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '11px',
                            border: r.selected
                                ? `2px solid ${r.tint}`
                                : `1px solid ${colors.border}`,
                        }}
                    >
                        <Box
                            sx={{
                                width: 38,
                                height: 38,
                                borderRadius: '50%',
                                bgcolor: tint(r.tint, 0.1),
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                            }}
                        >
                            <NLIcon name={r.icon} size={19} color={r.tint} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ ...typography.h3, ...clamp(2) }}>{r.title}</Typography>
                            {r.subtitle ? (
                                <Typography sx={{ ...typography.bodyMuted, ...clamp(2) }}>
                                    {r.subtitle}
                                </Typography>
                            ) : null}
                            {r.meta ? (
                                <Typography sx={{ ...typography.caption, ...clamp(1) }}>
                                    {r.meta}
                                </Typography>
                            ) : null}
                            {note(r)}
                            {caps(r)}
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
                            {showPrice && r.price != null ? (
                                <Typography
                                    sx={{ fontSize: 15, fontWeight: 800, color: colors.textPrimary }}
                                >
                                    {priceText(r)}
                                </Typography>
                            ) : null}
                            {tag(r)}
                            {r.badge ? <NLBadge label={r.badge} tone="neutral" /> : null}
                            <NLIcon name="chevron-forward" size={15} color={colors.textMuted} />
                        </Box>
                    </NLCard>
                </ButtonBase>
            ))}
        </Box>
    );
};

const TH = {
    fontSize: 10,
    fontWeight: 700,
    color: colors.textMuted,
    textTransform: 'uppercase',
};

export default NLItemViews;
