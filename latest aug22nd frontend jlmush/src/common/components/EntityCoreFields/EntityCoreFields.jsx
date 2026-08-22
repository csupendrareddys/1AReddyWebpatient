/**
 * EntityCoreFields — the shared "legal entity" core sub-form used by the
 * patient (corporate) signup and, later, the hospital/clinic registration +
 * profile surfaces.
 *
 * The entity-type select is the individual/corporate discriminator: while it's
 * "Individual" nothing else shows; any other type reveals the core entity text
 * fields. Logos, document attachments and authorized personnel are NOT here —
 * those are completed in the profile.
 *
 * Controlled: `values` is the entity object `{ entity_type, entity_name, ... }`,
 * `onChange` receives standard input change events (name/value), so a parent
 * can merge into its own entity slice.
 *
 * `lockIndividual` pins the type to Individual and disables the select — for
 * funnels where a corporate account is not on offer (e.g. the `patient`
 * receiver plan type). The field still renders so the account type is visible;
 * it just isn't a choice.
 */
import {
    Box, Grid, TextField, FormControl, InputLabel, Select, MenuItem, Typography,
} from '@mui/material';

export const ENTITY_TYPE_OPTIONS = [
    { value: 'individual', label: 'Individual' },
    { value: 'proprietorship', label: 'Proprietorship' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'private_limited', label: 'Private Limited' },
    { value: 'public_limited', label: 'Public Limited' },
    { value: 'section_8', label: 'Section 8 (Sec 8)' },
    { value: 'trust', label: 'Trust' },
];

const INDIVIDUAL_ONLY_OPTIONS = ENTITY_TYPE_OPTIONS.filter((o) => o.value === 'individual');

export default function EntityCoreFields({
    values = {}, onChange, errors = {}, disabled, lockIndividual = false,
}) {
    const entityType = lockIndividual ? 'individual' : (values.entity_type || 'individual');
    const isCorporate = entityType !== 'individual';

    const field = (name, label, extra = {}) => (
        <TextField
            fullWidth size="small" name={name} label={label}
            value={values[name] || ''} onChange={onChange}
            error={!!errors[name]} helperText={errors[name]}
            disabled={disabled}
            {...extra}
        />
    );

    return (
        <Box>
            <FormControl
                fullWidth margin="normal" size="small"
                error={!lockIndividual && !!errors.entity_type}
            >
                <InputLabel id="entity-type-label">Entity Type</InputLabel>
                <Select
                    labelId="entity-type-label" name="entity_type" label="Entity Type"
                    value={entityType} onChange={onChange}
                    disabled={disabled || lockIndividual}
                >
                    {(lockIndividual ? INDIVIDUAL_ONLY_OPTIONS : ENTITY_TYPE_OPTIONS).map((o) => (
                        <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                    ))}
                </Select>
            </FormControl>

            {isCorporate && (
                <Box sx={{ mt: 1 }}>
                    <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
                        Entity details — logos, documents & authorized personnel are added later in your profile.
                    </Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12} sm={6}>{field('entity_name', 'Name of the Entity')}</Grid>
                        <Grid item xs={12} sm={6}>{field('legal_name', 'Legal Name')}</Grid>
                        <Grid item xs={12} sm={6}>{field('trade_name', 'Trade Name')}</Grid>
                        <Grid item xs={12} sm={6}>
                            {field('year_of_establishment', 'Year of Establishment', { type: 'number' })}
                        </Grid>
                        <Grid item xs={12}>
                            {field('promoters', 'Promoters', {
                                placeholder: 'Comma-separated names',
                                helperText: errors.promoters || 'e.g. Jane Doe, John Smith',
                            })}
                        </Grid>
                        <Grid item xs={12} sm={6}>{field('registration_license_number', 'Registration / License No.')}</Grid>
                        <Grid item xs={12} sm={6}>{field('cin_number', 'CIN No.')}</Grid>
                        <Grid item xs={12} sm={6}>{field('gst_number', 'GST No.')}</Grid>
                        <Grid item xs={12} sm={6}>{field('pan_number', 'PAN No.')}</Grid>
                    </Grid>
                </Box>
            )}
        </Box>
    );
}
