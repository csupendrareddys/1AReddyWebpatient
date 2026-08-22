/**
 * Lightweight horizontal carousel — CSS scroll-snap + JS arrow navigation.
 *
 * No external library: each child becomes a snap point inside a horizontally
 * scrollable flex container. Arrow buttons advance/retreat by one slide and
 * wrap around at either end; on mobile the user can also swipe natively.
 *
 * Props:
 *   - children: array of slide nodes
 *   - itemMinWidth: per-breakpoint min-width for each slide. Defaults to a
 *     responsive value that shows ~1 / ~2 / ~3 cards depending on viewport.
 *   - showArrows: hide the chevrons entirely (default true; always off on xs
 *     regardless of this prop, since mobile relies on swipe + dots)
 *   - autoPlayMs: if set, advance the carousel every N ms (paused on hover/focus)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Box, IconButton, useTheme, alpha, useMediaQuery } from '@mui/material';
import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';

export default function Carousel({
    children,
    itemMinWidth = { xs: '85%', sm: '48%', md: '32%' },
    gap = 3,
    autoPlayMs = 0,
    showDots = true,
    showArrows = true,
}) {
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
    const scrollerRef = useRef(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [paused, setPaused] = useState(false);

    const slides = Array.isArray(children) ? children : [children];
    const slideCount = slides.length;

    // Reads the actual rendered gap in px rather than assuming a theme
    // spacing unit — avoids drift if the theme's spacing base ever changes.
    const getStep = useCallback(() => {
        const el = scrollerRef.current;
        if (!el) return 0;
        const card = el.firstElementChild;
        if (!card) return el.clientWidth;
        const style = getComputedStyle(el);
        const gapPx = parseFloat(style.columnGap || style.gap || '0') || 0;
        return card.getBoundingClientRect().width + gapPx;
    }, []);

    // ──────────────── Programmatic navigation (with wraparound) ────────────────
    const scrollByAmount = useCallback((dir) => {
        const el = scrollerRef.current;
        if (!el) return;
        const step = getStep();
        if (!step) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        const atEnd = el.scrollLeft >= maxScroll - 8;
        const atStart = el.scrollLeft <= 8;

        if (dir === 1 && atEnd) {
            el.scrollTo({ left: 0, behavior: 'smooth' });
        } else if (dir === -1 && atStart) {
            el.scrollTo({ left: maxScroll, behavior: 'smooth' });
        } else {
            el.scrollBy({ left: dir * step, behavior: 'smooth' });
        }
    }, [getStep]);

    // Jump directly to a slide (used by dots). Measures the real card
    // position instead of assuming uniform step * index, since card widths
    // can vary slightly with content even at the same min-width.
    const scrollToIndex = useCallback((idx) => {
        const el = scrollerRef.current;
        const card = el?.children[idx];
        if (!el || !card) return;
        const cardRect = card.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const left = el.scrollLeft + (cardRect.left - elRect.left);
        el.scrollTo({ left, behavior: 'smooth' });
    }, []);

    const onKeyDown = (e) => {
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            scrollByAmount(1);
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            scrollByAmount(-1);
        }
    };

    // Track scroll position to highlight the active dot. Sampled on every
    // scroll event but throttled via rAF so it stays cheap on long lists.
    useEffect(() => {
        const el = scrollerRef.current;
        if (!el) return;
        let rafId = 0;
        const onScroll = () => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const step = getStep();
                if (!step) return;
                const idx = Math.round(el.scrollLeft / step);
                setActiveIndex(Math.min(slideCount - 1, Math.max(0, idx)));
            });
        };
        el.addEventListener('scroll', onScroll, { passive: true });

        // Recompute on resize (rotation, layout shifts, etc.) so the active
        // dot doesn't go stale when card widths change.
        const ro = new ResizeObserver(onScroll);
        ro.observe(el);

        return () => {
            el.removeEventListener('scroll', onScroll);
            cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, [slideCount, getStep]);

    // Auto-play — wraps to start at the end, pauses on hover or keyboard focus.
    useEffect(() => {
        if (!autoPlayMs || paused || slideCount <= 1) return undefined;
        const id = setInterval(() => {
            const el = scrollerRef.current;
            const step = getStep();
            if (!el || !step) return;
            if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 8) {
                el.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                el.scrollBy({ left: step, behavior: 'smooth' });
            }
        }, autoPlayMs);
        return () => clearInterval(id);
    }, [autoPlayMs, paused, slideCount, getStep]);

    const arrowsVisible = showArrows && isDesktop && slideCount > 1;

    return (
        <Box
            sx={{ position: 'relative' }}
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <Box
                ref={scrollerRef}
                role="region"
                aria-roledescription="carousel"
                aria-label="Carousel"
                tabIndex={0}
                onKeyDown={onKeyDown}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                sx={{
                    display: 'flex',
                    gap,
                    overflowX: 'auto',
                    overflowY: 'hidden',
                    scrollSnapType: 'x mandatory',
                    scrollBehavior: 'smooth',
                    WebkitOverflowScrolling: 'touch',
                    px: { xs: 0.5, sm: 1 },
                    pb: 1,
                    mx: { xs: -0.5, sm: -1 },
                    outline: 'none',
                    '&:focus-visible': {
                        boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.5)}`,
                        borderRadius: 1,
                    },
                    '&::-webkit-scrollbar': { display: 'none' },
                    msOverflowStyle: 'none',
                    scrollbarWidth: 'none',
                }}
            >
                {slides.map((slide, idx) => (
                    <Box
                        key={idx}
                        role="group"
                        aria-roledescription="slide"
                        aria-label={`${idx + 1} of ${slideCount}`}
                        sx={{
                            scrollSnapAlign: 'start',
                            flex: '0 0 auto',
                            minWidth: itemMinWidth,
                        }}
                    >
                        {slide}
                    </Box>
                ))}
            </Box>

            {arrowsVisible && (
                <>
                    <IconButton
                        onClick={() => scrollByAmount(-1)}
                        aria-label="Previous slide"
                        sx={{
                            position: 'absolute',
                            left: { md: -20 },
                            top: '50%', transform: 'translateY(-50%)',
                            bgcolor: '#fff',
                            border: '1px solid', borderColor: 'grey.200',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                            zIndex: 2,
                        }}
                    >
                        <ChevronLeft />
                    </IconButton>
                    <IconButton
                        onClick={() => scrollByAmount(1)}
                        aria-label="Next slide"
                        sx={{
                            position: 'absolute',
                            right: { md: -20 },
                            top: '50%', transform: 'translateY(-50%)',
                            bgcolor: '#fff',
                            border: '1px solid', borderColor: 'grey.200',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                            '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.08) },
                            zIndex: 2,
                        }}
                    >
                        <ChevronRight />
                    </IconButton>
                </>
            )}

            {showDots && slideCount > 1 && (
                <Box
                    role="tablist"
                    aria-label="Slide navigation"
                    sx={{
                        display: 'flex', justifyContent: 'center',
                        gap: 0.75, mt: 2.5,
                    }}
                >
                    {slides.map((_, idx) => (
                        <Box
                            key={idx}
                            component="button"
                            role="tab"
                            aria-label={`Go to slide ${idx + 1}`}
                            aria-selected={idx === activeIndex}
                            onClick={() => scrollToIndex(idx)}
                            sx={{
                                width: idx === activeIndex ? 24 : 8,
                                height: 8,
                                p: 0,
                                border: 'none',
                                cursor: 'pointer',
                                borderRadius: 4,
                                bgcolor: idx === activeIndex
                                    ? 'primary.main'
                                    : alpha(theme.palette.text.secondary, 0.25),
                                transition: 'all 0.3s ease',
                            }}
                        />
                    ))}
                </Box>
            )}
        </Box>
    );
}