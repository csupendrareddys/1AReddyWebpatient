/**
 * Tax Configuration endpoints (RTK Query) — Indian GST/TDS, two-supply model.
 *
 * The patient pays one number, but it is two supplies under GST:
 *   1. the doctor's professional / healthcare service — their quoted fee,
 *      which is TAX-INCLUSIVE, so GST is carved OUT of it;
 *   2. the platform's facilitation margin (display price − doctor fee) — a
 *      separate supply at its own rate (standard-rated 18% today).
 *
 * ``/api/admin/tax-config/breakdown`` is the authoritative math (it mirrors
 * ``app/common/tax.py``). ``computeTaxBreakdown`` below is a client mirror used
 * only for instant feedback while an admin types in the pricing table, the same
 * way ``PricingConfig.jsx`` already mirrors ``apply_rule``. When the two
 * disagree, the server is right.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/admin/tax-config';

/** Mirrors ``app/common/tax.py`` / ``DoctorProduct.tax_mode``. */
export const TAX_MODES = ['none', 'intra_state', 'inter_state', 'auto'];

export const TAX_MODE_LABELS = {
    none: 'Exempt / Nil-rated',
    intra_state: 'Intra-state (CGST + SGST)',
    inter_state: 'Inter-state (IGST)',
    auto: 'Auto (from place of supply)',
};

const taxEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // { doctor_supply, platform_supply, tds, place_of_supply, tax_modes, flat }
        getTaxConfig: builder.query({
            query: () => ({ url: API_BASE, method: 'GET' }),
            transformResponse: (res) => res?.data || null,
            providesTags: [{ type: 'TaxConfig', id: 'CONFIG' }],
        }),

        updateTaxConfig: builder.mutation({
            // Body takes the flat BillingConfig column names — see
            // ``RATE_FIELDS`` / ``MODE_FIELDS`` in app/api/admin/tax_config.py.
            query: (body) => ({ url: API_BASE, method: 'PUT', data: body }),
            transformResponse: (res) => res?.data || null,
            invalidatesTags: [{ type: 'TaxConfig', id: 'CONFIG' }],
        }),

        // Server-authoritative itemised split for a whole pricing table.
        // arg: { scopeType, scopeKey, rows: [{ doctor_id, doctor_fee, display_price }] }
        getTaxBreakdown: builder.query({
            query: ({ scopeType, scopeKey, rows }) => ({
                url: `${API_BASE}/breakdown`,
                method: 'POST',
                data: { scope_type: scopeType, scope_key: scopeKey, rows },
            }),
            transformResponse: (res) => res?.data || { rows: [], totals: {} },
            providesTags: (result, error, arg) => [
                { type: 'TaxConfig', id: `BREAKDOWN-${arg?.scopeType}-${arg?.scopeKey}` },
            ],
        }),
    }),
});

// ─── client-side mirror of app/common/tax.py ──────────────────────────────

/** Round to 2dp, half-up (JS's toFixed rounds half-to-even on some values). */
const money = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return 0;
    return Math.sign(v) * Math.round(Math.abs(v) * 100 + Number.EPSILON) / 100;
};

/** Split a tax-INCLUSIVE gross into { taxable, tax } — mirrors ``carve_out``. */
export const carveOut = (gross, totalRate) => {
    const g = money(gross);
    const r = Number(totalRate) || 0;
    if (r <= 0 || g <= 0) return { taxable: g, tax: 0 };
    const taxable = money((g * 100) / (100 + r));
    return { taxable, tax: money(g - taxable) };
};

/** Split a tax-EXCLUSIVE net into { taxable, tax } — mirrors ``add_on``. */
export const addOn = (net, totalRate) => {
    const n = money(net);
    const r = Number(totalRate) || 0;
    if (r <= 0 || n <= 0) return { taxable: n, tax: 0 };
    return { taxable: n, tax: money((n * r) / 100) };
};

/**
 * CGST/SGST/IGST for a tax total. The residual paisa lands on SGST so the two
 * halves always re-add to the total — mirrors ``split_gst``.
 */
export const splitGst = (taxTotal, mode, cgstRate, sgstRate) => {
    const total = money(taxTotal);
    if (total <= 0) return { cgst: 0, sgst: 0, igst: 0 };
    if (mode === 'inter_state') return { cgst: 0, sgst: 0, igst: total };
    // 'auto' — the head split is unknown client-side; only the total is shown.
    if (mode === 'auto') return { cgst: 0, sgst: 0, igst: 0 };
    if (mode === 'intra_state') {
        const c = Number(cgstRate) || 0;
        const s = Number(sgstRate) || 0;
        if (c + s <= 0) return { cgst: 0, sgst: 0, igst: 0 };
        const cgst = money((total * c) / (c + s));
        return { cgst, sgst: money(total - cgst), igst: 0 };
    }
    return { cgst: 0, sgst: 0, igst: 0 };
};

/**
 * ``auto`` needs the doctor's state to resolve to intra vs. inter, which only
 * the server knows — so it is reported as ``'auto'`` rather than guessed. The
 * *total* GST is identical either way (IGST == CGST + SGST), only the split
 * differs, so the preview stays correct on every rupee figure and simply
 * declines to name the heads. Anything else passes through verbatim.
 */
const concreteMode = (mode) => (
    ['none', 'intra_state', 'inter_state'].includes(mode) ? mode : 'auto'
);

