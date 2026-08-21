/**
 * NLBookingDetailDialog — a read-only look at one booking row.
 *
 * The mobile MVP pushes a whole ``/booking-detail`` screen here. That screen
 * isn't part of this port, and a row that opens nothing is worse than a row
 * that opens a summary, so the unified row's own fields are shown in a dialog
 * with a way through to the page that can actually act on the booking
 * (join, pay, attach a document, view a prescription).
 */
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, IconButton, Stack, Typography,
} from '@mui/material';
import NLBadge from './NLBadge';
import NLIcon from './NLIcon';
import { colors, tint, typography } from '../theme/tokens';
import { inr } from '../utils/format';

const Row = ({ label, value }) => (value == null || value === '' ? null : (
    <Box sx={{ display: 'flex', gap: 2, py: '6px' }}>
        <Typography sx={{ ...typography.caption, width: 116, flexShrink: 0 }}>
            {label}
        </Typography>
        <Typography sx={{ ...typography.body, flex: 1, minWidth: 0 }}>{value}</Typography>
    </Box>
));

const NLBookingDetailDialog = ({
    open, booking, statusLabel, onClose, onOpenFull, onRebook, onViewCredits,
}) => {
    if (!booking) return null;

    return (
        <Dialog open={!!open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, pb: 1 }}>
                <Box
                    sx={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        bgcolor: tint(booking.tint, 0.1),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <NLIcon name={booking.icon} size={20} color={booking.tint} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={typography.h3}>{booking.title}</Typography>
                    <Typography sx={typography.bodyMuted}>{booking.subtitle}</Typography>
                </Box>
                <IconButton onClick={onClose} size="small" aria-label="Close">
                    <NLIcon name="close" size={20} color={colors.textSecondary} />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={{ pt: 0 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5 }} flexWrap="wrap" useFlexGap>
                    <NLBadge label={booking.kindLabel} tone="neutral" />
                    {booking.statusLabel ? (
                        <NLBadge
                            label={booking.statusLabel}
                            tone={booking.isCancelled ? 'error'
                                : booking.view === 'completed' ? 'success'
                                    : booking.view === 'in_progress' ? 'warning'
                                        : booking.view === 'pending' ? 'warning' : 'primary'}
                        />
                    ) : null}
                    {booking.cancelledTag ? (
                        <NLBadge label={booking.cancelledTag} tone="error" />
                    ) : null}
                </Stack>

                {/* What this booking is waiting on, and whose move it is. */}
                {booking.pendingLabel ? (
                    <Alert
                        severity={booking.pendingReason === 'payment' ? 'warning' : 'info'}
                        sx={{ mb: 1.5 }}
                    >
                        {booking.pendingLabel}
                        {booking.pendingReason === 'payment'
                            ? ' — the slot is only held until payment is settled.'
                            : ' — nothing for you to do until they respond.'}
                    </Alert>
                ) : null}
                <Divider />
                <Box sx={{ mt: 1 }}>
                    <Row label="When" value={booking.meta} />
                    {/* ``statusLabel`` is the stage the LIST is showing, which is
                        too coarse inside Pending — an unpaid booking isn't
                        "waiting to be accepted", it's waiting on the patient. The
                        row's own reason wins where it has one. */}
                    <Row
                        label="Stage"
                        value={booking.pendingReason === 'payment' ? 'Waiting for payment'
                            : booking.pendingReason === 'approval' ? 'Waiting to be accepted'
                                : booking.cancelledTag ? `Finished · ${booking.cancelledTag.toLowerCase()}`
                                    : statusLabel}
                    />
                    <Row label="Category" value={booking.categoryLabel} />
                    <Row
                        label="Amount"
                        value={booking.amount != null
                            ? `${inr(booking.amount)}${booking.paid ? ' · Paid' : ' · Not paid'}`
                            : null}
                    />
                    <Row label="Reference" value={String(booking.rawId || '').toUpperCase()} />
                </Box>

                {/* A booking that ended without being delivered owes the patient
                    their money back. For a consultation the backend has already
                    done it — cancel() and the auto-reject path both call
                    credit_service.refund_for_ref, which returns the health
                    credits to the wallet and releases the slot. So this states
                    what happened rather than offering a button that would
                    re-request a refund already made. Anything paid by card/UPI is
                    settled by the clinic, and services and plans are settled by
                    the provider, so neither is claimed as automatic. */}
                {booking.isCancelled ? (
                    <Alert severity="info" sx={{ mt: 1.5 }}>
                        {booking.refundsToWallet
                            ? 'Any health credits used for this booking have been returned to your wallet — you can spend them on a new booking straight away. A card or UPI payment is refunded by the clinic.'
                            : 'Refunds for a cancelled service or plan are settled by the provider. Contact them, or your care team, if it hasn’t reached you.'}
                    </Alert>
                ) : null}
            </DialogContent>

            <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button onClick={onClose}>Close</Button>
                {booking.isCancelled && onViewCredits ? (
                    <Button onClick={() => onViewCredits(booking)}>View credits</Button>
                ) : null}
                {booking.isCancelled && onRebook ? (
                    <Button variant="contained" onClick={() => onRebook(booking)}>
                        Book again
                    </Button>
                ) : onOpenFull ? (
                    <Button variant="contained" onClick={() => onOpenFull(booking)}>
                        {booking.pendingReason === 'payment' ? 'Settle payment' : 'Open booking'}
                    </Button>
                ) : null}
            </DialogActions>
        </Dialog>
    );
};

export default NLBookingDetailDialog;
