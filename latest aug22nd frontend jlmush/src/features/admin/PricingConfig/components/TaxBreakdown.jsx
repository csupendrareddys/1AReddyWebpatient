/**
 * TaxBreakdown — the Indian GST/TDS split for one pricing-table row.
 *
 * The Display Price column shows a single number, but under GST that number is
 * two separate supplies with two separate taxable values:
 *
 *   1. **The doctor's supply** — their professional / healthcare service. The
 *      fee they quoted is TAX-INCLUSIVE ("Your quoted price is inclusive of
 *      applicable taxes and is your payout amount"), so GST is *carved out* of
 *      it, never added on top.
 *   2. **The platform's supply** — the facilitation margin, i.e. the increment
 *      and discount this page adds. Standard-rated (18% today), independent of
 *      whatever the healthcare supply attracts — which may be exempt under
 *      Notification 12/2017-CT(R) Entry 74.
 *
 * TDS (s.194J) is a deduction from the *doctor's* fee, not from the patient's
 * total and not from the platform's margin.
 *
 * The pricing table is already width-constrained, so this renders as a single
 * icon button that opens a popover — no extra columns. Numbers update live
 * from the local ``computeTaxBreakdown`` mirror while the admin types; the
 * authoritative math is ``POST /api/admin/tax-config/breakdown``, and a
 * server-computed row can be passed in as ``breakdown`` to use it instead.
 */
import { useState, useMemo } from 'react';
import {
    Box, Popover, Stack, Typography, Divider, Chip, IconButton, Tooltip,
    Table, TableBody, TableRow, TableCell, Alert, CircularProgress,
} from '@mui/material';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import { useGetTaxConfigQuery, computeTaxBreakdown } from '../../api/taxEndpoints';

