/**
 * UsageMeters — used-vs-entitled bars for team seats and marketplace
 * entities, with the mock's warn/critical colouring. A limit of -1
 * renders as unlimited (full-width neutral bar), 0 as "not included".
 */
import {
    Box, LinearProgress, Stack, Tooltip, Typography,
} from '@mui/material';

const stateOf = (used, limit) => {
    if (limit === -1) return { pct: 8, color: 'info', label: '∞ unlimited' };
    if (!limit || limit <= 0) {
        return { pct: 0, color: 'inherit', label: 'not included' };
    }
    const pct = Math.min(100, Math.round((used / limit) * 100));
    if (pct >= 100) return { pct, color: 'error', label: 'at limit' };
    if (pct >= 90) return { pct, color: 'error', label: `${pct}%` };
    if (pct >= 75) return { pct, color: 'warning', label: `${pct}%` };
    return { pct, color: 'primary', label: `${pct}%` };
};

export default function UsageMeters({ rows }) {
    return (
        <Stack spacing={1.25}>
            {rows.map(({ key, label, used, limit, hint }) => {
                const st = stateOf(used ?? 0, limit);
                return (
                    <Box key={key}>
                        <Stack direction="row" justifyContent="space-between"
                            sx={{ mb: 0.25 }}>
                            <Tooltip title={hint || ''} placement="top-start">
                                <Typography variant="body2"
                                    sx={{ fontWeight: 600 }}>
                                    {label}
                                </Typography>
                            </Tooltip>
                            <Typography variant="caption"
                                color={st.color === 'error'
                                    ? 'error.main' : 'text.secondary'}
                                sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {used ?? 0}
                                {' / '}
                                {limit === -1 ? '∞' : (limit ?? '—')}
                                {' · '}
                                {st.label}
                            </Typography>
                        </Stack>
                        <LinearProgress
                            variant="determinate"
                            value={st.pct}
                            color={st.color === 'inherit' ? 'primary' : st.color}
                            sx={{
                                height: 8,
                                borderRadius: 4,
                                opacity: st.color === 'inherit' ? 0.3 : 1,
                            }}
                        />
                    </Box>
                );
            })}
        </Stack>
    );
}
