/**
 * PricingConfig — SUPER_ADMIN "Display Pricing Configuration" surface.
 *
 * Three-level drill-down, all of it live against
 * ``/api/admin/display-pricing``:
 *   1. Offerings   — the consultation types that exist in the DB, plus the
 *                    Service / Product Catalog, annotated with how many
 *                    doctors price each one.
 *   2. Scopes      — the second axis for the chosen offering: duration slots
 *                    for a consultation type, catalog items for services.
 *                    Only entries a provider has actually priced appear.
 *   3. Pricing table — one row per doctor: their quoted fee, the
 *                    admin-entered increment + overall discount, the
 *                    Pre-discount Price the discounts come off, and the
 *                    resulting Final Price.
 *
 * The Final Price is not a preview — saving writes a DisplayPricingRule for
 * (doctor × offering), and every patient-facing surface (doctor cards, the
 * booking dialog, the marketplace listing, the payment amount) prices from
 * that same rule. Change a number here and that offering costs the patient a
 * different amount.
 *
 * Admin-editable per row: Increment (Fixed ₹ + %), the Overall discount (%),
 * which vouchers / coupons apply, and one Plan Discount column per membership
 * tier. Vouchers and coupons are flat ₹ rows managed in the two books below
 * the table; each one picked subtracts directly.
 *
 * ── Plan Discount ──
 * A membership tier's headline ``member_discount_pct`` is a CEILING, not a
 * rate: it is the most any single offering may take off for a holder of that
 * tier, and the ``plan_discounts`` map on this row is where an individual
 * doctor × offering is dialled below it. Each column shows what a patient on
 * that tier would actually pay for THIS row — Final Price less that tier's
 * rate — with the rate itself editable beneath it.
 *
 * The plan reduction is deliberately NOT folded into Final Price. Final Price
 * is quoted before we know who is looking, and two patients on different tiers
 * see different totals for the same slot; folding one of them in would make
 * the quoted number wrong for everyone else. The tier comes off at purchase,
 * server-side, from this same rate — see ``app.common.member_discount``.
 *
 * Keeping the table narrow: the two discount pickers are single cells that
 * show only their resulting deduction and open a popover for the full list.
 * A checkbox column per voucher would grow the table every time an admin adds
 * one. The tax split is likewise one icon, not a set of columns.
 *
 * The voucher and coupon books render with the pricing table and only there —
 * they feed its two discount columns, so they belong beside the rows that
 * consume them rather than on the offering / slot pickers. Every discount
 * picker can also WRITE to those books: "＋ New voucher" inside the popover
 * creates one and applies it to the row it was opened from, so a discount
 * meant for a single doctor × offering doesn't need a round trip past the
 * table. It lands in the same book either way and stays pickable everywhere.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import {
    Box, Typography, Paper, Grid, Stack, Breadcrumbs, Link, Button, Chip,
    Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
    Divider, TextField, InputAdornment, CircularProgress, Alert, Snackbar,
    Tooltip,
} from '@mui/material';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import VideocamIcon from '@mui/icons-material/Videocam';
import ChatIcon from '@mui/icons-material/Chat';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import HomeIcon from '@mui/icons-material/Home';
import FestivalIcon from '@mui/icons-material/Festival';
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ScheduleIcon from '@mui/icons-material/Schedule';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import Diversity3Icon from '@mui/icons-material/Diversity3';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { CONSULTATION_TYPE_MAP } from '../../../../service-provider/ProfileSetting/constants/consultationTypes';
import DiscountBook from '../../components/DiscountBook';
import DiscountPicker from '../../components/DiscountPicker';
import TaxBreakdown from '../../components/TaxBreakdown';
import {
    GROUP_SCOPE,
    SERVICE_SCOPE,
    useListDiscountsQuery,
    useListDisplayPricingOfferingsQuery,
    useListDisplayPricingScopesQuery,
    useListDisplayPricingRowsQuery,
    useListPricingMembershipPlansQuery,
    useSaveDisplayPricingRulesMutation,
    useCreateDiscountMutation,
} from '../../../api/displayPricingEndpoints';

// Icon per offering. Colour + description for consultation types come from the
// shared CONSULTATION_TYPES constants so this page can't drift from the
// doctor's own Pricing tab; only the MUI icon is chosen here.
const OFFERING_ICONS = {
    audio: HeadphonesIcon,
    video: VideocamIcon,
    chat: ChatIcon,
    complete: LocalHospitalIcon,
    home_visit: HomeIcon,
    camp: FestivalIcon,
    [SERVICE_SCOPE]: StorefrontIcon,
    [GROUP_SCOPE]: Diversity3Icon,
};
const SERVICE_COLOR = '#059669';
const GROUP_COLOR = '#d97706';
const FALLBACK_COLOR = '#546e7a';
const SERVICE_DESCRIPTION =
    'Standalone services doctors sell from the admin product catalog — '
    + 'certificates, reports and the like.';
const GROUP_DESCRIPTION =
    'Admin-authored healthcare plans delivered by a team. Priced once per '
    + 'plan, on its Price to Patient.';

/** Shared empty default — a fresh `[]` literal would be a new reference on
 *  every render, re-firing the effect that seeds the editable rows. */
const EMPTY = [];

const inr = (n) => (n == null
    ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);

/** Summed ₹ of the ids a row selects, counting only live rows — the backend
 *  ignores inactive vouchers/coupons, so including them would over-report. */
function selectedTotal(ids = [], book = []) {
    const picked = new Set((ids || []).map(String));
    return book
        .filter((d) => d.is_active && picked.has(String(d.id)))
        .reduce((sum, d) => sum + Number(d.amount || 0), 0);
}

/**
 * Itemised price for a row. Mirrors ``price_breakdown`` in
 * ``app/common/display_pricing.py`` — the two must agree or the number the
 * admin sees while typing won't be the number the patient is charged.
 */
