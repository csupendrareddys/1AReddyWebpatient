/**
 * Profile (new look) — port of the mobile MVP's ``app/(tabs)/profile.tsx``:
 * identity card, the Personal / Health / Emergency / Insurance tab split
 * (rather than one long form), the membership card, and the account menu.
 *
 * Wired to REAL endpoints — the same scoped profile-section hooks the classic
 * ProfileSetting page uses, read-only here. Editing stays on that page: this
 * tab is for reading your own record at a glance, as on mobile.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Avatar, Box, Button, ButtonBase, CircularProgress, Typography } from '@mui/material';
import NLCard from '../../components/NLCard';
import NLBadge from '../../components/NLBadge';
import NLIcon from '../../components/NLIcon';
import NLMenuRow from '../../components/NLMenuRow';
import NLSectionHeader from '../../components/NLSectionHeader';
import {
    useGetPersonalDetailsQuery,
    useGetEmergencyContactQuery,
    useGetInsuranceQuery,
    useGetVitalsQuery,
} from '../../../ProfileSetting/api/scopedPatientApi';
import { useGetPatientMembershipQuery } from '../../../api/patientEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { colors, radius, tint, typography } from '../../theme/tokens';
import { fmtDate, humanise } from '../../utils/format';

const TABS = ['Personal', 'Health', 'Emergency', 'Insurance'];

const Field = ({ label, value }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75 }}>
        <Typography sx={typography.bodyMuted}>{label}</Typography>
        <Typography sx={{ ...typography.body, fontWeight: 600, textAlign: 'right', minWidth: 0 }}>
            {value || '—'}
        </Typography>
    </Box>
);

const VitalTile = ({ icon, label, value }) => (
    <Box
        sx={{
            p: 1.5,
            borderRadius: `${radius.sm}px`,
            bgcolor: colors.background,
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
        }}
    >
        <NLIcon name={icon} size={17} color={colors.primary} />
        <Typography sx={{ fontSize: 16, fontWeight: 800, color: colors.textPrimary }}>
            {value || '—'}
        </Typography>
        <Typography sx={typography.caption}>{label}</Typography>
    </Box>
);

const ChipBlock = ({ label, items, tone }) => (items?.length ? (
    <Box sx={{ mt: 1.5 }}>
        <Typography sx={typography.label}>{label.toUpperCase()}</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', mt: 0.75 }}>
            {items.map((i) => <NLBadge key={i} label={i} tone={tone} />)}
        </Box>
    </Box>
) : null);

const Profile = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const { user } = useSelector((state) => state.auth);
    const go = (p) => navigate(`${basePath}/${p}`);

    const [tab, setTab] = useState('Personal');

    const { data: personal, isLoading: personalLoading } = useGetPersonalDetailsQuery();
    const { data: emergency } = useGetEmergencyContactQuery();
    const { data: insurance } = useGetInsuranceQuery();
    const { data: vitalsData } = useGetVitalsQuery();
    const { data: membership } = useGetPatientMembershipQuery();

    // Same unwrapping VitalsSection uses — the payload shape varies by scope.
    const vitals = vitalsData?.vitals || vitalsData?.data?.vitals || vitalsData?.data || vitalsData || {};
    const allergies = (vitals.allergies || []).map((a) => a?.name || a).filter(Boolean);

    const name = [personal?.first_name, personal?.middle_name, personal?.last_name]
        .filter(Boolean).join(' ') || user?.full_name || 'Your profile';
    const planName = membership?.plan?.name;

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Profile</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Your record as a doctor sees it. Edit anything from Profile Settings.
            </Typography>

            <NLCard sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 2 }}>
                <Avatar
                    src={personal?.profile_image || user?.profile_image || undefined}
                    sx={{ width: 56, height: 56 }}
                >
                    {(name || '?')[0]}
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={typography.h3}>{name}</Typography>
                    {user?.email ? <Typography sx={typography.bodyMuted}>{user.email}</Typography> : null}
                    {user?.phone ? <Typography sx={typography.bodyMuted}>{user.phone}</Typography> : null}
                </Box>
                <Button size="small" variant="outlined" onClick={() => go('profile')}>
                    Edit
                </Button>
            </NLCard>

            {/* Tabbed detail — the mobile split, not one long form. */}
            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', mb: 1.5 }}>
                {TABS.map((t) => {
                    const active = tab === t;
                    return (
                        <ButtonBase
                            key={t}
                            onClick={() => setTab(t)}
                            aria-pressed={active}
                            sx={{
                                px: '16px',
                                py: '9px',
                                borderRadius: `${radius.pill}px`,
                                border: `1px solid ${active ? colors.primary : colors.border}`,
                                bgcolor: active ? colors.primary : colors.surface,
                                color: active ? colors.white : colors.textSecondary,
                                fontSize: 12.5,
                                fontWeight: 600,
                            }}
                        >
                            {t}
                        </ButtonBase>
                    );
                })}
            </Box>

            <NLCard sx={{ mb: 3 }}>
                {personalLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                        <CircularProgress size={22} />
                    </Box>
                ) : tab === 'Personal' ? (
                    <>
                        <Field label="Full name" value={name} />
                        <Field label="Email" value={user?.email} />
                        <Field label="Phone" value={user?.phone} />
                        <Field label="Gender" value={humanise(personal?.gender)} />
                        <Field label="Date of birth" value={fmtDate(personal?.dob)} />
                        <Field
                            label="Languages"
                            value={Array.isArray(personal?.languages_known)
                                ? personal.languages_known.join(', ')
                                : personal?.languages_known}
                        />
                    </>
                ) : tab === 'Health' ? (
                    <>
                        <Box
                            sx={{
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                                gap: '10px',
                            }}
                        >
                            <VitalTile icon="water-outline" label="Blood group" value={personal?.blood_group} />
                            <VitalTile
                                icon="accessibility-outline"
                                label="Height"
                                value={vitals.height_cm ? `${vitals.height_cm} cm` : null}
                            />
                            <VitalTile
                                icon="fitness-outline"
                                label="Weight"
                                value={vitals.weight_kg ? `${vitals.weight_kg} kg` : null}
                            />
                            <VitalTile
                                icon="warning-outline"
                                label="Allergies"
                                value={String(allergies.length)}
                            />
                        </Box>
                        <ChipBlock label="Allergies" items={allergies} tone="error" />
                        <Button
                            size="small"
                            sx={{ mt: 2 }}
                            startIcon={<NLIcon name="pulse-outline" size={15} />}
                            onClick={() => go('health-records')}
                        >
                            Full health record
                        </Button>
                    </>
                ) : tab === 'Emergency' ? (
                    <>
                        <Field label="Contact name" value={emergency?.emergency_contact_name} />
                        <Field label="Phone" value={emergency?.emergency_contact_phone} />
                        <Field label="Relationship" value={emergency?.emergency_contact_relation} />
                        <Field label="Email" value={emergency?.emergency_contact_email} />
                    </>
                ) : (
                    <>
                        <Field label="Provider" value={insurance?.insurance_provider} />
                        <Field label="Policy number" value={insurance?.insurance_policy_number} />
                        <Field label="Valid till" value={fmtDate(insurance?.insurance_valid_till)} />
                        <Field label="Coverage" value={insurance?.insurance_coverage_amount} />
                    </>
                )}
            </NLCard>

            <NLSectionHeader
                title="Membership"
                actionLabel="Manage"
                onAction={() => go('my-membership')}
            />
            <NLCard sx={{ mb: 3 }}>
                {planName ? (
                    <>
                        <Typography sx={typography.h3}>{planName} plan</Typography>
                        <Typography sx={typography.bodyMuted}>
                            {membership?.expires_at
                                ? `Renews on ${fmtDate(membership.expires_at)}`
                                : 'Active membership'}
                        </Typography>
                    </>
                ) : (
                    <Typography sx={typography.bodyMuted}>
                        You&apos;re not on a membership plan. Plans bundle discounts and
                        health credits.
                    </Typography>
                )}
            </NLCard>

            <NLSectionHeader title="Account" />
            <NLCard sx={{ p: 0, overflow: 'hidden', mb: 3 }}>
                <NLMenuRow
                    icon="settings-outline"
                    title="Profile Settings"
                    subtitle="All your profile sections, editable"
                    onClick={() => go('profile')}
                />
                <NLMenuRow
                    icon="notifications-outline"
                    title="Notifications"
                    subtitle="Alerts and reminders"
                    tint={colors.warning}
                    onClick={() => go('newlook/notifications')}
                />
                <NLMenuRow
                    icon="wallet-outline"
                    title="Wallet"
                    subtitle="Balance and transactions"
                    tint={colors.secondary}
                    onClick={() => go('newlook/wallet')}
                />
                <NLMenuRow
                    icon="people-outline"
                    title="Family"
                    subtitle="Manage linked members"
                    tint="#5e35b1"
                    onClick={() => go('family')}
                    disabled={!hasFeature('patient.family')}
                />
                <NLMenuRow
                    icon="headset-outline"
                    title="Support staff"
                    subtitle="Your assigned care team"
                    tint={colors.secondary}
                    onClick={() => go('support-staff')}
                    disabled={!hasFeature('patient.family')}
                    last
                />
            </NLCard>

            <NLSectionHeader title="Explore" />
            <NLCard sx={{ p: 0, overflow: 'hidden' }}>
                <NLMenuRow
                    icon="heart-circle-outline"
                    title="Health plans"
                    tint="#5e35b1"
                    onClick={() => go('health-plans')}
                />
                <NLMenuRow
                    icon="storefront-outline"
                    title="Services"
                    tint={colors.secondary}
                    onClick={() => go('marketplace')}
                    disabled={!hasFeature('clinic.marketplace')}
                />
                <NLMenuRow
                    icon="document-text-outline"
                    title="Terms & Conditions"
                    tint={colors.warning}
                    onClick={() => window.open('/terms-and-conditions', '_blank', 'noopener')}
                    last
                />
            </NLCard>
        </Box>
    );
};

export default Profile;
