/**
 * A multi-row shelf that slides sideways on its own — port of the mobile MVP's
 * ``TwoRowSlider``, the piece the whole new look is built around.
 *
 * Items are laid out in columns of ``rows`` and paged horizontally, so the
 * shelf is a fixed number of lines tall however many items it holds.
 *
 * WHAT CHANGED FROM MOBILE, and why:
 *
 *  • The mobile version derives the column width from the *viewport* (capped at
 *    560pt) because a phone screen IS the shelf. Here the shelf lives inside a
 *    dashboard column that changes width when the sidebar collapses, so the
 *    width is measured from the container with a ResizeObserver instead.
 *  • Mobile shows a fixed 1.15 (product) / 1.85 (tile) columns per view. Doing
 *    that on a 1200px dashboard would draw one absurdly wide card, so the
 *    column keeps its phone-sized proportions and the shelf shows AS MANY as
 *    fit — the same design, more of it. Narrow widths land back on the mobile
 *    numbers, which is the floor.
 *  • One dot per scroll position rather than per column: with several columns
 *    visible at once, a dot per column would count pages that don't exist. If
 *    everything fits, there are no dots and no timer — nothing to advance to.
 *
 * The auto-advance stops the moment the shelf is touched, hovered or scrolled
 * by hand and does not resume until the user lets go. A shelf that keeps moving
 * under someone's finger while they're reading it is actively hostile, and the
 * whole point of the timer is to show what's there, not to race them.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import NLIcon from './NLIcon';
import { clamp, colors, radius, tint } from '../theme/tokens';

const GAP = 10;

/**
 * Phone-sized column width, kept so the cards look the same at any width.
 *
 * The tile column is wider than the phone's 195 because tile titles clamp to one
 * line: at 195 a real label like "Voice Consultation" or "Health Records" came
 * out as "Voice…". Narrow screens still floor at MIN_PER_VIEW below, so the
 * phone layout is unchanged — this only spends a desktop's spare width.
 */
const IDEAL_COL = { tile: 240, product: 313 };
/** The mobile columns-per-view, used as the floor on narrow screens. */
const MIN_PER_VIEW = { tile: 1.85, product: 1.15 };

