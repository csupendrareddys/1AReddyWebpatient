/**
 * Account (new look) — port of the mobile MVP's drawer "Account" group: Profile
 * Settings, Notifications, Account Status, Terms & Conditions.
 *
 * Two of those four have no backend behind them in this app:
 *  • Notifications — rides an ASSUMED endpoint (#3 in api/assumedEndpoints.js);
 *    the page it opens states that until the backend ships it.
 *  • Terms & Conditions — a public page exists for signup, not a per-account
 *    acceptance record, so it opens that page and claims nothing more.
 *
 * Account Status IS real: it reads the same holding-account state the layout
 * uses to divert a held patient, so "active" here means the same thing it means
 * to the rest of the app.
 */
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { Avatar, Box, Button, Typography } from '@mui/material';
import NLCard from '../../components/NLCard';
import NLBadge from '../../components/NLBadge';
import NLMenuRow from '../../components/NLMenuRow';
import NLSectionHeader from '../../components/NLSectionHeader';
import { useGetHoldingAccountStateQuery } from '../../../../admin/api/serviceCommunicationEndpoints';
import { useGetPatientMembershipQuery } from '../../../api/patientEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { colors, typography } from '../../theme/tokens';

const Account = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const { user } = useSelector((state) => state.auth);
    const go = (p) => navigate(`${basePath}/${p}`);

    const { data: holding, isLoading: holdLoading } = useGetHoldingAccountStateQuery();
    const { data: membership } = useGetPatientMembershipQuery();

    const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ')
        || user?.full_name || 'Your account';
    const held = !!holding?.held;
    const planName = membership?.plan?.name;

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Account</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Who you are on this platform, and who else can act for you.
            </Typography>

            <NLCard sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
                    <Avatar src={user?.profile_image || undefined} sx={{ width: 56, height: 56 }}>
                        {(name || '?')[0]}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography sx={typography.h3}>{name}</Typography>
                        {user?.email ? (
                            <Typography sx={typography.bodyMuted}>{user.email}</Typography>
                        ) : null}
                        {user?.phone ? (
                            <Typography sx={typography.caption}>{user.phone}</Typography>
                        ) : null}
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'flex-end' }}>
                        {holdLoading ? null : (
                            <NLBadge
                                label={held ? 'On hold' : 'Active'}
                                tone={held ? 'error' : 'success'}
                            />
                        )}
                        {planName ? <NLBadge label={planName} tone="secondary" /> : null}
                    </Box>
                </Box>
                <Button
                    variant="outlined"
                    size="small"
                    sx={{ mt: 1.75 }}
                    onClick={() => go('profile')}
                >
                    Edit profile
                </Button>
            </NLCard>

            {held ? (
                <NLCard sx={{ mb: 3, borderColor: colors.error }}>
                    <Typography sx={{ ...typography.h3, color: colors.error }}>
                        This account is on hold
                    </Typography>
                    <Typography sx={typography.bodyMuted}>
                        {holding?.reason
                            || 'Booking is paused while an administrator reviews the account. Use the admin conversation to sort it out.'}
                    </Typography>
                </NLCard>
            ) : null}

            <NLSectionHeader title="Settings" />
            <NLCard sx={{ p: 0, overflow: 'hidden', mb: 3 }}>
                <NLMenuRow
                    icon="settings-outline"
                    title="Profile Settings"
                    subtitle="Personal details, contact, address, insurance"
                    onClick={() => go('profile')}
                />
                <NLMenuRow
                    icon="shield-outline"
                    title="Account Status"
                    subtitle={held ? 'On hold — booking paused' : 'Active — everything available'}
                    badge={held ? 'On hold' : 'Active'}
                    badgeTone={held ? 'error' : 'success'}
                    tint={held ? colors.error : colors.secondary}
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
                    icon="document-text-outline"
                    title="Terms & Conditions"
                    subtitle="The terms you accepted at signup"
                    onClick={() => window.open('/terms-and-conditions', '_blank', 'noopener')}
                    last
                />
            </NLCard>

            <NLSectionHeader
                title="People"
                subtitle="Profiles you manage, and who may act on your behalf"
            />
            <NLCard sx={{ p: 0, overflow: 'hidden' }}>
                <NLMenuRow
                    icon="people-outline"
                    title="Family & Minors"
                    subtitle="Sub-profiles you manage and accounts shared with you"
                    tint="#5e35b1"
                    onClick={() => go('family')}
                    disabled={!hasFeature('patient.family')}
                />
                <NLMenuRow
                    icon="headset-outline"
                    title="Support Staff"
                    subtitle="Give a caregiver their own login, scoped to what you choose"
                    tint={colors.warning}
                    onClick={() => go('support-staff')}
                    disabled={!hasFeature('patient.family')}
                />
                <NLMenuRow
                    icon="medical-outline"
                    title="Second Opinion"
                    subtitle="Your empanelled family doctor"
                    tint={colors.primary}
                    onClick={() => go('newlook/second-opinion')}
                />
                <NLMenuRow
                    icon="chatbubbles-outline"
                    title="My Services"
                    subtitle="Conversations from services you bought"
                    onClick={() => go('my-services')}
                    last
                />
            </NLCard>
        </Box>
    );
};

export default Account;