function priceParts(r, vouchers, coupons) {
    const fee = num(r.doctor_fee);
    const incrementPctAmount = (fee * num(r.increment_pct)) / 100;
    const gross = fee + num(r.increment_fixed) + incrementPctAmount;
    const overall = (gross * num(r.overall_discount_pct)) / 100;
    const voucher = selectedTotal(r.voucher_ids, vouchers);
    const coupon = selectedTotal(r.coupon_ids, coupons);
    const round = (n) => Math.round(n * 100) / 100;
    return {
        fee,
        incrementFixed: num(r.increment_fixed),
        incrementPctAmount: round(incrementPctAmount),
        gross: round(gross),
        overall: round(overall),
        voucher: round(voucher),
        coupon: round(coupon),
        // Final Price stops at the Overall discount. Picking a voucher used to
        // drop this number, which reads as the voucher being part of the
        // price rather than something applied on top of it — and left no
        // figure saying what the offering costs without one.
        display: Math.max(0, round(gross - overall)),
        // The same price with every picked voucher and coupon spent. Shown as
        // its own figure beside Final Price, never in place of it.
        withVouchers: Math.max(0, round(gross - overall - voucher - coupon)),
    };
}

/**
 * The tier's ceiling, as a number. ``member_discount_pct`` on a plan is the
 * most any one offering may grant its holders, and every rate below is clamped
 * to it — server-side on save, and here so the input can't offer a number the
 * save would silently reject.
 */
const planCap = (plan) => Math.min(Math.max(num(plan?.member_discount_pct), 0), 100);

/**
 * What one membership tier takes off this row, as an editable value.
 *
 * ``plan_discounts`` arrives EFFECTIVE from the server — every tier present,
 * carrying the row's own override or the tier's ceiling — so a populated cell
 * is the normal state and a blank one only happens when an admin clears the
 * field. Blank reads as "no override", i.e. the full ceiling, which is both
 * what the backend stores for a missing entry and the least surprising reading
 * of an empty cell. An explicit ``0`` is a real answer meaning this offering
 * grants that tier nothing, and is kept.
 */
const planPct = (row, plan) => {
    const raw = row?.plan_discounts?.[plan.id];
    const cap = planCap(plan);
    if (raw === '' || raw == null) return cap;
    return Math.min(Math.max(num(raw), 0), cap);
};

/**
 * The voucher + coupon ids picked for one tier on this row, as one list.
 *
 * Stored as two maps because they are two books server-side, read as one list
 * because a single picker covers both — which book an id came from is the
 * page's bookkeeping, not a distinction the admin has to make twice.
 *
 * Sparse the opposite way to ``plan_discounts``: absence means "nothing
 * picked", not "the default". A percentage ceiling is a promise the tier has
 * already made; a voucher is something an admin chooses.
 */
const planPickedIds = (row, planId) => [
    ...((row?.plan_voucher_ids || {})[planId] || []),
    ...((row?.plan_coupon_ids || {})[planId] || []),
].map(String);

/** Editable fields, in the order they appear in the table. */
const EDITABLE = ['increment_fixed', 'increment_pct', 'overall_discount_pct'];

/**
 * Identity of a row's editable state — numbers, the two id selections, and the
 * per-tier rates.
 *
 * ``plan_discounts`` has to be in here or the Save button never lights up for
 * a change that only dials a tier down. Keys are sorted so an object that came
 * back in a different order doesn't read as an edit.
 */
const planSignature = (r) => Object.entries(r?.plan_discounts || {})
    .map(([id, pct]) => `${id}:${num(pct)}`)
    .sort()
    .join(',');

/** Same, for the per-tier voucher / coupon picks. */
const planPickSignature = (r) => ['plan_voucher_ids', 'plan_coupon_ids']
    .map((field) => Object.entries(r?.[field] || {})
        .map(([id, ids]) => `${id}:${(ids || []).map(String).sort().join('+')}`)
        .sort()
        .join(','))
    .join(';');

const rowSignature = (r) => [
    ...EDITABLE.map((f) => num(r[f])),
    (r.voucher_ids || []).map(String).sort().join(','),
    (r.coupon_ids || []).map(String).sort().join(','),
    planSignature(r),
    planPickSignature(r),
].join('|');

const PCT_ADORN = { endAdornment: <InputAdornment position="end">%</InputAdornment> };
const RUPEE_ADORN = { startAdornment: <InputAdornment position="start">₹</InputAdornment> };

/** Which book(s) a picker's "＋ New" writes into. Module scope so the arrays
 *  keep their identity across renders. */
const CREATE_VOUCHERS = ['vouchers'];
const CREATE_COUPONS = ['coupons'];
const CREATE_BOTH = ['vouchers', 'coupons'];

/**
 * One book, plus any row created from a picker that the server list hasn't
 * caught up with yet. Returns ``book`` itself when there is nothing to add, so
 * a merged list never gets a new identity for an empty merge.
 */
const mergeFresh = (book, fresh, kind) => {
    const known = new Set(book.map((d) => String(d.id)));
    const extra = fresh.filter((d) => d.kind === kind && !known.has(String(d.id)));
    return extra.length ? [...book, ...extra] : book;
};

/**
 * Compact numeric editor cell.
 *
 * Declared at module scope on purpose: a component defined inside the page
 * body gets a fresh identity on every render, so React would remount the input
 * and the field would lose focus after each keystroke.
 */
const NumCell = ({ row, field, adornment, onEdit }) => (
    <TextField
        value={row[field] ?? 0}
        onChange={(e) => onEdit(row.row_id, field, e.target.value)}
        type="number"
        size="small"
        variant="outlined"
        sx={{ width: 104 }}
        inputProps={{ min: 0, style: { textAlign: 'right', padding: '6px 8px' } }}
        InputProps={adornment}
    />
);