const rateOf = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

/**
 * Client mirror of ``compute_tax_breakdown`` for live preview.
 *
 * @param {object}  args
 * @param {number}  args.doctorFee          the doctor's quoted, tax-INCLUSIVE fee
 * @param {number}  args.displayPrice       what the patient pays
 * @param {object}  args.config             a ``getTaxConfig`` payload
 * @param {string} [args.consultationType]  selects the per-type GST override
 * @param {number} [args.tdsRate]            this doctor's own TDS rate. The
 *   config carries only the tenant flat rate, so a caller that knows the
 *   doctor (the pricing table does — ``/rows`` returns it) must pass it, or
 *   a doctor on a per-doctor override would be quoted the tenant default.
 * @returns an object with the same field names as the server breakdown.
 */
export function computeTaxBreakdown({
    doctorFee, displayPrice, config, consultationType, tdsRate: tdsRateOverride,
}) {
    const fee = money(doctorFee);
    const display = displayPrice == null ? fee : money(displayPrice);

    const doc = config?.doctor_supply || {};
    const plat = config?.platform_supply || {};
    const tdsCfg = config?.tds || {};

    // Per-consultation-type override wins over the flat pair, exactly as
    // ``resolve_doctor_rates`` does.
    const override = (doc.by_consultation_type || {})[consultationType];
    const hasOverride = override
        && override.cgst != null && override.sgst != null;
    const dCgst = hasOverride ? rateOf(override.cgst) : rateOf(doc.cgst_rate);
    const dSgst = hasOverride ? rateOf(override.sgst) : rateOf(doc.sgst_rate);
    const dIgst = hasOverride
        ? (rateOf(override.igst) || dCgst + dSgst)
        : (rateOf(doc.igst_rate) || rateOf(doc.effective_igst_rate) || dCgst + dSgst);
    const dMode = concreteMode(
        (hasOverride && override.mode) || doc.tax_mode || 'auto',
    );
    // IGST == CGST + SGST, so the total is the same under intra, inter and
    // auto — only 'none' (exempt) zeroes it.
    const dTotalRate = dMode === 'none' ? 0
        : (dMode === 'inter_state' ? dIgst : dCgst + dSgst);

    const pCgst = rateOf(plat.cgst_rate);
    const pSgst = rateOf(plat.sgst_rate);
    const pIgst = rateOf(plat.igst_rate) || rateOf(plat.effective_igst_rate)
        || pCgst + pSgst;
    const pMode = concreteMode(plat.tax_mode || 'auto');
    const pTotalRate = pMode === 'none' ? 0
        : (pMode === 'inter_state' ? pIgst : pCgst + pSgst);
    const pInclusive = plat.tax_inclusive !== false;

    // Supply 1 — GST carved OUT of the doctor's fee.
    const d = carveOut(fee, dTotalRate);
    const dSplit = splitGst(d.tax, dMode, dCgst, dSgst);

    // Supply 2 — the platform's margin.
    const margin = money(Math.max(display - fee, 0));
    const subsidy = money(Math.max(fee - display, 0));
    const p = pInclusive ? carveOut(margin, pTotalRate) : addOn(margin, pTotalRate);
    const pSplit = splitGst(p.tax, pMode, pCgst, pSgst);

    // TDS (s.194J) — on the doctor's professional fee, ex-GST by default.
    // An explicit per-doctor rate wins over the tenant flat rate, mirroring
    // ``billing_service.resolve_tds_rate`` on the server.
    const tdsRate = tdsRateOverride != null && tdsRateOverride !== ''
        ? rateOf(tdsRateOverride)
        : rateOf(tdsCfg.rate);
    const tdsBase = tdsCfg.exclude_gst === false ? fee : d.taxable;
    const tdsAmount = money((tdsBase * tdsRate) / 100);

    return {
        doctor_fee: fee,
        display_price: display,
        doctor_tax_mode: dMode,
        doctor_taxable_value: d.taxable,
        doctor_cgst_rate: dCgst,
        doctor_sgst_rate: dSgst,
        doctor_igst_rate: dIgst,
        doctor_cgst: dSplit.cgst,
        doctor_sgst: dSplit.sgst,
        doctor_igst: dSplit.igst,
        doctor_gst_total: d.tax,
        platform_fee: margin,
        platform_subsidy: subsidy,
        platform_tax_mode: pMode,
        platform_tax_inclusive: pInclusive,
        platform_taxable_value: p.taxable,
        platform_cgst_rate: pCgst,
        platform_sgst_rate: pSgst,
        platform_igst_rate: pIgst,
        platform_cgst: pSplit.cgst,
        platform_sgst: pSplit.sgst,
        platform_igst: pSplit.igst,
        platform_gst_total: p.tax,
        gst_total: money(d.tax + p.tax),
        tds_rate: tdsRate,
        tds_base: tdsBase,
        tds_amount: tdsAmount,
        total_to_patient: money(display + (pInclusive ? 0 : p.tax)),
        net_to_doctor: money(fee - tdsAmount),
        platform_net_revenue: p.taxable,
    };
}

export const {
    useGetTaxConfigQuery,
    useUpdateTaxConfigMutation,
    useGetTaxBreakdownQuery,
} = taxEndpoints;

export default taxEndpoints;
