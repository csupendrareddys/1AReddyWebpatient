/**
 * Fade-and-slide-in once the wrapped content scrolls into view.
 *
 * Built on IntersectionObserver — no CSS framework, no library. The first
 * time the element crosses the viewport threshold, we drop the ``hidden``
 * styles and the browser's transition takes over. Subsequent scroll events
 * are no-ops (we ``unobserve`` after the first reveal) so it stays cheap on
 * long pages.
 *
 * Use this for sections that should feel alive without being distracting —
 * ``delay`` lets you stagger siblings (e.g. each testimonial card 100ms
 * after the previous).
 *
 * Falls back to "always visible" for users with ``prefers-reduced-motion:
 * reduce`` so we don't force motion on people who've opted out.
 */
import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';

export default function RevealOnScroll({
    children,
    delay = 0,
    direction = 'up',     // 'up' | 'left' | 'right' | 'none'
    threshold = 0.15,
    sx = {},
}) {
    const ref = useRef(null);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        // Respect users who disable motion at the OS level.
        const prefersReducedMotion = typeof window !== 'undefined'
            && window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            setShown(true);
            return undefined;
        }
        const el = ref.current;
        if (!el) return undefined;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setShown(true);
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [threshold]);

    const initialTransform = (() => {
        switch (direction) {
            case 'left': return 'translateX(-24px)';
            case 'right': return 'translateX(24px)';
            case 'none': return 'none';
            case 'up':
            default: return 'translateY(24px)';
        }
    })();

    return (
        <Box
            ref={ref}
            sx={{
                opacity: shown ? 1 : 0,
                transform: shown ? 'none' : initialTransform,
                transition: `opacity 0.7s ease ${delay}ms, transform 0.7s ease ${delay}ms`,
                willChange: 'opacity, transform',
                ...sx,
            }}
        >
            {children}
        </Box>
    );
}
