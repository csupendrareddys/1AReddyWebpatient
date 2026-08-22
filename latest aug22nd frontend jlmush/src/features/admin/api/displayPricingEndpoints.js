/**
 * Display Pricing Configuration endpoints (RTK Query).
 *
 * SUPER_ADMIN surface at /dashboard/admin/pricing-config. The overlay saved
 * here (increment + overall discount, per doctor × offering) is what the
 * patient is quoted and charged — the same rows drive the doctor cards, the
 * booking dialog, the marketplace listing and the payment amount.
 *
 * An offering is addressed by a (scope_type, scope_key) pair:
 *   - a consultation type + a duration slot  ('video', '10-20')
 *   - the service catalog + a product id     ('service', '<uuid>')
 *   - group offerings + a plan id            ('group_offering', '<uuid>')
 *
 * Both axes are read from the DB rather than hard-coded: an entry only shows
 * up once a provider has actually priced it.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const API_BASE = '/api/v1/admin/display-pricing';

/** scope_type for the Service / Product Catalog. Mirrors the backend. */
export const SERVICE_SCOPE = 'service';

/** scope_type for admin-authored group offerings (healthcare plans). Priced
 *  once per plan, so its rows carry no doctor. Mirrors the backend. */
export const GROUP_SCOPE = 'group_offering';

const displayPricingEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // [{ value, label, kind, doctor_count, scope_count, in_enum }]
        listDisplayPricingOfferings: builder.query({
            query: () => ({ url: `${API_BASE}/offerings`, method: 'GET' }),
            transformResponse: (res) => res?.data || [],
            providesTags: [{ type: 'DisplayPricing', id: 'OFFERINGS' }],
        }),

        // [{ key, label, sublabel, doctor_count }]
        listDisplayPricingScopes: builder.query({
            query: (scopeType) => ({
                url: `${API_BASE}/scopes`,
                method: 'GET',
                params: { scope_type: scopeType },
            }),
            transformResponse: (res) => res?.data || [],
            providesTags: (result, error, scopeType) => [
                { type: 'DisplayPricing', id: `SCOPES-${scopeType}` },
            ],
        }),

        // The tenant's receiver membership tiers — one Plan Discount column
        // each on the pricing table. ``member_discount_pct`` is that tier's
        // CEILING: the most any single offering may take off for a holder of
        // it, and the bound the per-row override is clamped to.
        //
        // [{ id, code, name, tier, member_discount_pct }]
        listPricingMembershipPlans: builder.query({
            query: () => ({ url: `${API_BASE}/membership-plans`, method: 'GET' }),
            transformResponse: (res) => res?.data || [],
            providesTags: [{ type: 'DisplayPricing', id: 'MEMBERSHIP-PLANS' }],
        }),

        // [{ row_id, doctor_id, registration_number, doctor_name, doctor_fee,
        //    description, increment_fixed, increment_pct,
        //    overall_discount_pct, voucher_ids, coupon_ids, plan_discounts,
        //    pre_discount_price, display_price, tds_rate,
        //    listing_active?, approval_status? }]
        //
        // ``plan_discounts`` comes back EFFECTIVE, not as stored: every
        // receiver tier is present, carrying the row's own override where it
        // has one and the tier's ceiling where it doesn't. The stored map is
        // sparse on purpose, so a raw read would show a blank cell for every
        // offering nobody has dialled down — when those grant the full ceiling.
        listDisplayPricingRows: builder.query({
            query: ({ scopeType, scopeKey }) => ({
                url: `${API_BASE}/rows`,
                method: 'GET',
                params: { scope_type: scopeType, scope_key: scopeKey },
            }),
            transformResponse: (res) => res?.data || [],
            providesTags: (result, error, arg) => [
                { type: 'DisplayPricing', id: `ROWS-${arg?.scopeType}-${arg?.scopeKey}` },
                // Shared tag so a voucher/coupon edit — which changes the
                // server-side display price of any row that selected it —
                // refreshes the open table without knowing its scope.
                { type: 'DisplayPricing', id: 'ROWS' },
            ],
        }),

        saveDisplayPricingRules: builder.mutation({
            query: ({ scopeType, scopeKey, rules }) => ({
                url: `${API_BASE}/rules`,
                method: 'PUT',
                data: { scope_type: scopeType, scope_key: scopeKey, rules },
            }),
            // Re-fetch the rows so the persisted display price (recomputed
            // server-side) replaces the locally-previewed one.
            invalidatesTags: (result, error, arg) => [
                { type: 'DisplayPricing', id: `ROWS-${arg?.scopeType}-${arg?.scopeKey}` },
            ],
        }),

        // ── Voucher / coupon books ────────────────────────────────────
        // One set of hooks serves both books; `kind` is 'vouchers' or
        // 'coupons'. They are separate tables server-side and separate tags
        // here, so editing the voucher book never re-fetches the coupon book.

        // [{ id, code, label, amount, is_active }]
        listDiscounts: builder.query({
            query: (kind) => ({ url: `${API_BASE}/${kind}`, method: 'GET' }),
            transformResponse: (res) => res?.data || [],
            providesTags: (result, error, kind) => [
                { type: 'DisplayPricing', id: `BOOK-${kind}` },
            ],
        }),

        createDiscount: builder.mutation({
            query: ({ kind, body }) => ({
                url: `${API_BASE}/${kind}`,
                method: 'POST',
                data: body,
            }),
            // Only the book. A discount that has just been created is named by
            // no saved rule, so it cannot have moved any row's server-side
            // price — and re-fetching the rows would reset the pricing table's
            // locally-edited copy, discarding every unsaved change on screen.
            // That matters now that a row's picker can create one: the create
            // would undo the selection it exists to make. Update and delete DO
            // change the price of rules that name the row, so they still
            // invalidate ROWS below.
            invalidatesTags: (result, error, arg) => [
                { type: 'DisplayPricing', id: `BOOK-${arg?.kind}` },
            ],
        }),

        updateDiscount: builder.mutation({
            query: ({ kind, id, body }) => ({
                url: `${API_BASE}/${kind}/${id}`,
                method: 'PUT',
                data: body,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'DisplayPricing', id: `BOOK-${arg?.kind}` },
                { type: 'DisplayPricing', id: 'ROWS' },
            ],
        }),

        deleteDiscount: builder.mutation({
            query: ({ kind, id }) => ({
                url: `${API_BASE}/${kind}/${id}`,
                method: 'DELETE',
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'DisplayPricing', id: `BOOK-${arg?.kind}` },
                { type: 'DisplayPricing', id: 'ROWS' },
            ],
        }),
    }),
});

export const {
    useListPricingMembershipPlansQuery,
    useListDisplayPricingOfferingsQuery,
    useListDisplayPricingScopesQuery,
    useListDisplayPricingRowsQuery,
    useSaveDisplayPricingRulesMutation,
    useListDiscountsQuery,
    useCreateDiscountMutation,
    useUpdateDiscountMutation,
    useDeleteDiscountMutation,
} = displayPricingEndpoints;

export default displayPricingEndpoints;