const inr = (n) => (n == null || n === ''
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    })}`);

const pct = (n) => `${Number(n || 0)}%`;

const MODE_CHIP = {
    none: { label: 'Exempt', color: 'default' },
    intra_state: { label: 'Intra-state', color: 'info' },
    inter_state: { label: 'Inter-state', color: 'warning' },
    // Only the server knows the doctor's state, so the client preview reports
    // the GST total without naming CGST+SGST vs IGST (they are equal in total).
    auto: { label: 'Per place of supply', color: 'default' },
};

/** One label/value line. ``strong`` for subtotals, ``dim`` for derivations. */
const Line = ({ label, value, strong = false, dim = false, note }) => (
    <TableRow>
        <TableCell
            sx={{
                border: 0, py: 0.4, pl: 0, pr: 2,
                color: dim ? 'text.secondary' : 'text.primary',
                fontWeight: strong ? 700 : 400,
            }}
        >
            {label}
            {note && (
                <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>
                    {note}
                </Typography>
            )}
        </TableCell>
        <TableCell
            align="right"
            sx={{
                border: 0, py: 0.4, pr: 0, whiteSpace: 'nowrap',
                fontWeight: strong ? 700 : 400,
                color: dim ? 'text.secondary' : 'text.primary',
            }}
        >
            {value}
        </TableCell>
    </TableRow>
);

const SectionTitle = ({ children, mode }) => (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.5, mb: 0.5 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary"
            sx={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {children}
        </Typography>
        {mode && (
            <Chip
                size="small"
                variant="outlined"
                color={MODE_CHIP[mode]?.color || 'default'}
                label={MODE_CHIP[mode]?.label || mode}
                sx={{ height: 18, fontSize: '0.65rem' }}
            />
        )}
    </Stack>
);

/**
 * Props — the pricing table already holds every one of these on its row state,
 * so mounting this is a one-liner (see the integration notes at the bottom of
 * this file).
 *
 * @param {number|string}  doctorFee         the doctor's own quoted price,
 *                                           TAX-INCLUSIVE (their payout).
 * @param {number|string} [displayPrice]     what the patient is quoted /
 *                                           charged (the Display Price cell).
 *                                           Defaults to ``doctorFee``.
 * @param {string}        [consultationType] 'video' | 'audio' | … — selects the
 *                                           per-type GST override.
 * @param {string}        [scopeType]        the table's scope axis; used when
 *                                           ``consultationType`` is absent
 *                                           ('service' for catalog items).
 * @param {object}        [breakdown]        a server-computed row from
 *                                           POST /api/admin/tax-config/breakdown.
 *                                           When given it is rendered verbatim
 *                                           and no config fetch happens.
 * @param {string}        [doctorName]       shown in the popover header.
 * @param {number|string} [tdsRate]          this doctor's own TDS rate (the
 *                                           per-doctor billing-profile
 *                                           override, else the tenant flat
 *                                           rate). The tax config only carries
 *                                           the tenant rate, so without this a
 *                                           doctor on an override is quoted the
 *                                           default.
 * @param {'small'|'medium'} [size]          icon-button size.
 */
const TaxBreakdown = ({
    doctorFee,
    displayPrice,
    consultationType,
    scopeType,
    breakdown: serverBreakdown = null,
    doctorName = null,
    tdsRate = null,
    size = 'small',
}) => {
    const [anchorEl, setAnchorEl] = useState(null);

    // One config fetch for the whole table — RTK Query dedupes it across rows.
    const { data: config, isLoading, error } = useGetTaxConfigQuery(undefined, {
        skip: !!serverBreakdown,
    });

    // ``scopeType`` is the pricing table's axis and is the consultation type
    // for consultations ('video', '10-20' scope) or the literal 'service'.
    const type = consultationType || scopeType || null;

    const b = useMemo(() => {
        if (serverBreakdown) return serverBreakdown;
        if (!config) return null;
        return computeTaxBreakdown({
            doctorFee, displayPrice, config, consultationType: type, tdsRate,
        });
    }, [serverBreakdown, config, doctorFee, displayPrice, type, tdsRate]);

    const open = Boolean(anchorEl);

    return (
        <>
            <Tooltip title="GST / TDS breakdown">
                <IconButton
                    size={size}
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    aria-label="Show tax breakdown"
                >
                    <ReceiptLongIcon fontSize="inherit" />
                </IconButton>
            </Tooltip>

            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { p: 2, width: 380, maxWidth: '95vw' } } }}
            >
                <Typography variant="subtitle2" fontWeight={700}>
                    Tax breakdown
                    {doctorName && (
                        <Typography component="span" variant="body2"
                            color="text.secondary" sx={{ ml: 0.5 }}>
                            — {doctorName}
                        </Typography>
                    )}
                </Typography>

                {isLoading && <CircularProgress size={20} sx={{ mt: 2 }} />}
                {error && (
                    <Alert severity="error" sx={{ mt: 1.5 }}>
                        Could not load the tax configuration.
                    </Alert>
                )}

                {b && (
                    <Box sx={{ mt: 1 }}>
                        <Table size="small" sx={{ '& td': { fontSize: '0.8rem' } }}>
                            <TableBody>
                                {/* ── supply 1: the doctor ── */}
                                <TableRow>
                                    <TableCell colSpan={2} sx={{ border: 0, p: 0 }}>
                                        <SectionTitle mode={b.doctor_tax_mode}>
                                            Doctor&apos;s supply
                                        </SectionTitle>
                                    </TableCell>
                                </TableRow>
                                <Line
                                    label="Doctor fee (tax-inclusive)"
                                    value={inr(b.doctor_fee)}
                                    strong
                                />
                                <Line
                                    label="Taxable value"
                                    value={inr(b.doctor_taxable_value)}
                                    dim
                                    note="GST carved out of the fee, not added on top"
                                />
                                {b.doctor_tax_mode === 'intra_state' && (
                                    <>
                                        <Line label={`CGST @ ${pct(b.doctor_cgst_rate)}`}
                                            value={inr(b.doctor_cgst)} dim />
                                        <Line label={`SGST @ ${pct(b.doctor_sgst_rate)}`}
                                            value={inr(b.doctor_sgst)} dim />
                                    </>
                                )}
                                {b.doctor_tax_mode === 'inter_state' && (
                                    <Line label={`IGST @ ${pct(b.doctor_igst_rate)}`}
                                        value={inr(b.doctor_igst)} dim />
                                )}
                                {b.doctor_tax_mode === 'auto' && (
                                    <Line
                                        label={`GST @ ${pct(b.doctor_igst_rate)}`}
                                        value={inr(b.doctor_gst_total)}
                                        dim
                                        note="CGST+SGST or IGST — resolved from the doctor's state at payout"
                                    />
                                )}
                                {b.doctor_tax_mode === 'none' && (
                                    <Line
                                        label="GST"
                                        value="Exempt"
                                        dim
                                        note="Notification 12/2017-CT(R) Entry 74 — healthcare services"
                                    />
                                )}

                                {/* ── supply 2: the platform ── */}
                                <TableRow>
                                    <TableCell colSpan={2} sx={{ border: 0, p: 0 }}>
                                        <SectionTitle mode={b.platform_tax_mode}>
                                            Platform&apos;s supply
                                        </SectionTitle>
                                    </TableCell>
                                </TableRow>
                                <Line
                                    label="Platform fee"
                                    value={inr(b.platform_fee)}
                                    strong
                                    note="Display price − doctor fee"
                                />
                                {Number(b.platform_subsidy) > 0 && (
                                    <Line
                                        label="Platform subsidy"
                                        value={`− ${inr(b.platform_subsidy)}`}
                                        dim
                                        note="Discount takes the price below the doctor's fee"
                                    />
                                )}
                                <Line
                                    label="Taxable value"
                                    value={inr(b.platform_taxable_value)}
                                    dim
                                    note={b.platform_tax_inclusive === false
                                        ? 'GST added on top of the margin'
                                        : 'GST carved out of the margin'}
                                />
                                {b.platform_tax_mode === 'intra_state' && (
                                    <>
                                        <Line label={`CGST @ ${pct(b.platform_cgst_rate)}`}
                                            value={inr(b.platform_cgst)} dim />
                                        <Line label={`SGST @ ${pct(b.platform_sgst_rate)}`}
                                            value={inr(b.platform_sgst)} dim />
                                    </>
                                )}
                                {b.platform_tax_mode === 'inter_state' && (
                                    <Line label={`IGST @ ${pct(b.platform_igst_rate)}`}
                                        value={inr(b.platform_igst)} dim />
                                )}
                                {b.platform_tax_mode === 'auto' && (
                                    <Line
                                        label={`GST @ ${pct(b.platform_igst_rate)}`}
                                        value={inr(b.platform_gst_total)}
                                        dim
                                        note="CGST+SGST or IGST — resolved from the doctor's state at payout"
                                    />
                                )}
                                {b.platform_tax_mode === 'none' && (
                                    <Line label="GST" value="Exempt" dim />
                                )}
                            </TableBody>
                        </Table>

                        <Divider sx={{ my: 1.25 }} />

                        <Table size="small" sx={{ '& td': { fontSize: '0.8rem' } }}>
                            <TableBody>
                                <Line label="Total GST" value={inr(b.gst_total)} strong />
                                <Line
                                    label={`TDS @ ${pct(b.tds_rate)} (s.194J)`}
                                    value={`− ${inr(b.tds_amount)}`}
                                    note={`On the doctor's fee of ${inr(b.tds_base)}`}
                                />
                                <Line
                                    label="Patient pays"
                                    value={inr(b.total_to_patient)}
                                    strong
                                />
                                <Line
                                    label="Net to doctor"
                                    value={inr(b.net_to_doctor)}
                                    strong
                                />
                                <Line
                                    label="Platform revenue (ex-GST)"
                                    value={inr(b.platform_net_revenue)}
                                    dim
                                />
                            </TableBody>
                        </Table>

                        <Typography variant="caption" color="text.disabled"
                            sx={{ display: 'block', mt: 1.25 }}>
                            The doctor&apos;s fee and the platform&apos;s margin are separate
                            supplies with separate taxable values — GST is never levied on the
                            two combined. Preview only; the payout is computed server-side.
                        </Typography>

                        {Array.isArray(b.notes) && b.notes.length > 0 && (
                            <Alert severity="info" sx={{ mt: 1.25, py: 0.25 }}>
                                <Typography variant="caption">{b.notes.join(' ')}</Typography>
                            </Alert>
                        )}
                    </Box>
                )}
            </Popover>
        </>
    );
};

export default TaxBreakdown;
