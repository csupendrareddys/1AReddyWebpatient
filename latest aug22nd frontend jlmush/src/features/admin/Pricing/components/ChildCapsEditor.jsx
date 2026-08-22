/**
 * Two-track child-tenancy ceilings on an apex plan — the mock's
 * "Child tenancy entitlements", implemented as CAPS: the maximum any
 * plan the apex authors for a child may grant. The apex still authors
 * its own child plans; these numbers only bound them.
 *
 * value: null (uncapped) | flat legacy {total,...} | two-track
 *   {subdomain: {...}|null, custom_domain: {...}|null}
 * Editing always writes the two-track shape; a flat legacy value is
 * shown as the SAME ceilings on both tracks (that is exactly how the
 * backend interprets it).
 */
import { Box, Stack, TextField, Typography } from '@mui/material';

const KEYS = [
    ['total', 'Total users'], ['super_admin', 'Super admins'],
    ['sub_admin', 'Sub admins'], ['provider', 'Providers'],
    ['doctor', 'Doctor entities'], ['clinic', 'Clinic entities'],
    ['hospital', 'Hospital entities'],
];

const TRACKS = [
    ['subdomain', 'Subdomain children',
     'Children on <slug>.<apex-domain>.'],
    ['custom_domain', 'Custom-domain children',
     'Children that attach their own domain (their ceiling is the '
     + 'higher of the two tracks).'],
];

const isTwoTrack = (v) => Boolean(v && (v.subdomain || v.custom_domain));

const trackValue = (value, track) => {
    if (!value) return {};
    if (isTwoTrack(value)) return value[track] || {};
    return value; // legacy flat = same ceilings both tracks
};

// Seats must add up: super + sub + provider cannot exceed the total,
// or the ceiling contradicts itself. Returned per track so the offending
// fields can go red as they are typed.
const sumError = (t) => {
    const n = (k) => (Number.isFinite(Number(t?.[k])) ? Number(t[k]) : null);
    const total = n('total');
    const parts = ['super_admin', 'sub_admin', 'provider'].map(n);
    if (total === null || parts.some((v) => v === null)) return null;
    const per = parts.reduce((a, b) => a + b, 0);
    return per > total
        ? `Super admins + sub-admins + providers = ${per}, which is more `
          + `than the total of ${total}.`
        : null;
};

export function childCapsError(value) {
    if (!value) return null;
    const tracks = (value.subdomain || value.custom_domain)
        ? Object.entries(value).filter(([, v]) => v)
        : [[null, value]];
    for (const [track, block] of tracks) {
        const err = sumError(block);
        if (err) return track ? `${track === 'subdomain' ? 'Subdomain'
            : 'Custom-domain'} children: ${err}` : err;
    }
    return null;
}

export default function ChildCapsEditor({ value, onChange }) {
    const setKey = (track, key, raw) => {
        const base = isTwoTrack(value)
            ? { ...value }
            : {
                subdomain: { ...(value || {}) },
                custom_domain: { ...(value || {}) },
            };
        const t = { ...(base[track] || {}) };
        if (raw === '') delete t[key];
        else t[key] = Number(raw);
        base[track] = Object.keys(t).length ? t : null;
        const empty = !base.subdomain && !base.custom_domain;
        onChange(empty ? null : base);
    };

    return (
        <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Per-child-tenant ceilings
            </Typography>
            <Typography variant="caption" color="text.secondary"
                sx={{ display: 'block', mb: 1 }}>
                The maximum any plan this apex authors for a child may
                grant — seats and marketplace entities, per hosting
                track. Empty = uncapped. The apex differentiates its own
                child plans freely underneath these numbers.
            </Typography>
            <Stack spacing={1.5}>
                {TRACKS.map(([track, label, hint]) => {
                    const tv = trackValue(value, track);
                    const err = sumError(tv);
                    return (
                    <Box key={track} sx={{
                        border: 1,
                        borderColor: err ? 'error.main' : 'divider',
                        borderRadius: 1, p: 1.5,
                    }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary"
                            sx={{ display: 'block', mb: 1 }}>
                            {hint}
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap"
                            useFlexGap>
                            {KEYS.map(([k, lbl]) => (
                                <TextField
                                    key={k} label={lbl} type="number"
                                    size="small"
                                    error={Boolean(err) && [
                                        'total', 'super_admin', 'sub_admin',
                                        'provider'].includes(k)}
                                    inputProps={{ min: 0 }}
                                    value={tv[k] ?? ''}
                                    onChange={(e) => setKey(track, k,
                                        e.target.value)}
                                    sx={{ width: 128 }}
                                />
                            ))}
                        </Stack>
                        {err && (
                            <Typography variant="caption" color="error"
                                sx={{ display: 'block', mt: 0.75 }}>
                                {err}
                            </Typography>
                        )}
                    </Box>
                    );
                })}
            </Stack>
        </Box>
    );
}