const NLTwoRowSlider = ({
    items = [],
    onPress,
    intervalSec = 0,
    variant = 'product',
    columns,
    rows = 2,
}) => {
    const trackRef = useRef(null);
    const [width, setWidth] = useState(0);
    const [paused, setPaused] = useState(false);
    const [page, setPage] = useState(0);
    const scrollIdleRef = useRef(null);

    // Chunk into columns, so the shelf is always exactly `rows` lines tall.
    const cols = [];
    for (let i = 0; i < items.length; i += rows) cols.push(items.slice(i, i + rows));

    const perView = columns
        || Math.max(MIN_PER_VIEW[variant] || 1.15, width / (IDEAL_COL[variant] || 313));
    const colW = width > 0
        ? Math.max(150, Math.round((width - GAP * (Math.floor(perView) - 1)) / perView))
        : 0;
    const step = colW + GAP;
    // How many columns fit at once → how many scroll positions actually exist.
    const visible = Math.max(1, Math.floor(perView));
    const maxPage = Math.max(0, cols.length - visible);

    // Measure the container, not the window: the dashboard column resizes when
    // the sidebar collapses and the shelf has to follow.
    useLayoutEffect(() => {
        const el = trackRef.current;
        if (!el) return undefined;
        const measure = () => setWidth(el.clientWidth);
        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Auto-advance. Skipped entirely until measured, and while paused, and when
    // there is nowhere to advance to.
    useEffect(() => {
        if (!intervalSec || paused || colW === 0 || maxPage === 0) return undefined;
        const t = setInterval(() => {
            setPage((prev) => {
                const next = prev >= maxPage ? 0 : prev + 1;
                trackRef.current?.scrollTo({ left: next * step, behavior: 'smooth' });
                return next;
            });
        }, intervalSec * 1000);
        return () => clearInterval(t);
    }, [intervalSec, paused, step, maxPage, colW]);

    // Track manual scrolling so the dots stay truthful, and hold the timer
    // while the user is mid-swipe.
    const onScroll = useCallback(() => {
        const el = trackRef.current;
        if (!el || step === 0) return;
        setPage(Math.min(maxPage, Math.round(el.scrollLeft / step)));
        setPaused(true);
        if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current);
        scrollIdleRef.current = setTimeout(() => setPaused(false), 900);
    }, [step, maxPage]);

    useEffect(() => () => {
        if (scrollIdleRef.current) clearTimeout(scrollIdleRef.current);
    }, []);

    if (!items.length) return null;

    const cardSxBase = variant === 'tile'
        ? { height: 66, p: '11px', gap: '9px' }
        : { height: 88, p: '12px', gap: '10px' };

    return (
        <Box
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <Box
                ref={trackRef}
                onScroll={onScroll}
                sx={{
                    display: 'flex',
                    gap: `${GAP}px`,
                    pr: '4px',
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    scrollSnapType: 'x mandatory',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    '&::-webkit-scrollbar': { display: 'none' },
                }}
            >
                {cols.map((col, ci) => (
                    <Box
                        key={col[0].id}
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: `${GAP}px`,
                            flex: colW ? `0 0 ${colW}px` : '0 0 88%',
                            width: colW || undefined,
                            scrollSnapAlign: 'start',
                        }}
                    >
                        {col.map((c) => (
                            <ButtonBase
                                key={c.id}
                                onClick={onPress ? () => onPress(c.id) : undefined}
                                disabled={!onPress}
                                sx={{
                                    ...cardSxBase,
                                    display: 'flex',
                                    alignItems: 'center',
                                    textAlign: 'left',
                                    borderRadius: `${radius.md}px`,
                                    // Invisible by design — the shelves should read as
                                    // one surface, not a grid of boxed-in cells.
                                    border: '1px solid transparent',
                                    bgcolor: colors.surface,
                                    transition: 'box-shadow .18s, border-color .18s',
                                    '&:hover': onPress
                                        ? {
                                            boxShadow: '0 6px 18px rgba(15, 27, 45, 0.10)',
                                            borderColor: colors.border,
                                        }
                                        : undefined,
                                }}
                            >
                                <Box
                                    sx={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: '50%',
                                        bgcolor: tint(c.tint, 0.1),
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}
                                >
                                    <NLIcon
                                        name={c.icon}
                                        size={variant === 'tile' ? 18 : 19}
                                        color={c.tint}
                                    />
                                </Box>
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography
                                        sx={{
                                            fontSize: variant === 'tile' ? 12.5 : 13.5,
                                            fontWeight: 700,
                                            lineHeight: variant === 'tile' ? '16px' : '18px',
                                            color: colors.textPrimary,
                                            ...clamp(variant === 'tile' ? 1 : 2),
                                        }}
                                    >
                                        {c.title}
                                    </Typography>
                                    {c.subtitle ? (
                                        <Typography
                                            sx={{
                                                fontSize: 11.5,
                                                color: colors.textSecondary,
                                                mt: '2px',
                                                ...clamp(1),
                                            }}
                                        >
                                            {c.subtitle}
                                        </Typography>
                                    ) : null}
                                    {c.meta ? (
                                        <Typography
                                            sx={{
                                                fontSize: 11,
                                                color: colors.textMuted,
                                                mt: '1px',
                                                ...clamp(1),
                                            }}
                                        >
                                            {c.meta}
                                        </Typography>
                                    ) : null}
                                    {c.badge ? (
                                        <Box
                                            sx={{
                                                display: 'inline-block',
                                                mt: '5px',
                                                px: '7px',
                                                py: '2px',
                                                borderRadius: '9px',
                                                bgcolor: tint(c.tint, 0.1),
                                                color: c.tint,
                                                fontSize: 10,
                                                fontWeight: 700,
                                                maxWidth: '100%',
                                                ...clamp(1),
                                            }}
                                        >
                                            {c.badge}
                                        </Box>
                                    ) : null}
                                </Box>
                                <NLIcon name="chevron-forward" size={14} color={colors.textMuted} />
                            </ButtonBase>
                        ))}
                        {/* Pads the last column so a ragged count can't shorten the
                            shelf and make the whole row jump on the final page. */}
                        {ci === cols.length - 1
                            ? Array.from({ length: rows - col.length }).map((_, i) => (
                                <Box
                                    key={`pad-${i}`}
                                    sx={{ ...cardSxBase, visibility: 'hidden' }}
                                />
                            ))
                            : null}
                    </Box>
                ))}
            </Box>

            {maxPage > 0 ? (
                <Box
                    sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        mt: 1.25,
                    }}
                >
                    {Array.from({ length: maxPage + 1 }).map((_, i) => (
                        <Box
                            key={`dot-${i}`}
                            sx={{
                                width: i === page ? 16 : 5,
                                height: 5,
                                borderRadius: '3px',
                                bgcolor: i === page ? colors.primary : colors.border,
                                transition: 'width .2s, background-color .2s',
                            }}
                        />
                    ))}
                    {paused && intervalSec ? (
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                ml: 1,
                                px: '6px',
                                py: '2px',
                                borderRadius: '8px',
                                bgcolor: colors.background,
                            }}
                        >
                            <NLIcon name="pause" size={9} color={colors.textMuted} />
                            <Typography
                                sx={{ fontSize: 9.5, fontWeight: 700, color: colors.textMuted }}
                            >
                                Paused
                            </Typography>
                        </Box>
                    ) : null}
                </Box>
            ) : null}
        </Box>
    );
};

export default NLTwoRowSlider;