/**
 * One membership tier's cell: what a patient on that tier pays for this row,
 * and the rate that produced it.
 *
 * The price leads and the rate sits under it because the price is the question
 * an admin is actually asking of this column ("what does a Gold member pay for
 * Dr X's 20-minute video?"), and the rate is the knob that answers it.
 *
 * Module scope for the same reason as ``NumCell`` — a component redefined per
 * render remounts its input and drops focus on every keystroke.
 */
const PlanDiscountCell = ({
    row, plan, displayPrice, book, onEdit, onPickDiscounts, onCreateDiscount,
}) => {
    const cap = planCap(plan);
    const pct = planPct(row, plan);
    const raw = row?.plan_discounts?.[plan.id];
    const picked = planPickedIds(row, plan.id);
    // Live rows only, matching the backend: a deactivated voucher stops
    // applying immediately without an admin unpicking it from every rule.
    const flat = selectedTotal(picked, book);
    // Two prices, not one. Both come off at purchase, but they answer
    // different questions: the percentage is what the TIER grants on this
    // offering, the voucher is an extra an admin attached to this one row.
    // Collapsing them into a single figure would leave no way to see what
    // either is worth, or to notice that a voucher is doing all the work.
    const planPrice = Math.max(0, Math.round(displayPrice * (1 - pct / 100) * 100) / 100);
    const withVoucher = Math.max(0, Math.round((planPrice - flat) * 100) / 100);

    return (
        <Stack spacing={0.5} alignItems="center">
            <Tooltip
                title={cap > 0 || flat > 0
                    ? [
                        `${inr(displayPrice)}`,
                        pct > 0 ? `less ${pct}%` : null,
                        `— what a ${plan.name} member pays.`,
                        flat > 0
                            ? `Less ${inr(flat)} again for the vouchers/coupons picked `
                              + `below, so they actually pay ${inr(withVoucher)}.`
                            : null,
                        'Applied at purchase, on top of the Final Price.',
                    ].filter(Boolean).join(' ')
                    : `${plan.name} grants no member discount. Raise it on the plan `
                      + 'itself, or pick a voucher below.'}
            >
                <Stack spacing={0} alignItems="center">
                    <Typography
                        variant="body2"
                        fontWeight={700}
                        color={pct > 0 ? 'success.main' : 'text.disabled'}
                    >
                        {inr(planPrice)}
                    </Typography>
                    {/* The conditional price, phrased as the condition it is.
                        Under the plan price rather than beside it: this column
                        is already the narrowest thing carrying two figures. */}
                    {flat > 0 && (
                        <Typography
                            variant="caption"
                            sx={{ color: 'primary.main', fontWeight: 700, lineHeight: 1.3 }}
                        >
                            {inr(withVoucher)} w/ voucher
                        </Typography>
                    )}
                </Stack>
            </Tooltip>
            <TextField
                value={raw ?? ''}
                onChange={(e) => onEdit(row.row_id, plan.id, e.target.value)}
                type="number"
                size="small"
                variant="outlined"
                disabled={cap <= 0}
                placeholder={String(cap)}
                sx={{ width: 88 }}
                inputProps={{
                    min: 0,
                    max: cap,
                    style: { textAlign: 'right', padding: '4px 6px', fontSize: '0.8rem' },
                }}
                InputProps={PCT_ADORN}
            />
            {/* One picker over both books rather than a column each: the flat ₹
                rows behave identically here, and per-plan columns are already
                the widest thing on this table. Which book an id came from is
                still tracked — the two are stored and validated separately —
                it just isn't a distinction the admin has to make twice. */}
            <DiscountPicker
                options={book}
                selectedIds={picked}
                onChange={(ids) => onPickDiscounts(row.row_id, plan.id, ids)}
                emptyHint="No vouchers or coupons yet — add one below, or in the books under the table."
                createKinds={CREATE_BOTH}
                onCreate={onCreateDiscount}
            />
        </Stack>
    );
};

