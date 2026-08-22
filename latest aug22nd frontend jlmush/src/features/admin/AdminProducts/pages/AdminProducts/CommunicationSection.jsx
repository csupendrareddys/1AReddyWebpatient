/**
 * CommunicationSection — the admin's communication terms for one Service/Product.
 *
 * Lives inside the Product dialog because this is a property OF the service:
 * "a 12-week nutrition package that includes chat and two video calls" is one
 * thing an admin authors in one place, not a product plus a separate config
 * screen.
 *
 * What these settings are NOT: they are unrelated to a doctor's consultation
 * settings or to the appointment booking flow. They describe communication
 * that a patient buys as part of this service, and they are snapshotted onto
 * the purchase at activation — so editing them changes what FUTURE buyers get
 * and never rewrites the terms of a service someone already bought. That is
 * why the panel says so out loud when editing an existing product.
 */
import {
    Alert, Box, Collapse, Divider, FormControlLabel, Grid2 as Grid, Stack,
    Switch, TextField, Typography,
} from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CallIcon from '@mui/icons-material/Call';
import VideocamIcon from '@mui/icons-material/Videocam';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined';

export const EMPTY_COMMUNICATION = {
    is_enabled: false,
    validity_days: 30,
    chat_enabled: true,
    audio_enabled: false,
    video_enabled: false,
    documents_enabled: true,
    forms_enabled: false,
    // null = unlimited. Kept as '' in the form so the field can be cleared.
    audio_minutes_quota: '',
    video_minutes_quota: '',
    max_attachment_mb: 5,
    retention_days: 365,
};

/** Server shape → form shape (nulls become '' so inputs stay controlled). */
export function communicationFromApi(config) {
    if (!config) return { ...EMPTY_COMMUNICATION };
    return {
        is_enabled: !!config.is_enabled,
        validity_days: config.validity_days ?? 30,
        chat_enabled: !!config.chat_enabled,
        audio_enabled: !!config.audio_enabled,
        video_enabled: !!config.video_enabled,
        documents_enabled: !!config.documents_enabled,
        forms_enabled: !!config.forms_enabled,
        audio_minutes_quota: config.audio_minutes_quota ?? '',
        video_minutes_quota: config.video_minutes_quota ?? '',
        max_attachment_mb: config.max_attachment_mb ?? 5,
        retention_days: config.retention_days ?? 365,
    };
}

/** Form shape → server payload ('' becomes null = unlimited). */
export function communicationToApi(c) {
    const int = (v, fallback) => {
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? fallback : n;
    };
    const nullableInt = (v) => {
        if (v === '' || v === null || v === undefined) return null;
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? null : n;
    };
    return {
        is_enabled: !!c.is_enabled,
        validity_days: int(c.validity_days, 30),
        chat_enabled: !!c.chat_enabled,
        audio_enabled: !!c.audio_enabled,
        video_enabled: !!c.video_enabled,
        documents_enabled: !!c.documents_enabled,
        forms_enabled: !!c.forms_enabled,
        audio_minutes_quota: nullableInt(c.audio_minutes_quota),
        video_minutes_quota: nullableInt(c.video_minutes_quota),
        max_attachment_mb: int(c.max_attachment_mb, 5),
        retention_days: int(c.retention_days, 365),
    };
}

function FeatureToggle({ icon: Icon, label, hint, checked, onChange }) {
    return (
        <FormControlLabel
            sx={{ alignItems: 'flex-start', ml: 0, mb: 0.5 }}
            control={<Switch checked={checked} onChange={onChange} sx={{ mt: 0.5 }} />}
            label={(
                <Box sx={{ pt: 0.75 }}>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                        <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
                        <Typography variant="body2" fontWeight={600}>{label}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{hint}</Typography>
                </Box>
            )}
        />
    );
}

