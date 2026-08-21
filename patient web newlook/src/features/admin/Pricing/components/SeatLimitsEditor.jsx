/**
 * SeatLimitsEditor — four numeric inputs for total / super_admin /
 * sub_admin / provider seats. Reused by the Plan dialog (where
 * values are absolute caps, ≥ 0, sum-of-roles ≤ total) and by the
 * Addon dialog (where values are *signed deltas* — ``-1`` is legal
 * and means "remove a seat").
 *
 * The plan-side check (sum ≤ total) is rendered inline as a hint,
 * not enforced by disabling the Save button — the backend's
 * ``ck_plan_limits_sum`` constraint is the authoritative gate, and
 * the operator may want to set values temporarily out of order
 * while typing.
 */
import {
    Alert, Stack, TextField, Typography,
} from '@mui/material';


const ROLE_KEYS = [
    { key: 'total', label: 'Total' },
    { key: 'super_admin', label: 'Super admins' },
    { key: 'sub_admin', label: 'Sub-admins' },
    { key: 'provider', label: 'Providers' },
];


const SeatLimitsEditor = ({
    value,                  // ``{total, super_admin, sub_admin, provider}``
    onChange,
    allowNegative = false,  // true for addon deltas
    showSumHint = true,     // suppress for addon deltas (sum check doesn't apply)
}) => {
    const v = value || {};

    const handleChange = (key) => (e) => {
        const raw = e.target.value;
        // Allow empty string while typing (treat as null on save).
        if (raw === '' || raw === '-') {
            onChange({ ...v, [key]: raw === '-' ? raw : null });
            return;
        }
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        if (!allowNegative && n < 0) return;
        onChange({ ...v, [key]: n });
    };

    const sumRoles =
        (Number(v.super_admin) || 0)
        + (Number(v.sub_admin) || 0)
        + (Number(v.provider) || 0);
    const total = Number(v.total) || 0;
    const sumOk = sumRoles <= total;

    return (
        <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
                {ROLE_KEYS.map(({ key, label }) => (
                    <TextField
                        key={key}
                        label={label}
                        size="small"
                        type="number"
                        inputProps={allowNegative ? {} : { min: 0 }}
                        value={v[key] ?? ''}
                        onChange={handleChange(key)}
                        sx={{ flex: 1, minWidth: 110 }}
                    />
                ))}
            </Stack>
            {showSumHint && (
                <Alert severity={sumOk ? 'info' : 'warning'} sx={{ py: 0 }}>
                    <Typography variant="caption">
                        Sum of per-role limits: {sumRoles} / {total} (must be ≤ total).
                    </Typography>
                </Alert>
            )}
            {allowNegative && (
                <Typography variant="caption" color="text.secondary">
                    Add-on deltas can be negative (e.g. <code>-1</code>) to remove a seat.
                </Typography>
            )}
        </Stack>
    );
};

export default SeatLimitsEditor;