const PricingConfig = () => {
    const [offering, setOffering] = useState(null); // offering entry
    const [scope, setScope] = useState(null);       // slot or catalog item
    const [rows, setRows] = useState([]);           // locally-edited copy of serverRows
    const [toast, setToast] = useState(null);
    // Discounts created from a row's picker, held until the book re-fetch
    // brings them back. The create resolves before the refreshed list lands,
    // so without this the row would show an id neither book knows yet and the
    // cell would blank out for a beat right after the click that filled it.
    // Each carries the ``kind`` it was written to, which is also how a
    // brand-new id gets routed to the right per-plan map below.
    const [freshDiscounts, setFreshDiscounts] = useState([]);
    // The same kinds, in a ref. A create resolves and the picker immediately
    // selects the new id in the SAME async continuation, so ``editPlanPicks``
    // runs against the render that existed before ``setFreshDiscounts`` — the
    // books it consults there still don't know the id, and it would classify
    // as neither and be dropped. A ref is written synchronously, so the very
    // next call already sees it.
    const freshKindById = useRef({});

    const isService = offering?.value === SERVICE_SCOPE;
    const isGroup = offering?.value === GROUP_SCOPE;
    // What the second drill-down level is called, for all the copy below.
    const scopeNoun = (isGroup && 'plan') || (isService && 'service') || 'duration slot';
    // Group offerings have no doctor, so the identity columns describe the plan.
    const cols = isGroup
        ? { ref: 'Duration', name: 'Plan', fee: 'Price to Patient' }
        : { ref: 'Doctor ID', name: 'Doctor Name', fee: 'Doctor Fee' };

    const {
        data: offerings = EMPTY, isLoading: offeringsLoading, error: offeringsError,
    } = useListDisplayPricingOfferingsQuery();

    const {
        data: scopes = EMPTY, isFetching: scopesLoading,
    } = useListDisplayPricingScopesQuery(offering?.value, { skip: !offering });

    const {
        data: serverRows = EMPTY, isFetching: rowsLoading,
    } = useListDisplayPricingRowsQuery(
        { scopeType: offering?.value, scopeKey: scope?.key },
        { skip: !offering || !scope },
    );

    // Both books load with the page: the pickers need them to render a
    // deduction, and the books render below the table regardless of drill-down
    // level so an admin can set one up before pricing anything.
    const { data: serverVouchers = EMPTY } = useListDiscountsQuery('vouchers');
    const { data: serverCoupons = EMPTY } = useListDiscountsQuery('coupons');

    // A just-created row shows immediately and drops out of ``freshDiscounts``
    // the moment the server list carries it — the merge returns the server
    // array unchanged once that happens, so nothing downstream re-renders on
    // a new identity for no reason.
    const vouchers = useMemo(
        () => mergeFresh(serverVouchers, freshDiscounts, 'vouchers'),
        [serverVouchers, freshDiscounts],
    );
    const coupons = useMemo(
        () => mergeFresh(serverCoupons, freshDiscounts, 'coupons'),
        [serverCoupons, freshDiscounts],
    );

    // The receiver membership tiers — one Plan Discount column each. Loaded
    // with the page rather than with the table: the column set is a property
    // of the tenant, not of whichever slot happens to be open.
    const { data: plans = EMPTY } = useListPricingMembershipPlansQuery();
    const plansById = useMemo(
        () => Object.fromEntries(plans.map((p) => [p.id, p])), [plans],
    );

    // The two books as one list, for the per-plan picker. Membership in each
    // is kept as a Set so a picked id can be routed back to the column it
    // belongs to on save.
    const planBook = useMemo(() => [...vouchers, ...coupons], [vouchers, coupons]);
    const voucherIds = useMemo(
        () => new Set(vouchers.map((v) => String(v.id))), [vouchers],
    );
    const couponIds = useMemo(
        () => new Set(coupons.map((c) => String(c.id))), [coupons],
    );

    const [saveRules, { isLoading: saving }] = useSaveDisplayPricingRulesMutation();
    const [createDiscount] = useCreateDiscountMutation();

    /**
     * Write a discount to one of the books on behalf of a picker, and hand the
     * created row back so the picker can tick it on its own row.
     *
     * Errors are re-thrown rather than toasted: the picker shows them inline,
     * against the field that caused them, with the half-typed form still open.
     * A duplicate code is the common one and a toast would lose the draft.
     */
    const handleCreateDiscount = async ({ kind, code, label, amount }) => {
        const res = await createDiscount({
            kind,
            body: { code, label, amount, is_active: true },
        }).unwrap();
        const row = res?.data;
        if (row?.id) {
            // Ref first, state second — the caller selects the id straight
            // after this returns, and only the ref is readable by then.
            freshKindById.current[String(row.id)] = kind;
            setFreshDiscounts((prev) => [...prev, { ...row, kind }]);
        }
        setToast({
            severity: 'success',
            message: `${code} added to the ${kind === 'coupons' ? 'Coupons' : 'Vouchers'} book.`,
        });
        return row;
    };

    // Reset the editable copy whenever a fresh row set arrives (selection
    // change, or a re-fetch after save).
    useEffect(() => { setRows(serverRows.map((r) => ({ ...r }))); }, [serverRows]);

    const dirty = useMemo(() => {
        if (rows.length !== serverRows.length) return false;
        return rows.some((r, i) => rowSignature(r) !== rowSignature(serverRows[i]));
    }, [rows, serverRows]);

    // Keyed on ``row_id``, not ``doctor_id``: a group offering is priced once
    // per plan, so its single row has no doctor to identify it by.
    const editRow = (rowId, field, value) => {
        setRows((prev) => prev.map(
            (r) => (r.row_id === rowId ? { ...r, [field]: value } : r),
        ));
    };

    // A new map rather than a mutation: ``rows`` starts as a shallow copy of
    // ``serverRows``, so writing into the existing object would edit the
    // server copy too and ``dirty`` would compare a row against itself.
    const editPlanDiscount = (rowId, planId, value) => {
        setRows((prev) => prev.map((r) => (
            r.row_id === rowId
                ? { ...r, plan_discounts: { ...(r.plan_discounts || {}), [planId]: value } }
                : r
        )));
    };

    // Which book an id belongs to. The two loaded books answer for everything
    // that existed when this render started; ``freshKindById`` answers for a
    // discount created moments ago from a picker, which the books won't carry
    // until their re-fetch lands.
    //
    // ``null`` for anything else, and such an id is dropped rather than
    // guessed at — it can only be a stale selection for a discount that has
    // since been deleted, and the backend would reject it as unknown anyway.
    const discountKind = (id) => {
        const key = String(id);
        if (voucherIds.has(key)) return 'vouchers';
        if (couponIds.has(key)) return 'coupons';
        return freshKindById.current[key] || null;
    };

    // The picker hands back one list; it's split back into the two books here
    // because that's how they're stored, validated and applied server-side.
    const editPlanPicks = (rowId, planId, ids) => {
        const pickedVouchers = ids.filter((id) => discountKind(id) === 'vouchers');
        const pickedCoupons = ids.filter((id) => discountKind(id) === 'coupons');
        setRows((prev) => prev.map((r) => (
            r.row_id === rowId
                ? {
                    ...r,
                    plan_voucher_ids: { ...(r.plan_voucher_ids || {}), [planId]: pickedVouchers },
                    plan_coupon_ids: { ...(r.plan_coupon_ids || {}), [planId]: pickedCoupons },
                }
                : r
        )));
    };

    const handleSave = async () => {
        try {
            const res = await saveRules({
                scopeType: offering.value,
                scopeKey: scope.key,
                // Every row is sent, not just the dirty ones — an all-zero row
                // is how the backend is told to drop a rule it already has.
                rules: rows.map((r) => ({
                    doctor_id: r.doctor_id,
                    increment_fixed: num(r.increment_fixed),
                    increment_pct: num(r.increment_pct),
                    overall_discount_pct: num(r.overall_discount_pct),
                    voucher_ids: r.voucher_ids || [],
                    coupon_ids: r.coupon_ids || [],
                    // Sent on every save, including saves that changed nothing
                    // here. The backend replaces the whole map, so omitting it
                    // — as this page did until the columns existed — wiped
                    // every per-tier rate the moment anyone touched an
                    // increment.
                    //
                    // Keyed off the ROW's own map rather than the loaded
                    // plans: the row arrives with an entry per tier already,
                    // so a save that lands before /membership-plans resolves
                    // still round-trips every rate instead of clearing them
                    // all over again. A tier that IS loaded goes through
                    // ``planPct``, so a cleared cell rides up as the ceiling
                    // and the backend drops it back to "no override".
                    plan_discounts: Object.fromEntries(
                        Object.keys(r.plan_discounts || {}).map((id) => [
                            id,
                            plansById[id]
                                ? planPct(r, plansById[id])
                                : num(r.plan_discounts[id]),
                        ]),
                    ),
                    // Sent verbatim, and for the same reason: the backend
                    // replaces the whole map, so a save that omitted these
                    // would clear every per-tier voucher on the scope.
                    plan_voucher_ids: r.plan_voucher_ids || {},
                    plan_coupon_ids: r.plan_coupon_ids || {},
                })),
            }).unwrap();
            setToast({
                severity: 'success',
                message: res?.message || 'Display pricing saved.',
            });
        } catch (err) {
            setToast({
                severity: 'error',
                message: err?.data?.message || err?.message || 'Failed to save display pricing.',
            });
        }
    };

    const handleReset = () => setRows(serverRows.map((r) => ({ ...r })));

    const offeringColor = (o) => {
        if (o?.value === SERVICE_SCOPE) return SERVICE_COLOR;
        if (o?.value === GROUP_SCOPE) return GROUP_COLOR;
        return CONSULTATION_TYPE_MAP[o?.value]?.color || FALLBACK_COLOR;
    };

    // ── Breadcrumb ─────────────────────────────────────────────────────────
    const crumbs = (
        <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} sx={{ mb: 2 }}>
            <Link
                component="button"
                underline="hover"
                color={offering ? 'inherit' : 'text.primary'}
                onClick={() => { setOffering(null); setScope(null); }}
            >
                Pricing Configuration
            </Link>
            {offering && (
                <Link
                    component="button"
                    underline="hover"
                    color={scope ? 'inherit' : 'text.primary'}
                    onClick={() => setScope(null)}
                >
                    {offering.label}
                </Link>
            )}
            {scope && <Typography color="text.primary">{scope.label}</Typography>}
        </Breadcrumbs>
    );

    return (
        <Box sx={{ p: 3 }}>
            <Typography variant="h5" fontWeight="bold" gutterBottom>
                Display Pricing Configuration
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 820 }}>
                Set what patients are quoted and charged for each consultation type, duration slot,
                catalog service and doctor. A doctor's own price is their payout; the increment and
                discount you enter here sit on top of it. Saving updates the price patients see and
                pay, immediately.
            </Typography>

            {crumbs}

            {/* ── Level 1: offerings (from the DB) ── */}
            {!offering && (
                <>
                    {offeringsLoading && <CircularProgress size={28} />}
                    {offeringsError && (
                        <Alert severity="error">
                            Could not load offerings. Please retry.
                        </Alert>
                    )}
                    <Grid container spacing={2}>
                        {offerings.map((o) => {
                            const Icon = OFFERING_ICONS[o.value] || MedicalServicesIcon;
                            const color = offeringColor(o);
                            const meta = CONSULTATION_TYPE_MAP[o.value];
                            const priced = o.doctor_count > 0;
                            const service = o.value === SERVICE_SCOPE;
                            const group = o.value === GROUP_SCOPE;
                            return (
                                <Grid item xs={12} sm={6} md={4} key={o.value}>
                                    <Paper
                                        onClick={() => priced && setOffering(o)}
                                        sx={{
                                            p: 3, height: '100%',
                                            borderTop: `4px solid ${color}`,
                                            cursor: priced ? 'pointer' : 'default',
                                            opacity: priced ? 1 : 0.6,
                                            transition: 'box-shadow .2s, transform .2s',
                                            ...(priced && {
                                                '&:hover': { boxShadow: 6, transform: 'translateY(-2px)' },
                                            }),
                                        }}
                                    >
                                        <Stack direction="row" spacing={2} alignItems="center" mb={1}>
                                            <Box sx={{
                                                width: 48, height: 48, borderRadius: 2,
                                                bgcolor: `${color}18`, color,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            }}>
                                                <Icon />
                                            </Box>
                                            <Typography variant="h6" fontWeight={700}>
                                                {meta?.label || o.label}
                                            </Typography>
                                        </Stack>
                                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                                            {group && GROUP_DESCRIPTION}
                                            {service && SERVICE_DESCRIPTION}
                                            {!group && !service
                                                && (meta?.description || 'Consultation type.')}
                                        </Typography>
                                        <Stack direction="row" spacing={1}>
                                            {/* A group offering is priced per plan, so counting
                                                doctors there would always read zero. */}
                                            {!group && (
                                                <Chip
                                                    size="small"
                                                    variant="outlined"
                                                    label={`${o.doctor_count} doctor${o.doctor_count === 1 ? '' : 's'}`}
                                                />
                                            )}
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                label={(() => {
                                                    if (group) return `${o.scope_count} plan${o.scope_count === 1 ? '' : 's'}`;
                                                    if (service) return `${o.scope_count} service${o.scope_count === 1 ? '' : 's'}`;
                                                    return `${o.scope_count} slot${o.scope_count === 1 ? '' : 's'}`;
                                                })()}
                                            />
                                        </Stack>
                                        {!priced && (
                                            <Typography variant="caption" color="text.disabled"
                                                sx={{ display: 'block', mt: 1.5 }}>
                                                {group && 'No group offering has been created yet.'}
                                                {service && 'No doctor has listed a catalog service yet.'}
                                                {!group && !service && 'No doctor has priced this type yet.'}
                                            </Typography>
                                        )}
                                    </Paper>
                                </Grid>
                            );
                        })}
                    </Grid>
                </>
            )}

            {/* ── Level 2: duration slots, or catalog services ── */}
            {offering && !scope && (
                <>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => setOffering(null)}>
                            Back
                        </Button>
                        <Typography variant="subtitle1" fontWeight={600}>
                            {offering.label} — select a {scopeNoun}
                        </Typography>
                    </Stack>
                    {scopesLoading && <CircularProgress size={28} />}
                    {!scopesLoading && scopes.length === 0 && (
                        <Alert severity="info">
                            {(isGroup
                                && 'No group offering exists yet. Plans appear here once one is '
                                   + 'created under Group Offerings.')
                              || (isService
                                && 'No doctor has listed a service from the product catalog yet. '
                                   + 'Services appear here once a doctor selects one on their Services tab.')
                              || `No doctor has priced a duration slot for ${offering.label} yet. `
                                 + 'Slots appear here once a doctor saves pricing on their '
                                 + 'Availability & Pricing tab.'}
                        </Alert>
                    )}
                    <Grid container spacing={2}>
                        {scopes.map((s) => (
                            <Grid
                                item
                                xs={12} sm={6}
                                md={isService || isGroup ? 4 : 3}
                                lg={isService || isGroup ? 3 : 2}
                                key={s.key}
                            >
                                <Paper
                                    onClick={() => setScope(s)}
                                    sx={{
                                        p: 2.5, cursor: 'pointer', height: '100%',
                                        textAlign: isService || isGroup ? 'left' : 'center',
                                        transition: 'box-shadow .2s, transform .2s',
                                        '&:hover': { boxShadow: 6, transform: 'translateY(-2px)' },
                                    }}
                                >
                                    {(() => {
                                        const Icon = (isGroup && Diversity3Icon)
                                            || (isService && Inventory2Icon)
                                            || ScheduleIcon;
                                        return <Icon sx={{ color: offeringColor(offering), mb: 1 }} />;
                                    })()}
                                    <Typography variant="subtitle1" fontWeight={700}>{s.label}</Typography>
                                    {s.sublabel && (
                                        <Typography
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{
                                                display: '-webkit-box', WebkitLineClamp: 2,
                                                WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            }}
                                        >
                                            {s.sublabel}
                                        </Typography>
                                    )}
                                    {/* A plan has one price and a team, so its chip
                                        reports publish state rather than a count. */}
                                    <Chip
                                        size="small"
                                        label={isGroup
                                            ? (s.status || 'draft')
                                            : `${s.doctor_count} doctor${s.doctor_count === 1 ? '' : 's'}`}
                                        color={isGroup && s.status !== 'published' ? 'warning' : 'default'}
                                        variant="outlined"
                                        sx={{ mt: 1 }}
                                    />
                                </Paper>
                            </Grid>
                        ))}
                    </Grid>
                </>
            )}

            {/* ── Level 3: pricing table ── */}
            {offering && scope && (
                <>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }} flexWrap="wrap">
                        <Button size="small" startIcon={<ArrowBackIcon />} onClick={() => setScope(null)}>
                            Back
                        </Button>
                        <Typography variant="subtitle1" fontWeight={600}>
                            {offering.label} · {scope.label}
                        </Typography>
                        <Chip
                            size="small"
                            label={isGroup
                                ? `${rows.length} plan${rows.length === 1 ? '' : 's'}`
                                : `${rows.length} doctors`}
                            color="primary"
                            variant="outlined"
                        />
                        <Box sx={{ flexGrow: 1 }} />
                        <Button
                            size="small"
                            startIcon={<RestartAltIcon />}
                            onClick={handleReset}
                            disabled={!dirty || saving}
                        >
                            Reset
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                            onClick={handleSave}
                            disabled={!dirty || saving}
                        >
                            Save
                        </Button>
                    </Stack>

                    {dirty && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            Unsaved changes — patients are still being charged the saved prices.
                        </Alert>
                    )}

                    {rowsLoading && <CircularProgress size={28} sx={{ mb: 2 }} />}
                    {!rowsLoading && rows.length === 0 && (
                        <Alert severity="info">
                            Nothing to price for this {scopeNoun} under {offering.label}.
                        </Alert>
                    )}

                    {rows.length > 0 && (
                        <TableContainer component={Paper}>
                            <Table size="small" sx={{ '& th, & td': { whiteSpace: 'nowrap' } }}>
                                <TableHead>
                                    {/* Grouped header row */}
                                    <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'action.hover' } }}>
                                        <TableCell rowSpan={2}>S.No</TableCell>
                                        <TableCell rowSpan={2}>{cols.ref}</TableCell>
                                        <TableCell rowSpan={2}>{cols.name}</TableCell>
                                        <TableCell rowSpan={2} align="right">{cols.fee}</TableCell>
                                        <TableCell colSpan={2} align="center"
                                            sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                            Increment
                                        </TableCell>
                                        <TableCell rowSpan={2} align="right"
                                            sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                            Pre-discount Price
                                        </TableCell>
                                        <TableCell colSpan={3} align="center"
                                            sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                            Discount
                                        </TableCell>
                                        <TableCell rowSpan={2} align="right"
                                            sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                            Final Price
                                        </TableCell>
                                        {/* One column per membership tier, after Final Price
                                            because each is that price less the tier's own
                                            rate — reading left to right is the arithmetic. */}
                                        {plans.length > 0 && (
                                            <TableCell colSpan={plans.length} align="center"
                                                sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                                Plan Discount — what a member pays
                                            </TableCell>
                                        )}
                                    </TableRow>
                                    {/* Sub-header row for the grouped columns */}
                                    <TableRow sx={{ '& th': { fontWeight: 600, bgcolor: 'action.hover' } }}>
                                        <TableCell align="center"
                                            sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>Fixed</TableCell>
                                        <TableCell align="center">% Increment</TableCell>
                                        <TableCell align="center"
                                            sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>Overall</TableCell>
                                        <TableCell align="center">Vouchers</TableCell>
                                        <TableCell align="center">Coupons</TableCell>
                                        {plans.map((p, idx) => (
                                            <TableCell
                                                key={p.id}
                                                align="center"
                                                sx={idx === 0
                                                    ? { borderLeft: '1px solid', borderColor: 'divider' }
                                                    : undefined}
                                            >
                                                {p.name}
                                                <Typography variant="caption" color="text.secondary"
                                                    sx={{ display: 'block', fontWeight: 400 }}>
                                                    {planCap(p) > 0 ? `up to ${planCap(p)}%` : 'no benefit'}
                                                </Typography>
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {rows.map((r, i) => {
                                        const parts = priceParts(r, vouchers, coupons);
                                        const changed = serverRows[i]
                                            && rowSignature(r) !== rowSignature(serverRows[i]);
                                        // Services and group offerings both carry a publish
                                        // state, and a rule can be set before either goes
                                        // live — so flag it rather than hide the row.
                                        //
                                        // The two spell "live" differently: a service listing
                                        // is 'approved', a plan is 'published'. Testing every
                                        // row against 'approved' badged every published plan
                                        // as not-live, in warning orange, labelled with the
                                        // very word that means it IS live.
                                        const liveStatus = isGroup ? 'published' : 'approved';
                                        const notLive = r.approval_status !== undefined
                                            && (r.approval_status !== liveStatus || !r.listing_active);
                                        return (
                                            <TableRow key={r.row_id} hover>
                                                <TableCell>{i + 1}</TableCell>
                                                <TableCell>{r.registration_number || '—'}</TableCell>
                                                <TableCell>
                                                    {r.doctor_name}
                                                    {r.description && (
                                                        <Typography variant="caption" color="text.secondary"
                                                            sx={{ display: 'block' }}>
                                                            {r.description}
                                                        </Typography>
                                                    )}
                                                    {notLive && (
                                                        <Chip
                                                            size="small"
                                                            variant="outlined"
                                                            color="warning"
                                                            sx={{ mt: 0.5, height: 18, fontSize: '0.65rem' }}
                                                            label={r.approval_status !== liveStatus
                                                                ? r.approval_status
                                                                : 'inactive'}
                                                        />
                                                    )}
                                                </TableCell>
                                                <TableCell align="right">{inr(r.doctor_fee)}</TableCell>
                                                {/* Increment — admin entered */}
                                                <TableCell align="center"
                                                    sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                                    <NumCell row={r} field="increment_fixed"
                                                        adornment={RUPEE_ADORN} onEdit={editRow} />
                                                </TableCell>
                                                <TableCell align="center">
                                                    <NumCell row={r} field="increment_pct"
                                                        adornment={PCT_ADORN} onEdit={editRow} />
                                                </TableCell>
                                                {/* Fee + increment, before anything is taken off —
                                                    the base the discounts below are applied to. */}
                                                <TableCell align="right"
                                                    sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                                    {inr(parts.gross)}
                                                </TableCell>
                                                {/* Discount — Overall admin entered */}
                                                <TableCell align="center"
                                                    sx={{ borderLeft: '1px solid', borderColor: 'divider' }}>
                                                    <NumCell row={r} field="overall_discount_pct"
                                                        adornment={PCT_ADORN} onEdit={editRow} />
                                                </TableCell>
                                                {/* Vouchers / coupons — one cell each, showing only the
                                                    deduction; the full list opens in a popover. */}
                                                <TableCell align="center">
                                                    <DiscountPicker
                                                        options={vouchers}
                                                        selectedIds={r.voucher_ids || []}
                                                        onChange={(ids) => editRow(r.row_id, 'voucher_ids', ids)}
                                                        emptyHint="No vouchers yet — add the first one below."
                                                        createKinds={CREATE_VOUCHERS}
                                                        onCreate={handleCreateDiscount}
                                                    />
                                                </TableCell>
                                                <TableCell align="center">
                                                    <DiscountPicker
                                                        options={coupons}
                                                        selectedIds={r.coupon_ids || []}
                                                        onChange={(ids) => editRow(r.row_id, 'coupon_ids', ids)}
                                                        emptyHint="No coupons yet — add the first one below."
                                                        createKinds={CREATE_COUPONS}
                                                        onCreate={handleCreateDiscount}
                                                    />
                                                </TableCell>
                                                <TableCell align="right"
                                                    sx={{
                                                        borderLeft: '1px solid', borderColor: 'divider',
                                                        fontWeight: 700,
                                                        color: changed ? 'warning.main' : 'inherit',
                                                    }}>
                                                    <Tooltip
                                                        placement="left"
                                                        title={(
                                                            <Box sx={{ whiteSpace: 'nowrap' }}>
                                                                <div>Doctor fee: {inr(parts.fee)}</div>
                                                                <div>+ Fixed: {inr(parts.incrementFixed)}</div>
                                                                <div>+ {num(r.increment_pct)}%: {inr(parts.incrementPctAmount)}</div>
                                                                <div>= Gross: {inr(parts.gross)}</div>
                                                                <div>− Overall {num(r.overall_discount_pct)}%: {inr(parts.overall)}</div>
                                                                <div>= Final Price: {inr(parts.display)}</div>
                                                                <div>− Vouchers: {inr(parts.voucher)}</div>
                                                                <div>− Coupons: {inr(parts.coupon)}</div>
                                                                <div>= With vouchers: {inr(parts.withVouchers)}</div>
                                                            </Box>
                                                        )}
                                                    >
                                                        <span>{inr(parts.display)}</span>
                                                    </Tooltip>
                                                    {/* The voucher price as its own
                                                        figure. Picking a voucher adds
                                                        a line here; it never moves the
                                                        one above. */}
                                                    {parts.withVouchers !== parts.display && (
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                display: 'block', fontWeight: 700,
                                                                color: 'primary.main', lineHeight: 1.3,
                                                            }}
                                                        >
                                                            {inr(parts.withVouchers)} w/ voucher
                                                        </Typography>
                                                    )}
                                                    {/* GST/TDS split for this row. An icon + popover
                                                        rather than columns — the two supplies have
                                                        ~8 lines of detail between them. */}
                                                    <TaxBreakdown
                                                        doctorFee={r.doctor_fee}
                                                        displayPrice={parts.display}
                                                        scopeType={offering.value}
                                                        doctorName={r.doctor_name}
                                                        tdsRate={r.tds_rate}
                                                        size="small"
                                                    />
                                                </TableCell>
                                                {plans.map((p, idx) => (
                                                    <TableCell
                                                        key={p.id}
                                                        align="center"
                                                        sx={idx === 0
                                                            ? { borderLeft: '1px solid', borderColor: 'divider' }
                                                            : undefined}
                                                    >
                                                        <PlanDiscountCell
                                                            row={r}
                                                            plan={p}
                                                            displayPrice={parts.display}
                                                            book={planBook}
                                                            onEdit={editPlanDiscount}
                                                            onPickDiscounts={editPlanPicks}
                                                            onCreateDiscount={handleCreateDiscount}
                                                        />
                                                    </TableCell>
                                                ))}
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}

                    <Divider sx={{ my: 2 }} />
                    <Typography variant="caption" color="text.secondary" component="div">
                        <strong>Doctor Fee</strong> is the doctor's own quoted price for this{' '}
                        {scopeNoun} — their payout.{' '}
                        <strong>Increment (Fixed + %)</strong>, the <strong>Overall</strong>{' '}
                        discount and the <strong>Vouchers</strong> / <strong>Coupons</strong> that apply
                        are all set by you. <strong>Pre-discount Price</strong> = Doctor Fee + Increment
                        (fixed + %) — the base every discount below comes off.{' '}
                        <strong>Final Price</strong> = Pre-discount Price − Overall. Vouchers and
                        coupons do NOT move it — they show as a separate{' '}
                        <strong>w/ voucher</strong> figure beneath, so you can always see what the
                        offering costs with and without one. A voucher or coupon meant for one row
                        can be created without leaving it — open the cell and use{' '}
                        <strong>＋ New</strong>; it is written to the book below and applied here in
                        one step. Final Price is what the patient is quoted{' '}
                        {(isGroup && 'when they browse the plan and charged at purchase.')
                            || (isService && 'in the marketplace and charged at purchase.')
                            || 'on the doctor card and charged at booking.'}{' '}
                        Hover a Final Price for the full breakdown.
                        {plans.length > 0 && (
                            <>
                                {' '}Each <strong>Plan Discount</strong> column is the Final Price
                                less what that membership tier takes off this row — what a member of
                                it actually pays. The % beneath is editable and capped at the tier's
                                own headline benefit; leave it blank to grant the full cap, so
                                lowering the tier later lowers this row with it. Beneath that, pick
                                the vouchers / coupons that apply <em>only</em> to that tier's
                                members: same two books as the columns above, but taken off at
                                purchase for those buyers alone, after the %. Those show as a
                                second <strong>w/ voucher</strong> figure rather than replacing the
                                first, so you can see what the tier grants and what the voucher
                                adds — both are charged, and the second figure is what that
                                member actually pays. None of it is folded into Final Price on
                                purpose — that number is quoted before we know who is looking.
                            </>
                        )}
                    </Typography>

                    {/* ── The two discount books ──
                        Scoped to the pricing table: they exist to feed the
                        Vouchers / Coupons columns directly above, so they only
                        make sense next to the rows that consume them. The outer
                        offering and slot pickers stay uncluttered. */}
                    <Divider sx={{ my: 3 }}>
                        <Chip label="Discount books" size="small" />
                    </Divider>
                    <Grid container spacing={2} alignItems="stretch">
                        <Grid item xs={12} md={6}>
                            <DiscountBook
                                kind="vouchers"
                                title="Vouchers"
                                blurb="Flat ₹ reductions. Pick them per row in the Vouchers column above — or add one straight from a row with ＋ New voucher."
                                onToast={(severity, message) => setToast({ severity, message })}
                            />
                        </Grid>
                        <Grid item xs={12} md={6}>
                            <DiscountBook
                                kind="coupons"
                                title="Coupons"
                                blurb="Flat ₹ reductions, kept separate from vouchers. Pick them per row above, or add one from a row with ＋ New coupon."
                                onToast={(severity, message) => setToast({ severity, message })}
                            />
                        </Grid>
                    </Grid>
                </>
            )}

            <Snackbar
                open={!!toast}
                autoHideDuration={5000}
                onClose={() => setToast(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={toast?.severity || 'info'} onClose={() => setToast(null)}>
                    {toast?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default PricingConfig;
