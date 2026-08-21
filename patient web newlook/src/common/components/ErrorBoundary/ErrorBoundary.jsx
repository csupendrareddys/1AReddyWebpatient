/**
 * ErrorBoundary — catches render crashes AND lazy-chunk load failures in the
 * subtree it wraps, so one broken panel degrades to a readable message instead
 * of unmounting the whole React tree (white page).
 *
 * A `ChunkLoadError` (or "failed to fetch dynamically imported module") means
 * the browser is holding a stale build after a redeploy — the hashed chunk it
 * asks for no longer exists. For that case we surface a "Reload" affordance.
 *
 * Usage:
 *   <ErrorBoundary label="Analytics & Settings">
 *     <Suspense fallback={...}><LazyThing /></Suspense>
 *   </ErrorBoundary>
 */
import { Component } from 'react';
import { Box, Typography, Button, Alert } from '@mui/material';

const isChunkError = (err) => {
    const name = err?.name || '';
    const msg = err?.message || '';
    return (
        name === 'ChunkLoadError' ||
        /loading (css )?chunk|dynamically imported module|import\(\)/i.test(msg)
    );
};

class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // Keep a console trail for support without crashing the app.
        // eslint-disable-next-line no-console
        console.error('[ErrorBoundary]', this.props.label || '', error, info?.componentStack);
    }

    handleReset = () => this.setState({ error: null });

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;

        const chunk = isChunkError(error);
        const label = this.props.label ? `"${this.props.label}" ` : '';

        return (
            <Box sx={{ p: 3 }}>
                <Alert severity={chunk ? 'warning' : 'error'} sx={{ mb: 2 }}>
                    {chunk
                        ? `A newer version of the app was deployed while this page was open, so ${label}could not load. Reload to get the latest version.`
                        : `Something went wrong loading ${label}and this panel was stopped so the rest of the page keeps working.`}
                </Alert>
                {!chunk && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2, wordBreak: 'break-word' }}>
                        {error?.message || String(error)}
                    </Typography>
                )}
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button variant="contained" size="small" onClick={() => window.location.reload()}>
                        Reload page
                    </Button>
                    {!chunk && (
                        <Button variant="outlined" size="small" onClick={this.handleReset}>
                            Try again
                        </Button>
                    )}
                </Box>
            </Box>
        );
    }
}

export default ErrorBoundary;