export default function CommunicationSection({ value, onChange, isEditing }) {
    const set = (patch) => onChange({ ...value, ...patch });

    return (
        <Box sx={{ mt: 1 }}>
            <Divider sx={{ my: 2 }}>
                <Typography variant="caption" color="text.secondary">
                    Communication — what the patient gets after buying
                </Typography>
            </Divider>

            <FormControlLabel
                control={(
                    <Switch
                        checked={!!value.is_enabled}
                        onChange={(e) => set({ is_enabled: e.target.checked })}
                    />
                )}
                label={(
                    <Box>
                        <Typography variant="body2" fontWeight={700}>
                            This service includes communication
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Buying it opens a dedicated channel with the provider.
                        </Typography>
                    </Box>
                )}
            />

            <Collapse in={!!value.is_enabled} unmountOnExit>
                <Box sx={{ pt: 2 }}>
                    {isEditing && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            These terms are copied onto each purchase at the moment it is
                            activated. Changing them affects future buyers only — patients
                            who already bought this service keep the terms they paid for.
                        </Alert>
                    )}

                    <TextField
                        label="Validity (days)"
                        type="number"
                        size="small"
                        inputProps={{ min: 1 }}
                        value={value.validity_days}
                        onChange={(e) => set({ validity_days: e.target.value })}
                        helperText="How long the channel stays open after purchase. After this it becomes read-only — history stays visible, nothing new can be sent."
                        fullWidth
                        sx={{ mb: 2 }}
                    />

                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                        Included features
                    </Typography>
                    <Stack sx={{ mt: 0.5, mb: 1 }}>
                        <FeatureToggle
                            icon={ChatBubbleOutlineIcon}
                            label="Chat"
                            hint="Patient and provider can message each other."
                            checked={!!value.chat_enabled}
                            onChange={(e) => set({ chat_enabled: e.target.checked })}
                        />
                        <FeatureToggle
                            icon={CallIcon}
                            label="Voice calls"
                            hint="Provider schedules them; the patient accepts and joins."
                            checked={!!value.audio_enabled}
                            onChange={(e) => set({ audio_enabled: e.target.checked })}
                        />
                        <FeatureToggle
                            icon={VideocamIcon}
                            label="Video calls"
                            hint="Same scheduling rules as voice."
                            checked={!!value.video_enabled}
                            onChange={(e) => set({ video_enabled: e.target.checked })}
                        />
                        <FeatureToggle
                            icon={DescriptionOutlinedIcon}
                            label="Documents"
                            hint="Both sides can upload files. Prescriptions are unaffected — they keep their own flow."
                            checked={!!value.documents_enabled}
                            onChange={(e) => set({ documents_enabled: e.target.checked })}
                        />
                        <FeatureToggle
                            icon={AssignmentOutlinedIcon}
                            label="Forms"
                            hint="Provider can send forms for the patient to fill in."
                            checked={!!value.forms_enabled}
                            onChange={(e) => set({ forms_enabled: e.target.checked })}
                        />
                    </Stack>

                    <Collapse in={!!value.audio_enabled || !!value.video_enabled} unmountOnExit>
                        <Grid container spacing={2} sx={{ mb: 1 }}>
                            {value.audio_enabled && (
                                <Grid size={{ xs: 12, sm: 6 }}>
                                    <TextField
                                        label="Voice minutes included"
                                        type="number"
                                        size="small"
                                        inputProps={{ min: 0 }}
                                        value={value.audio_minutes_quota}
                                        onChange={(e) => set({ audio_minutes_quota: e.target.value })}
                                        helperText="Blank = unlimited"
                                        fullWidth
                                    />
                                </Grid>
                            )}
                            {value.video_enabled && (
                                <Grid size={{ xs: 12, sm: 6 }}>
                                    <TextField
                                        label="Video minutes included"
                                        type="number"
                                        size="small"
                                        inputProps={{ min: 0 }}
                                        value={value.video_minutes_quota}
                                        onChange={(e) => set({ video_minutes_quota: e.target.value })}
                                        helperText="Blank = unlimited"
                                        fullWidth
                                    />
                                </Grid>
                            )}
                        </Grid>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                            Minutes are charged on time actually connected, not on the length
                            booked — a 30-minute slot where the call runs 13 minutes uses 13.
                        </Typography>
                    </Collapse>

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                label="Max attachment size (MB)"
                                type="number"
                                size="small"
                                inputProps={{ min: 1 }}
                                value={value.max_attachment_mb}
                                onChange={(e) => set({ max_attachment_mb: e.target.value })}
                                fullWidth
                            />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                            <TextField
                                label="Keep history for (days)"
                                type="number"
                                size="small"
                                inputProps={{ min: 0 }}
                                value={value.retention_days}
                                onChange={(e) => set({ retention_days: e.target.value })}
                                helperText="After this, messages and files are deleted."
                                fullWidth
                            />
                        </Grid>
                    </Grid>
                </Box>
            </Collapse>
        </Box>
    );
}
