/**
 * ProviderEntityQuotasEditor — per-vertical caps on how many provider
 * entities (independent doctors / clinic orgs / hospital orgs) a tenant
 * may register *inside their own subdomain*.
 *
 * Separate axis from ``SeatLimitsEditor`` — that file's "provider" seat
 * count is staff seats (team users with role ``provider``); these are
 * the number of provider-entity rows the tenant can register internally.
 *
 * Sentinel convention (matches the rest of the pricing surface):
 *   * ``-1`` — unlimited
 *   * ``0``  — vertical not allowed at all in this plan
 *   * positive int — hard cap
 *   * empty / null — legacy row; backend treats as 0 (deny). Hint shown.
 */
import { Alert, Stack, TextField, Typography } from '@mui/material';


const ROWS = [
    { key: 'doctor',   label: 'Doctors (independent)',
      hint: 'Independent doctor practices registered inside the tenant.' },
    { key: 'clinic',   label: 'Clinics',
      hint: 'Clinic organisations inside the tenant. Each clinic can in turn hold doctor seats.' },
    { key: 'hospital', label: 'Hospitals',
      hint: 'Hospital organisations inside the tenant.' },
];


const ProviderEntityQuotasEditor = ({ value, onChange }) => {
    const v = value || {};

    const handleChange = (key) => (e) => {
        const raw = e.target.value;
        if (raw === '' || raw === '-') {
            onChange({ ...v, [key]: raw === '-' ? raw : null });
            return;
        }
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        // Allow -1 (unlimited sentinel) but no other negatives.
        if (n < -1) return;
        onChange({ ...v, [key]: n });
    };

    return (
        <Stack spacing={1}>
            <Stack direction="row" spacing={1} flexWrap="wrap">
                {ROWS.map(({ key, label }) => (
                    <TextField
                        key={key}
                        label={label}
                        size="small"
                        type="number"
                        inputProps={{ min: -1 }}
                        value={v[key] ?? ''}
                        onChange={handleChange(key)}
                        sx={{ flex: 1, minWidth: 150 }}
                    />
                ))}
            </Stack>
            <Alert severity="info" sx={{ py: 0 }}>
                <Typography variant="caption">
                    <strong>-1</strong> = unlimited · <strong>0</strong> = vertical
                    disabled · positive int = hard cap. Empty / missing values
                    are treated as <strong>0</strong> (vertical denied) by enforcement.
                </Typography>
            </Alert>
        </Stack>
    );
};


export default ProviderEntityQuotasEditor;
