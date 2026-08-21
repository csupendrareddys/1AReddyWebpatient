/**
 * "Last updated at <date> by <name> (Admin)" — profile-change provenance.
 *
 * "Updated" covers creation too: a Patient ``before_insert`` hook seeds the
 * columns, so a freshly created profile reads as updated-by-whoever-made-it
 * rather than as never-touched.
 *
 * Admin-only, which is why it lives here rather than inside the patient
 * profile page it sits above. The profile has two write surfaces (the
 * patient's own settings page and this act-on-behalf view), so support's first
 * question about any suspicious value is *who changed it* — but a patient has
 * no business knowing which staff member opened their record.
 *
 * Backed by the ``Patient.profile_updated_*`` columns, which both write
 * surfaces stamp. Renders nothing when the backend reports no provenance —
 * profiles untouched since the columns shipped have no honest answer, and a
 * blank line reads better than "Last updated: unknown".
 */
import { Box, Chip, Typography } from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';

/** Suffix shown after the name, so who touched the record is obvious at a
 *  glance. The patient-facing profile distinguishes the three self-service
 *  actors — the patient's OWN account, a LINKED family member, and a support
 *  STAFF caregiver — for accountability; Operations still sees admin/doctor. */
const ACTOR_LABEL = {
    owner: 'Owner',
    linked: 'Linked account',
    staff: 'Support staff',
    admin: 'Admin',
    doctor: 'Doctor',
    patient: 'Patient',   // legacy rows stamped before owner/linked split
};

const ACTOR_COLOR = {
    admin: 'warning',
    staff: 'info',
    linked: 'secondary',
    doctor: 'success',
};

const formatWhen = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
};

const LastUpdatedIndicator = ({ data, sx }) => {
    // Still in flight — render nothing rather than flashing the empty state.
    if (!data) return null;

    const when = data.updated_at ? formatWhen(data.updated_at) : null;

    // Only profiles predating these columns land here — creation now stamps
    // them, so anything created since reads as an update from day one. Say so
    // explicitly rather than rendering nothing: a silently absent line is
    // indistinguishable from a broken feature. NOT backfilled from
    // ``updated_at`` — it bumps on unrelated writes and can't name an actor,
    // so it would be an invented answer.
    if (!when) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ...sx }}>
                <HistoryIcon fontSize="inherit" sx={{ color: 'text.disabled', fontSize: '1rem' }} />
                <Typography variant="caption" color="text.disabled">
                    No update recorded for this profile
                </Typography>
            </Box>
        );
    }

    const by = data.updated_by || {};
    const actorLabel = ACTOR_LABEL[by.actor_type] || null;
    // An admin can be deleted (the FK is ON DELETE SET NULL) while the role
    // snapshot survives — still worth saying "an admin did this".
    const name = by.name || (actorLabel ? `Unknown ${actorLabel.toLowerCase()}` : 'Unknown');

    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ...sx }}>
            <HistoryIcon fontSize="inherit" sx={{ color: 'text.disabled', fontSize: '1rem' }} />
            <Typography variant="caption" color="text.secondary">
                Last updated at {when} by {name}
            </Typography>
            {actorLabel && (
                <Chip
                    label={actorLabel}
                    size="small"
                    color={ACTOR_COLOR[by.actor_type] || 'default'}
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                />
            )}
        </Box>
    );
};

export default LastUpdatedIndicator;
