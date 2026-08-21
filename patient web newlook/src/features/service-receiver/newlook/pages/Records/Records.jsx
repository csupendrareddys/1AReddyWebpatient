/**
 * Records (new look) — port of the mobile MVP's Records tab
 * (``app/(tabs)/records.tsx``) plus its drawer group: Health Records,
 * Prescriptions, Documents.
 *
 * A hub, exactly as on mobile: the numbers worth seeing without a tap, then
 * rows into the pages that hold the detail. Every row goes to a real existing
 * page — this adds a way in, not a second copy of each screen.
 */
import { useNavigate } from 'react-router-dom';
import { Alert, Box, CircularProgress, Typography } from '@mui/material';
import NLCard from '../../components/NLCard';
import NLMenuRow from '../../components/NLMenuRow';
import NLSectionHeader from '../../components/NLSectionHeader';
import NLStatTile from '../../components/NLStatTile';
import {
    useGetPatientPrescriptionsQuery,
    useGetPatientDocumentsQuery,
} from '../../../api/scopedBookingApi';
import { useGetVitalsQuery } from '../../../ProfileSetting/api/scopedPatientApi';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import { colors, typography } from '../../theme/tokens';

const Records = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const go = (p) => navigate(`${basePath}/${p}`);

    const { data: prescriptions = [], isLoading: rxLoading } = useGetPatientPrescriptionsQuery();
    const { data: documents = [], isLoading: docsLoading } = useGetPatientDocumentsQuery();
    const { data: vitals, isLoading: vitalsLoading, error: vitalsError } = useGetVitalsQuery();

    const rxCount = Array.isArray(prescriptions) ? prescriptions.length : 0;
    const docCount = Array.isArray(documents) ? documents.length : 0;

    // The mobile hub opens on "Latest vitals" — the one thing a patient checks
    // without wanting a whole page. Field names and the unwrapping below match
    // VitalsSection, which is the component that writes them.
    const v = vitals?.vitals || vitals?.data?.vitals || vitals?.data || vitals;
    const bp = v?.blood_pressure_systolic && v?.blood_pressure_diastolic
        ? `${v.blood_pressure_systolic}/${v.blood_pressure_diastolic} mmHg`
        : null;
    const vitalRows = [
        { label: 'Height', value: v?.height_cm ? `${v.height_cm} cm` : null },
        { label: 'Weight', value: v?.weight_kg ? `${v.weight_kg} kg` : null },
        { label: 'BMI', value: v?.bmi || null },
        { label: 'Blood pressure', value: bp },
        { label: 'Heart rate', value: v?.heart_rate ? `${v.heart_rate} bpm` : null },
        { label: 'SpO₂', value: v?.spo2 ? `${v.spo2}%` : null },
        { label: 'Temperature', value: v?.temperature ? `${v.temperature} °F` : null },
        { label: 'Blood sugar (fasting)', value: v?.blood_sugar_fasting || null },
        { label: 'Blood sugar (post-prandial)', value: v?.blood_sugar_pp || null },
    ].filter((r) => r.value);

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Records</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Your health history, prescriptions and documents in one place.
            </Typography>

            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
                    gap: '10px',
                    mb: 3,
                }}
            >
                <NLStatTile
                    icon="medkit-outline"
                    label="Prescriptions"
                    value={rxLoading ? '—' : String(rxCount)}
                    tint={colors.secondary}
                    onClick={() => go('my-prescriptions')}
                />
                <NLStatTile
                    icon="folder-outline"
                    label="Documents"
                    value={docsLoading ? '—' : String(docCount)}
                    tint={colors.warning}
                    onClick={() => go('my-documents')}
                />
                <NLStatTile
                    icon="pulse-outline"
                    label="Vitals on file"
                    value={vitalsLoading ? '—' : String(vitalRows.length)}
                    tint={colors.error}
                    onClick={() => go('health-records')}
                />
            </Box>

            <NLSectionHeader
                title="Latest vitals"
                actionLabel="View all"
                onAction={() => go('health-records')}
            />
            {vitalsLoading ? (
                <NLCard sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={22} />
                </NLCard>
            ) : vitalsError ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    Couldn’t load your vitals just now.
                </Alert>
            ) : vitalRows.length ? (
                <NLCard sx={{ mb: 3 }}>
                    {vitalRows.map((v, i) => (
                        <Box
                            key={v.label}
                            sx={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                py: 0.75,
                                borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`,
                            }}
                        >
                            <Typography sx={typography.body}>{v.label}</Typography>
                            <Typography
                                sx={{ fontSize: 14, fontWeight: 700, color: colors.textPrimary }}
                            >
                                {v.value}
                            </Typography>
                        </Box>
                    ))}
                </NLCard>
            ) : (
                <NLCard sx={{ mb: 3 }}>
                    <Typography sx={typography.bodyMuted}>
                        No vitals recorded yet. Add them from your health profile so a doctor
                        sees them at your next consultation.
                    </Typography>
                </NLCard>
            )}

            <NLSectionHeader title="Browse" />
            <NLCard sx={{ p: 0, overflow: 'hidden' }}>
                <NLMenuRow
                    icon="pulse-outline"
                    title="Health Records"
                    subtitle="Vitals, habits, surgeries & more"
                    tint={colors.error}
                    onClick={() => go('health-records')}
                />
                <NLMenuRow
                    icon="medkit-outline"
                    title="Prescriptions"
                    subtitle="Medicines & dosages"
                    value={rxLoading ? undefined : rxCount || undefined}
                    tint={colors.secondary}
                    onClick={() => go('my-prescriptions')}
                />
                <NLMenuRow
                    icon="folder-outline"
                    title="Documents"
                    subtitle="Lab reports & files"
                    value={docsLoading ? undefined : docCount || undefined}
                    tint={colors.warning}
                    onClick={() => go('my-documents')}
                />
                <NLMenuRow
                    icon="documents-outline"
                    title="Prescriptions & Documents"
                    subtitle="Both together, with a search"
                    onClick={() => go('my-records')}
                />
                <NLMenuRow
                    icon="medical-outline"
                    title="Second Opinion"
                    subtitle="Ask your family doctor about a prescription"
                    tint={colors.primary}
                    onClick={() => go('newlook/second-opinion')}
                    last
                />
            </NLCard>
        </Box>
    );
};

export default Records;
