/**
 * Notifications (new look) — port of the mobile MVP's
 * ``app/more/notifications.tsx``: kind-tinted rows, unread styling with the
 * dot, tap to mark read, and "Mark all read".
 *
 * Runs on ASSUMED endpoints #3/#4 (api/assumedEndpoints.js) — the backend has
 * no notifications service yet; the page says so when the call 404s.
 */
import { Box, Button, ButtonBase, CircularProgress, Typography } from '@mui/material';
import NLIcon from '../../components/NLIcon';
import NLEmptyState from '../../components/NLEmptyState';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import {
    useGetNLNotificationsQuery, useMarkNLNotificationsReadMutation,
} from '../../api/assumedEndpoints';
import { clamp, colors, radius, tint, typography } from '../../theme/tokens';
import { fmtDate } from '../../utils/format';

/** Kind → glyph + tint, straight from the mobile file. */
const KIND_ICON = {
    appointment: 'calendar-outline',
    prescription: 'medkit-outline',
    payment: 'wallet-outline',
    general: 'notifications-outline',
};
const KIND_TINT = {
    appointment: colors.primary,
    prescription: colors.secondary,
    payment: colors.warning,
    general: colors.textSecondary,
};

const Notifications = () => {
    const { data: items = [], isLoading, error } = useGetNLNotificationsQuery();
    const [markRead, { isLoading: marking }] = useMarkNLNotificationsReadMutation();

    const unread = items.filter((n) => !n.read).length;

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                <Typography sx={{ ...typography.h1, flex: 1 }}>Notifications</Typography>
                {unread > 0 ? (
                    <Button size="small" disabled={marking} onClick={() => markRead()}>
                        Mark all read
                    </Button>
                ) : null}
            </Box>
            {unread > 0 ? (
                <Typography sx={{ ...typography.bodyMuted, mb: 2 }}>{unread} unread</Typography>
            ) : (
                <Box sx={{ mb: 2 }} />
            )}

            <NLAssumedNotice error={error} endpoint="GET /api/patient/notifications" />

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : items.length ? (
                items.map((n) => {
                    const kind = KIND_ICON[n.kind] ? n.kind : 'general';
                    return (
                        <ButtonBase
                            key={n.id}
                            onClick={n.read ? undefined : () => markRead([n.id])}
                            disabled={n.read}
                            sx={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 1.5,
                                width: '100%',
                                textAlign: 'left',
                                p: '14px',
                                mb: 1.25,
                                borderRadius: `${radius.md}px`,
                                border: `1px solid ${n.read ? colors.border : '#D6E6F8'}`,
                                bgcolor: n.read ? colors.surface : '#F3F8FE',
                            }}
                        >
                            <Box
                                sx={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: `${radius.sm}px`,
                                    bgcolor: tint(KIND_TINT[kind], 0.1),
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                }}
                            >
                                <NLIcon name={KIND_ICON[kind]} size={18} color={KIND_TINT[kind]} />
                            </Box>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Typography
                                    sx={{ ...typography.body, fontWeight: n.read ? 400 : 700 }}
                                >
                                    {n.title}
                                </Typography>
                                <Typography sx={{ ...typography.bodyMuted, mt: '2px', mb: '4px', ...clamp(3) }}>
                                    {n.message}
                                </Typography>
                                <Typography sx={typography.caption}>
                                    {fmtDate(n.date) || n.date}
                                </Typography>
                            </Box>
                            {!n.read ? (
                                <Box
                                    sx={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        bgcolor: colors.primary,
                                        mt: '6px',
                                        flexShrink: 0,
                                    }}
                                />
                            ) : null}
                        </ButtonBase>
                    );
                })
            ) : (
                <NLEmptyState
                    icon="notifications-outline"
                    title="No notifications"
                    subtitle="You're all caught up."
                />
            )}
        </Box>
    );
};

export default Notifications;
