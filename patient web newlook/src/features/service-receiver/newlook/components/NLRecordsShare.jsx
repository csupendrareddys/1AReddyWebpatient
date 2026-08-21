/**
 * NLRecordsShare — port of the mobile MVP's ``MedicalRecordsShare``: the step
 * where the patient chooses what the doctor gets to see.
 *
 * Sharing is opt-in and section by section. Nothing here blocks the flow — a
 * patient who shares nothing can still book — but what IS shared is named
 * explicitly on the summary before they pay, because that's their last chance
 * to notice something they'd rather keep private going with it.
 *
 * The symptom list is REAL (``/patient/symptoms``); the record sections are the
 * patient's own profile sections, which the doctor already reads through the
 * appointment's medical context.
 */
import { Box, Checkbox, Chip, FormControlLabel, Switch, TextField, Typography } from '@mui/material';
import NLCard from './NLCard';
import NLIcon from './NLIcon';
import { useGetSymptomsQuery } from '../../api/scopedBookingApi';
import { colors, radius, typography } from '../theme/tokens';

/** The profile sections a doctor can be given, as the mobile app groups them. */
export const SHARE_SECTIONS = [
    { key: 'vitals', title: 'Vitals', sub: 'Height, weight, BP, sugar', icon: 'pulse-outline' },
    { key: 'allergies', title: 'Allergies', sub: 'Known reactions', icon: 'warning-outline' },
    { key: 'conditions', title: 'Chronic conditions', sub: 'Ongoing diagnoses', icon: 'medkit-outline' },
    { key: 'medications', title: 'Current medications', sub: 'What you take now', icon: 'medical-outline' },
    { key: 'prescriptions', title: 'Prescriptions', sub: 'Past prescriptions', icon: 'document-text-outline' },
    { key: 'reports', title: 'Lab reports', sub: 'Uploaded documents', icon: 'folder-outline' },
    { key: 'surgeries', title: 'Surgeries', sub: 'Procedures you had', icon: 'clipboard-outline' },
];

/** A blank share, so both flows start from the same shape. */
export const emptyShare = () => ({
    share: false,
    sections: {},
    symptoms: [],
    note: '',
});

const NLRecordsShare = ({ value, onChange, patientName = 'you' }) => {
    const { data: symptomsData } = useGetSymptomsQuery();
    const symptoms = (symptomsData?.symptoms || []).slice(0, 24);

    const set = (patch) => onChange({ ...value, ...patch });
    const toggleSection = (key) => set({
        sections: { ...value.sections, [key]: !value.sections[key] },
    });
    const toggleSymptom = (name) => set({
        symptoms: value.symptoms.includes(name)
            ? value.symptoms.filter((s) => s !== name)
            : [...value.symptoms, name],
    });

    return (
        <Box>
            <Typography sx={{ ...typography.label, mb: 1 }}>WHAT&apos;S BOTHERING YOU?</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 1.25 }}>
                Optional, and it helps the doctor prepare before the consultation starts.
            </Typography>
            {symptoms.length ? (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '7px', mb: 1.5 }}>
                    {symptoms.map((s) => {
                        const name = s.name || s;
                        const on = value.symptoms.includes(name);
                        return (
                            <Chip
                                key={s.id || name}
                                label={name}
                                onClick={() => toggleSymptom(name)}
                                color={on ? 'primary' : 'default'}
                                variant={on ? 'filled' : 'outlined'}
                                size="small"
                            />
                        );
                    })}
                </Box>
            ) : null}

            <TextField
                value={value.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="Anything else the doctor should know?"
                size="small"
                fullWidth
                multiline
                minRows={2}
                sx={{ mb: 3 }}
            />

            <Typography sx={{ ...typography.label, mb: 1 }}>SHARE MEDICAL RECORDS</Typography>
            <NLCard sx={{ mb: 1.5 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={value.share}
                            onChange={(e) => set({ share: e.target.checked })}
                        />
                    }
                    label={
                        <Box>
                            <Typography sx={{ ...typography.body, fontWeight: 600 }}>
                                Share {patientName === 'you' ? 'your' : `${patientName}'s`} records
                            </Typography>
                            <Typography sx={typography.bodyMuted}>
                                Off by default. Only the sections you tick are shared, and only
                                with this doctor for this booking.
                            </Typography>
                        </Box>
                    }
                />
            </NLCard>

            {value.share ? (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                        gap: '10px',
                    }}
                >
                    {SHARE_SECTIONS.map((s) => {
                        const on = !!value.sections[s.key];
                        return (
                            <Box
                                key={s.key}
                                onClick={() => toggleSection(s.key)}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    p: '10px 12px',
                                    cursor: 'pointer',
                                    borderRadius: `${radius.md}px`,
                                    border: `1px solid ${on ? colors.primary : colors.border}`,
                                    bgcolor: colors.surface,
                                }}
                            >
                                <NLIcon
                                    name={s.icon}
                                    size={18}
                                    color={on ? colors.primary : colors.textMuted}
                                />
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={{ ...typography.body, fontWeight: 600 }}>
                                        {s.title}
                                    </Typography>
                                    <Typography sx={typography.caption}>{s.sub}</Typography>
                                </Box>
                                <Checkbox checked={on} size="small" />
                            </Box>
                        );
                    })}
                </Box>
            ) : null}
        </Box>
    );
};

/** The sections actually ticked, by title — for the pre-payment summary. */
export const sharedSectionTitles = (share) => SHARE_SECTIONS
    .filter((s) => share.sections[s.key])
    .map((s) => s.title);

export default NLRecordsShare;
