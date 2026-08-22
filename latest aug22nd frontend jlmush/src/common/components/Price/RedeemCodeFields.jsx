/**
 * RedeemCodeFields — "have a voucher or coupon code?" at checkout.
 *
 * One component for both places a patient spends money: the appointment
 * booking summary and the marketplace purchase dialog. The two used to be the
 * kind of thing that gets built twice and drifts, and the drift here is
 * expensive — a code that applies on one screen and not the other is a support
 * ticket, not a cosmetic bug.
 *
 * Two fields, not one, because vouchers and coupons are two separate books
 * server-side with independently-managed codes. A single field would have to
 * guess which book a typed code belongs to, and a code present in both would
 * resolve to whichever was searched first.
 *
 * Always rendered. The earlier version listed the offers a buyer's tier made
 * available and hid itself when there were none — which made "no codes apply
 * here" indistinguishable from "this feature is broken", for the patient and
 * for anyone testing it. A field that is always there and answers when you
 * type has no such silent state.
 *
 * Verification is server-side (``POST /api/patient/redeem-code``) and checks
 * three things at once: the code exists, it is live, and an admin attached it
 * to THIS offering for THIS buyer's membership tier. The last is why the code
 * can't be checked client-side — the same code is valid on one doctor's video
 * slot and meaningless on another's.
 *
 * ``onChange`` reports the applied entries; the parent owns the total, since
 * only it knows what the code is being taken off.
 */
import { useEffect, useState } from 'react';
import {
    Box, Button, Chip, Stack, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import { useVerifyRedeemCodeMutation } from '../../../features/service-receiver/api/scopedBookingApi';

const KINDS = [
    { kind: 'voucher', label: 'Voucher code', placeholder: 'e.g. WELCOME50' },
    { kind: 'coupon', label: 'Coupon code', placeholder: 'e.g. FEST20' },
];

/**
 * @param offering  {doctorId, consultationType, duration} | {doctorId, productId}
 * @param applied   [{id, code, label, amount, kind}] — owned by the parent
 * @param onChange  (next) => void
 * @param disabled  block input while the parent is mid-purchase
 */
export default function RedeemCodeFields({
    offering, applied = [], onChange, disabled = false,
}) {
    const [codes, setCodes] = useState({ voucher: '', coupon: '' });
    const [errors, setErrors] = useState({ voucher: null, coupon: null });
    const [verifyCode, { isLoading }] = useVerifyRedeemCodeMutation();

    // A different slot or service is a different offering, so anything already
    // applied stops being applicable — clear it rather than carry a code from
    // one purchase into another.
    const offeringKey = JSON.stringify(offering || {});
    useEffect(() => {
        setCodes({ voucher: '', coupon: '' });
        setErrors({ voucher: null, coupon: null });
        onChange?.([]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [offeringKey]);

    const apply = async (kind) => {
        const code = (codes[kind] || '').trim();
        if (!code) return;
        if (applied.some((a) => a.code?.toUpperCase() === code.toUpperCase())) {
            setErrors((p) => ({ ...p, [kind]: 'Already applied' }));
            return;
        }
        try {
            const entry = await verifyCode({ ...offering, code, kind }).unwrap();
            onChange?.([...applied.filter((a) => a.kind !== kind), entry]);
            setCodes((p) => ({ ...p, [kind]: '' }));
            setErrors((p) => ({ ...p, [kind]: null }));
        } catch (err) {
            setErrors((p) => ({
                ...p,
                [kind]: err?.data?.error || err?.data?.message
                    || err?.message || 'That code could not be applied.',
            }));
        }
    };

    const remove = (id) => onChange?.(applied.filter((a) => a.id !== id));

    return (
        <Box>
            <Typography variant="caption" fontWeight={700} display="block" mb={1}
                color="text.secondary">
                Have a voucher or coupon?
            </Typography>

            {/* Side by side and narrow: a code is at most a dozen characters,
                so a full-width field per kind reads as the main event of the
                summary rather than the optional extra it is. Wraps on a narrow
                viewport. Helper text is only rendered on an error — reserving
                a line for it under both fields left a visible gap. */}
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                {KINDS.map(({ kind, label, placeholder }) => (
                    <Stack key={kind} direction="row" spacing={0.75} alignItems="flex-start">
                        <TextField
                            size="small"
                            label={label}
                            placeholder={placeholder}
                            value={codes[kind]}
                            disabled={disabled}
                            error={!!errors[kind]}
                            helperText={errors[kind] || undefined}
                            onChange={(e) => setCodes(
                                (p) => ({ ...p, [kind]: e.target.value.toUpperCase() }),
                            )}
                            // Enter applies, because a code field that only
                            // responds to a button is the classic way a patient
                            // types a valid code and books without it.
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(kind); } }}
                            inputProps={{ style: { textTransform: 'uppercase' } }}
                            sx={{ width: 160 }}
                        />
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => apply(kind)}
                            disabled={disabled || isLoading || !codes[kind].trim()}
                            sx={{ mt: 0.4, minWidth: 62, textTransform: 'none' }}
                        >
                            Apply
                        </Button>
                    </Stack>
                ))}
            </Stack>

            {applied.length > 0 && (
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap mt={1.25}>
                    {applied.map((a) => (
                        <Chip
                            key={a.id}
                            color="success"
                            variant="outlined"
                            size="small"
                            label={`${a.code} · −₹${a.amount}`}
                            onDelete={disabled ? undefined : () => remove(a.id)}
                            deleteIcon={<CloseIcon />}
                            sx={{ fontWeight: 700 }}
                        />
                    ))}
                </Stack>
            )}
        </Box>
    );
}
