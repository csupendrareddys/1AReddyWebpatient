import { apiSlice } from '../../../app/api/apiSlice';
import {
    splitScope, scopeOf, patientScopedUrl, apiScopedUrl, scopeTag,
    invalidatesProfile, auditTag,
} from './patientScope';

// Only for the handful of endpoints that are still unscoped. Everything the
// Operations act-on-behalf view drives goes through `patientScoped` /
// `apiScoped` below, which pick the base from the active scope.
const PATIENT_URL = '/api/patient';

/**
 * Build the ``get<Name>`` / ``update<Name>`` pair for one profile section.
 *
 * All six sections are the same shape — GET the section, PUT the whole
 * section back — and all six have to be scope-aware for the Operations
 * act-on-behalf view. Declaring them once means a URL or tag can't drift
 * between the read and the write.
 *
 * @param {string} name  PascalCase endpoint suffix, e.g. 'PersonalDetails'
 * @param {string} slug  URL segment under /profile, e.g. 'personal-details'
 * @param {string} tagId Cache tag id, e.g. 'PERSONAL_DETAILS'
 */
const profileSection = (builder, name, slug, tagId) => ({
    [`get${name}`]: builder.query({
        query: (arg) => ({
            url: patientScopedUrl(scopeOf(arg), `/profile/${slug}`),
            method: 'GET',
        }),
        transformResponse: (response) => response?.data || response,
        providesTags: (r, e, arg) => [
            { type: 'Patient', id: scopeTag(scopeOf(arg), tagId) },
        ],
    }),
    [`update${name}`]: builder.mutation({
        query: (arg) => {
            const [scope, data] = splitScope(arg);
            return {
                url: patientScopedUrl(scope, `/profile/${slug}`),
                method: 'PUT',
                data,
            };
        },
        invalidatesTags: (r, e, arg) => invalidatesProfile(
            scopeOf(arg), { type: 'Patient', id: scopeTag(scopeOf(arg), tagId) },
        ),
    }),
});

/**
 * Wrap an endpoint's ``query`` so the same declaration serves both scopes.
 *
 * The inner builder returns ``{ path, ... }`` with ``path`` relative to the
 * base (``/api/patient`` for {@link patientScoped}, ``/api`` for
 * {@link apiScoped}); the wrapper peels the ops patient id off the arg, calls
 * the builder with the *original* arg, and resolves ``path`` against whichever
 * base the scope selects.
 *
 * Cache tags are deliberately left alone. Tags only drive refetching, and the
 * per-patient cache separation already comes from the arg (see patientScope.js)
 * — so an over-broad tag costs one extra refetch, while a scoped tag that no
 * longer matches an existing bare ``invalidatesTags`` elsewhere would silently
 * stop refreshing. Only tag builders that read a *scalar* arg need touching,
 * because ``withScope`` boxes scalars; those use {@link unscopedArg}.
 */
const scopedQuery = (resolveUrl) => (build) => (arg) => {
    const [scope, inner] = splitScope(arg);
    const { path, ...rest } = build(inner);
    return { url: resolveUrl(scope, path), ...rest };
};
const patientScoped = scopedQuery(patientScopedUrl);
const apiScoped = scopedQuery(apiScopedUrl);

/** The caller's original arg, with any ops scope removed. For tag builders. */
const unscopedArg = (arg) => splitScope(arg)[1];

const patientEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // --- PROFILE ---
        getPatientProfile: builder.query({
            query: () => ({
                url: `${PATIENT_URL}/profile`,
                method: 'GET',
            }),
            providesTags: ['Patient'],
        }),
        updatePatientProfile: builder.mutation({
            query: (data) => ({
                url: `${PATIENT_URL}/profile`,
                method: 'PUT',
                data,
            }),
            // Whole-profile PUT — refresh the "last updated" header too.
            invalidatesTags: (r, e, arg) => invalidatesProfile(scopeOf(arg), 'Patient'),
        }),
        // Who last changed this profile — owner / linked family / staff / admin
        // / doctor. Provides the shared audit tag, so every section save (which
        // invalidates it via ``invalidatesProfile``) refetches this indicator.
        getProfileLastUpdate: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/profile/last-update'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response,
            providesTags: (r, e, arg) => [auditTag(scopeOf(arg))],
        }),
        // Per-section "who last changed this" — {section_key: {updated_at,
        // updated_by}}. Shares the audit tag so any section save refetches it.
        getProfileSectionUpdates: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/profile/section-updates'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data || response || {},
            providesTags: (r, e, arg) => [auditTag(scopeOf(arg))],
        }),

        // --- DOCTORS ---
        // Scope-aware even though these routes are public/optional-JWT: they
        // decorate prices with the *caller's* membership tier, so an admin
        // reading them unscoped would quote the admin's discount on the
        // patient's booking screen.
        getDoctorsList: builder.query({
            query: apiScoped((params = {}) => ({
                path: '/doctor/list',
                method: 'GET',
                params,
            })),
            transformResponse: (response) => ({
                doctors: response.data?.doctors || [],
                pagination: response.data?.pagination || { total: 0 },
            }),
            providesTags: (result) => 
                result 
                    ? [...result.doctors.map(({ id }) => ({ type: 'Doctor', id })), { type: 'Doctor', id: 'LIST' }]
                    : [{ type: 'Doctor', id: 'LIST' }],
        }),
        getDoctorDetail: builder.query({
            query: apiScoped((doctorId) => ({
                path: `/doctor/${doctorId}/public`,
                method: 'GET',
            })),
            providesTags: (result, error, arg) => [
                { type: 'Doctor', id: unscopedArg(arg) },
            ],
        }),
        // A doctor's bookable services + care plans, for their profile page.
        getDoctorOfferings: builder.query({
            query: (doctorId) => ({ url: `${DOCTOR_URL}/${doctorId}/offerings`, method: 'GET' }),
            transformResponse: (res) => res?.data || { services: [], group_offerings: [] },
            providesTags: (result, error, doctorId) => [{ type: 'Doctor', id: `${doctorId}-offerings` }],
        }),
        getDoctorSlots: builder.query({
            query: apiScoped(({ doctorId, date, consultationType }) => ({
                path: `/doctor/${doctorId}/slots`,
                method: 'GET',
                params: { date, ...(consultationType && { consultation_type: consultationType }) },
            })),
            transformResponse: (response) => ({
                slots: response.data?.slots || [],
                slot_pricing: response.data?.slot_pricing || [],
                approved: response.data?.approved ?? false,
                booked_slots: response.data?.booked_slots || [],   // CONFIRMED — slot taken
                pending_slots: response.data?.pending_slots || [],  // PENDING — already requested
            }),
            providesTags: (result, error, { doctorId, date, consultationType }) => [
                { type: 'Doctor', id: `${doctorId}-slots-${date}-${consultationType || 'all'}` }
            ],
        }),
        getDoctorSlotSummary: builder.query({
            query: apiScoped(({ doctorId, month, consultationType }) => ({
                path: `/doctor/${doctorId}/slot-summary`,
                method: 'GET',
                params: { month, ...(consultationType && { consultation_type: consultationType }) },
            })),
            // dates: { "2026-02-23": 14, "2026-02-24": 3, ... }  approved: bool
            transformResponse: (response) => ({
                dates: response.data?.dates || {},
                approved: response.data?.approved ?? false,
            }),
            providesTags: (result, error, { doctorId, month, consultationType }) => [
                { type: 'Doctor', id: `${doctorId}-summary-${month}-${consultationType || 'all'}` }
            ],
        }),
        // Consultation types the doctor has bookable slots for right now.
        // Drives the "Choose Consultation Type" screen so patients only see
        // sections that actually have availability.
        getDoctorAvailableConsultationTypes: builder.query({
            query: apiScoped((doctorId) => ({
                path: `/doctor/${doctorId}/available-consultation-types`,
                method: 'GET',
            })),
            transformResponse: (response) => ({
                types: response.data?.types || [],
                approved: response.data?.approved ?? false,
            }),
            providesTags: (result, error, arg) => [
                { type: 'Doctor', id: `${unscopedArg(arg)}-available-types` }
            ],
        }),


        // --- SYMPTOMS & PLATFORMS ---
        getSymptoms: builder.query({
            query: (category = null) => ({
                url: category 
                    ? `${PATIENT_URL}/symptoms?category=${category}`
                    : `${PATIENT_URL}/symptoms`,
                method: 'GET',
            }),
            transformResponse: (response) => ({
                symptoms: response.data?.symptoms || [],
                categories: response.data?.categories || [],
            }),
        }),
        getPlatforms: builder.query({
            query: () => ({
                url: `${PATIENT_URL}/platforms`,
                method: 'GET',
            }),
            transformResponse: (response) => response.data?.platforms || [],
        }),

        // --- APPOINTMENTS / ORDERS ---
        getUpcomingOrders: builder.query({
            query: apiScoped(() => ({
                path: '/appointment/patient/upcoming',
                method: 'GET',
            })),
            transformResponse: (response) => ({
                orders: response.data?.appointments || [],
                pagination: null,
            }),
            providesTags: ['Appointment'],
        }),
        getPreviousOrders: builder.query({
            query: apiScoped((params = {}) => {
                const { page = 1, per_page = 20 } = params || {};
                return {
                    path: '/appointment/patient/history',
                    method: 'GET',
                    params: { page, per_page },
                };
            }),
            transformResponse: (response) => ({
                orders: response.data?.appointments || [],
                pagination: response.data?.pagination,
            }),
            providesTags: ['Appointment'],
        }),
        getOrderDetail: builder.query({
            query: patientScoped((orderId) => ({
                path: `/orders/${orderId}`,
                method: 'GET',
            })),
            providesTags: (result, error, a) => [
                { type: 'Appointment', id: unscopedArg(a) },
            ],
        }),
        bookAppointment: builder.mutation({
            query: apiScoped((appointmentData) => ({
                // NO trailing slash. Backend registers the route as
                // ``@appointment_bp.route('')`` + ``url_prefix='/appointment'``,
                // which Flask serves at ``/api/appointment`` only.
                // ``/api/appointment/`` (with slash) 404s the CORS preflight,
                // breaking the actual POST. Bug surfaced as "Payment failed."
                path: '/appointment',
                method: 'POST',
                data: appointmentData,
            })),
            // Invalidate the specific slot cache for this doctor+date so slot chips refresh
            invalidatesTags: (result, error, a) => {
                const arg = unscopedArg(a);
                const tags = [
                    'Appointment',
                    { type: 'Doctor', id: 'LIST' },
                    { type: 'Doctor', id: `${arg.doctor_id}-slots-${arg.appointment_date}-${arg.consultation_type || 'all'}` },
                    { type: 'Doctor', id: `${arg.doctor_id}-slots-${arg.appointment_date}-all` },
                ];
                if (arg.appointment_date) {
                    const month = arg.appointment_date.substring(0, 7);
                    tags.push({ type: 'Doctor', id: `${arg.doctor_id}-summary-${month}` });
                }
                return tags;
            },
        }),
        cancelAppointment: builder.mutation({
            query: apiScoped((appointmentId) => ({
                path: `/appointment/${appointmentId}/cancel`,
                method: 'POST',
            })),
            invalidatesTags: (result, error, a) => [
                'Appointment',
                { type: 'Appointment', id: unscopedArg(a) }
            ],
        }),
        submitRating: builder.mutation({
            query: ({ orderId, rating, review, is_anonymous }) => ({
                url: `${PATIENT_URL}/orders/${orderId}/rating`,
                method: 'POST',
                data: { rating, review, is_anonymous },
            }),
            invalidatesTags: (result, error, { orderId }) => [{ type: 'Appointment', id: orderId }],
        }),
        addOrderDocument: builder.mutation({
            query: patientScoped(({ orderId, ...documentData }) => ({
                path: `/orders/${orderId}/documents`,
                method: 'POST',
                data: documentData,
            })),
            invalidatesTags: (result, error, a) => [
                { type: 'Appointment', id: unscopedArg(a).orderId },
            ],
        }),

        // Documents attached to an appointment — powers the in-call Documents
        // panel (consultancy side). ``orderId`` is the appointment id.
        getAppointmentDocuments: builder.query({
            query: (appointmentId) => ({
                url: `${PATIENT_URL}/orders/${appointmentId}/documents`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data?.documents || [],
            providesTags: (result, error, appointmentId) => [
                { type: 'AppointmentDocument', id: appointmentId },
            ],
        }),
        // Direct multipart file upload for an appointment document (used during
        // a call). Mirrors uploadChannelDocument on the service side.
        uploadAppointmentDocument: builder.mutation({
            query: ({ appointmentId, file, description }) => {
                const formData = new FormData();
                formData.append('file', file);
                if (description) formData.append('description', description);
                return {
                    url: `${PATIENT_URL}/appointments/${appointmentId}/documents/upload`,
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (result, error, { appointmentId }) => [
                { type: 'AppointmentDocument', id: appointmentId },
            ],
        }),

        // --- HOUSE GROUP ---
        // Scope-aware — the Family Group tab is one of the surfaces an admin
        // drives on behalf of a patient from Operations.
        getHouseGroup: builder.query({
            query: (arg) => ({
                url: patientScopedUrl(scopeOf(arg), '/house-group'),
                method: 'GET',
            }),
            transformResponse: (response) => response.data?.members || [],
            providesTags: (r, e, arg) => [
                { type: 'HouseGroup', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ],
        }),
        addHouseGroupMember: builder.mutation({
            query: (arg) => {
                const [scope, data] = splitScope(arg);
                return { url: patientScopedUrl(scope, '/house-group'), method: 'POST', data };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg), { type: 'HouseGroup', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ),
        }),
        updateHouseGroupMember: builder.mutation({
            query: (arg) => {
                const [scope, { memberId, data }] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/${memberId}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg), { type: 'HouseGroup', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ),
        }),
        deleteHouseGroupMember: builder.mutation({
            query: (arg) => {
                const [scope, memberId] = splitScope(arg);
                return {
                    url: patientScopedUrl(scope, `/house-group/${memberId}`),
                    method: 'DELETE',
                };
            },
            invalidatesTags: (r, e, arg) => invalidatesProfile(
                scopeOf(arg), { type: 'HouseGroup', id: scopeTag(scopeOf(arg), 'CURRENT') },
            ),
        }),

        // --- MEMBERSHIP (patient's marketplace/receiver plan) ---
        // 404 = no membership; the component treats that as "no tag".
        getPatientMembership: builder.query({
            query: () => ({ url: '/api/membership/me', method: 'GET' }),
            transformResponse: (res) => res?.data || null,
        }),

        // --- MEMBER OFFERS (redeemable at checkout) ---
        // What the caller's membership tier lets them redeem on ONE slot.
        // Resolved off the same pricing rule the booking charges from, so the
        // list rendered here and the sum the server re-validates can't drift.
        getMemberOffers: builder.query({
            // Two shapes: a consultation (consultationType + duration) or a
            // catalog service (productId). Whichever is passed is what picks
            // the pricing rule the purchase charges from.
            query: patientScoped(({ doctorId, consultationType, duration, productId }) => ({
                path: '/member-offers',
                method: 'GET',
                params: {
                    doctor_id: doctorId,
                    ...(productId
                        ? { product_id: productId }
                        : { consultation_type: consultationType, duration }),
                },
            })),
            transformResponse: (res) => res?.data || [],
        }),

        // Verify ONE typed code against ONE purchase. A POST because the
        // offering is described by several fields and the answer depends on
        // who is asking — not a cacheable read.
        verifyRedeemCode: builder.mutation({
            query: patientScoped(({ code, kind, doctorId, consultationType, duration, productId }) => ({
                path: '/redeem-code',
                method: 'POST',
                data: {
                    code,
                    kind,
                    doctor_id: doctorId,
                    ...(productId
                        ? { product_id: productId }
                        : { consultation_type: consultationType, duration }),
                },
            })),
            transformResponse: (res) => res?.data,
        }),

        // --- PAYMENTS ---
        // Deliberately NOT scope-aware. There is no act-on-behalf path to
        // Razorpay — an admin can't complete someone else's checkout — so an
        // ops booking settles through
        // ``/admin/operations/patients/<id>/settle-payment`` instead. See
        // usePatientCheckout.js.
        createPaymentOrder: builder.mutation({
            query: (data) => ({
                url: `/api/payment/create-order`,
                method: 'POST',
                data,
            }),
        }),
        verifyPayment: builder.mutation({
            query: (data) => ({
                url: `/api/payment/verify`,
                method: 'POST',
                data,
            }),
            invalidatesTags: ['Appointment'],
        }),
        getPaymentStatus: builder.query({
            query: (appointmentId) => ({
                url: `/api/payment/appointment/${appointmentId}`,
                method: 'GET',
            }),
            providesTags: (result, error, appointmentId) => [{ type: 'Payment', id: appointmentId }],
        }),

        // ── Section-specific Profile Endpoints ──
        //
        // Scope-aware (see ./patientScope.js): with no scope these are the
        // patient's own ``/api/patient/*`` routes; through the Operations
        // act-on-behalf scope they target one specific patient and get their
        // own cache entries. ``profileSection`` builds both halves of a
        // GET/PUT pair so the URL, tag id and scope handling can't drift.
        ...profileSection(builder, 'PersonalDetails', 'personal-details', 'PERSONAL_DETAILS'),
        ...profileSection(builder, 'ContactIdentity', 'contact-identity', 'CONTACT_IDENTITY'),
        ...profileSection(builder, 'Address', 'address', 'ADDRESS'),
        ...profileSection(builder, 'EmergencyContact', 'emergency-contact', 'EMERGENCY_CONTACT'),
        ...profileSection(builder, 'Insurance', 'insurance', 'INSURANCE'),
        ...profileSection(builder, 'FemaleHealth', 'female-health', 'FEMALE_HEALTH'),

        // --- BOOKING FLOW: Consultation-Type-First ---
        getSlotAvailabilitySummary: builder.query({
            query: patientScoped(() => ({
                path: '/slot-availability-summary',
                method: 'GET',
            })),
            transformResponse: (response) => response?.data || {},
            providesTags: ['SlotAvailability'],
        }),
        searchDoctorsByType: builder.query({
            query: patientScoped((params) => ({
                path: '/doctors/search',
                method: 'GET',
                params,
            })),
            transformResponse: (response) => ({
                doctors: response?.data?.doctors || [],
                pagination: response?.data?.pagination || { total: 0 },
            }),
            providesTags: [{ type: 'Doctor', id: 'FILTERED_LIST' }],
        }),
        matchDoctorsBySymptoms: builder.mutation({
            query: patientScoped((body) => ({
                path: '/doctors/match',
                method: 'POST',
                data: body,
            })),
            transformResponse: (response) => ({
                doctors: response?.data?.doctors || [],
                pagination: response?.data?.pagination || { total: 0 },
            }),
        }),
        createAppointmentContext: builder.mutation({
            query: patientScoped((data) => ({
                path: '/appointment-context',
                method: 'POST',
                data,
            })),
            transformResponse: (response) => response?.data || {},
        }),
        getAppointmentContext: builder.query({
            query: patientScoped((contextId) => ({
                path: `/appointment-context/${contextId}`,
                method: 'GET',
            })),
            transformResponse: (response) => response?.data || {},
            providesTags: (result, error, a) => [
                { type: 'MedicalContext', id: unscopedArg(a) },
            ],
        }),
        updateAppointmentContext: builder.mutation({
            query: patientScoped(({ contextId, ...data }) => ({
                path: `/appointment-context/${contextId}`,
                method: 'PUT',
                data,
            })),
            invalidatesTags: (result, error, a) => [
                { type: 'MedicalContext', id: unscopedArg(a).contextId },
            ],
        }),
        deleteAppointmentContext: builder.mutation({
            query: patientScoped((contextId) => ({
                path: `/appointment-context/${contextId}`,
                method: 'DELETE',
            })),
        }),
        linkAppointmentContext: builder.mutation({
            // Link an intake context to whichever booking it belongs to — pass
            // exactly one of appointment_id / marketplace_order_id /
            // group_offering_booking_id.
            query: patientScoped(({ contextId, ...ids }) => ({
                path: `/appointment-context/${contextId}/link`,
                method: 'POST',
                data: ids,
            })),
        }),
        // Health-credit wallet: balance + recent ledger.
        getCredits: builder.query({
            query: patientScoped(() => ({ path: '/credits', method: 'GET' })),
            transformResponse: (res) => res?.data || { wallet: null, available: 0, ledger: [] },
            providesTags: ['HealthCredits'],
        }),
        // Max credits redeemable for a given offering + price.
        getCreditQuote: builder.query({
            query: patientScoped(({ offering, price }) => ({
                path: '/credits/quote',
                method: 'GET',
                params: { offering, price },
            })),
            transformResponse: (res) => res?.data || { allowed: false, max_redeemable: 0, available: 0 },
        }),
        // The patient's spending — every payment they made, labelled, + total.
        getSpending: builder.query({
            query: patientScoped(() => ({ path: '/spending', method: 'GET' })),
            transformResponse: (res) => res?.data || { payments: [], total_spent: 0 },
            providesTags: ['PatientSpending'],
        }),
        // Landing features (benefits / how it works / essentials) linked to a
        // booking offering via the Feature-Product Linking store. Pass whatever
        // the surface has: { offering, product_id, doctor_id, team_id }.
        getOfferingFeatures: builder.query({
            query: patientScoped((params = {}) => {
                const qs = new URLSearchParams(
                    Object.entries(params || {}).filter(([, v]) => v),
                ).toString();
                return { path: `/offerings/features?${qs}`, method: 'GET' };
            }),
            transformResponse: (res) => res?.data?.features || [],
        }),
        // Prescription(s) for one appointment — powers the completed-appointment
        // "View prescription" stub.
        getAppointmentPrescriptions: builder.query({
            query: patientScoped((appointmentId) => ({
                path: `/appointments/${appointmentId}/prescriptions`,
                method: 'GET',
            })),
            transformResponse: (res) => res?.data?.prescriptions || [],
            providesTags: (result, error, a) => [
                { type: 'AppointmentPrescriptions', id: unscopedArg(a) },
            ],
        }),

        // --- PATIENT PRESCRIPTIONS ---
        // Scope-aware: with no scope this is the caller's own prescriptions; a
        // guardian in a minor sub-profile (family scope) reads the MINOR's via
        // the act-on-behalf proxy. Same for documents below.
        getPatientPrescriptions: builder.query({
            query: patientScoped((params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { path: `/prescriptions?${qs}`, method: 'GET' };
            }),
            transformResponse: (res) => res.data || {},
            providesTags: ['PatientPrescriptions'],
        }),

        // Documents the doctor pushed to this patient (active only). Sibling
        // of prescriptions — a doctor either generates one or uploads a PDF.
        getPatientDocuments: builder.query({
            query: patientScoped((params = {}) => {
                const qs = new URLSearchParams(params).toString();
                return { path: `/documents?${qs}`, method: 'GET' };
            }),
            transformResponse: (res) => res.data || {},
            providesTags: ['PatientDocuments'],
        }),

        // --- FOLLOW-UP INVITES ---
        getFollowUpInvites: builder.query({
            query: patientScoped(() => ({ path: '/follow-up-invites', method: 'GET' })),
            transformResponse: (res) => res.data?.invites || [],
            providesTags: ['FollowUpInvite'],
        }),
        bookFollowUp: builder.mutation({
            query: patientScoped(({ inviteId, time_slot_id }) => ({
                path: `/follow-up-invites/${inviteId}/book`,
                method: 'POST',
                data: time_slot_id ? { time_slot_id } : {},
            })),
            invalidatesTags: ['FollowUpInvite', 'Appointment'],
        }),

        // --- GROUP OFFERINGS (healthcare plans) ---
        browseGroupOfferings: builder.query({
            query: patientScoped(() => ({ path: '/group-offerings', method: 'GET' })),
            transformResponse: (res) => res.data?.offerings || [],
            providesTags: ['GroupOfferingPlan'],
        }),
        getGroupOfferingDetail: builder.query({
            query: patientScoped((id) => ({ path: `/group-offerings/${id}`, method: 'GET' })),
            transformResponse: (res) => res.data || {},
            providesTags: ['GroupOfferingPlan'],
        }),
        getGroupOfferingTeams: builder.query({
            query: patientScoped((id) => ({ path: `/group-offerings/${id}/teams`, method: 'GET' })),
            transformResponse: (res) => res.data?.teams || [],
        }),
        bookGroupOffering: builder.mutation({
            query: patientScoped(({ id, team_id, redeem_credits }) => ({
                path: `/group-offerings/${id}/book`, method: 'POST',
                data: { team_id, redeem_credits: redeem_credits || 0 },
            })),
            transformResponse: (res) => res.data || {},
            invalidatesTags: ['GroupOfferingBooking'],
        }),
        getMyGroupOfferingBookings: builder.query({
            query: patientScoped(() => ({ path: '/group-offerings/bookings', method: 'GET' })),
            transformResponse: (res) => res.data?.bookings || [],
            providesTags: ['GroupOfferingBooking'],
        }),
    }),
    overrideExisting: false,
});

export const {
    // Membership (patient plan)
    useGetPatientMembershipQuery,
    // Profile
    useGetPatientProfileQuery,
    useUpdatePatientProfileMutation,
    useGetProfileLastUpdateQuery,
    useGetProfileSectionUpdatesQuery,
    // Doctors
    useGetDoctorsListQuery,
    useGetDoctorDetailQuery,
    useGetDoctorSlotsQuery,
    useGetDoctorOfferingsQuery,
    useGetDoctorSlotSummaryQuery,
    useGetDoctorAvailableConsultationTypesQuery,
    // Symptoms & Platforms
    useGetSymptomsQuery,
    useGetPlatformsQuery,
    // Orders
    useGetUpcomingOrdersQuery,
    useGetPreviousOrdersQuery,
    useGetOrderDetailQuery,
    useBookAppointmentMutation,
    useCancelAppointmentMutation,
    useSubmitRatingMutation,
    useAddOrderDocumentMutation,
    useGetAppointmentDocumentsQuery,
    useUploadAppointmentDocumentMutation,
    // House Group
    useGetHouseGroupQuery,
    useAddHouseGroupMemberMutation,
    useUpdateHouseGroupMemberMutation,
    useDeleteHouseGroupMemberMutation,
    // Member offers
    useGetMemberOffersQuery,
    useVerifyRedeemCodeMutation,
    // Payments
    useCreatePaymentOrderMutation,
    useVerifyPaymentMutation,
    useGetPaymentStatusQuery,
    // Group Offerings (healthcare plans)
    useBrowseGroupOfferingsQuery,
    useGetGroupOfferingDetailQuery,
    useGetGroupOfferingTeamsQuery,
    useBookGroupOfferingMutation,
    useGetMyGroupOfferingBookingsQuery,
    // Section-specific Profile
    useGetPersonalDetailsQuery,
    useUpdatePersonalDetailsMutation,
    useGetContactIdentityQuery,
    useUpdateContactIdentityMutation,
    useGetAddressQuery,
    useUpdateAddressMutation,
    useGetEmergencyContactQuery,
    useUpdateEmergencyContactMutation,
    useGetInsuranceQuery,
    useUpdateInsuranceMutation,
    useGetFemaleHealthQuery,
    useUpdateFemaleHealthMutation,
    // Booking Flow: Consultation-Type-First
    useGetSlotAvailabilitySummaryQuery,
    useSearchDoctorsByTypeQuery,
    useMatchDoctorsBySymptomsMutation,
    useCreateAppointmentContextMutation,
    useGetAppointmentContextQuery,
    useUpdateAppointmentContextMutation,
    useDeleteAppointmentContextMutation,
    useLinkAppointmentContextMutation,
    useGetOfferingFeaturesQuery,
    useGetSpendingQuery,
    useGetCreditsQuery,
    useGetCreditQuoteQuery,
    // Patient Prescriptions
    useGetAppointmentPrescriptionsQuery,
    useGetPatientPrescriptionsQuery,
    useGetPatientDocumentsQuery,
    // Follow-Up Invites
    useGetFollowUpInvitesQuery,
    useBookFollowUpMutation,
} = patientEndpoints;
