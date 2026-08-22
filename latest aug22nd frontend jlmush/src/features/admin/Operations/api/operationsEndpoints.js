/**
 * Operations (super-admin IT-support) RTK-Query endpoints.
 * Member flow is generic over memberType: patient | doctor | admin.
 * Base: /api/admin/operations.
 */
import { apiSlice } from '../../../../app/api/apiSlice';
import { scopeTag } from '../../../service-receiver/api/patientScope';

const OPS = '/api/v1/admin/operations';

// memberType → URL resource segment
const MEMBER_BASE = {
    patient: 'patients',
    doctor: 'doctor-members',
    admin: 'admin-members',
    // Provider facilities. The backend serves both from one
    // ``/<vertical>-members`` route, so the segment is just the type name.
    // They have a LIST and a proxy but no ``/profile`` endpoint: everything an
    // operator edits about a facility lives on its EntityProfile, which the
    // detail screen drives through the proxy against the facility's own
    // ``/api/v1/entity-profile/me``. ``getOpsMemberProfile`` is therefore never
    // called for these two — see PatientOpsDetail.
    clinic: 'clinic-members',
    hospital: 'hospital-members',
};
// memberType → the shared admin-list cache tag to also refresh after an edit
const SHARED_LIST_TAG = {
    patient: 'Patient', doctor: 'Doctor', admin: 'Admin',
    clinic: 'Clinic', hospital: 'Hospital',
};

const clean = (params = {}) =>
    Object.fromEntries(
        Object.entries(params).filter(
            ([, v]) => v !== undefined && v !== null && v !== '',
        ),
    );

export const operationsEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // ── Generic member list / profile (patient|doctor|admin) ──
        getOpsMembers: builder.query({
            query: ({ memberType, ...params }) => {
                const qs = new URLSearchParams(clean(params)).toString();
                return { url: `${OPS}/${MEMBER_BASE[memberType]}${qs ? `?${qs}` : ''}`, method: 'GET' };
            },
            transformResponse: (res) => ({
                // patient list returns `patients`; doctor/admin return `members`
                members: res.data?.members || res.data?.patients || [],
                pagination: res.data?.pagination || {},
            }),
            providesTags: (r, e, { memberType }) => [{ type: 'OpsPatient', id: `LIST-${memberType}` }],
        }),

        getOpsMemberProfile: builder.query({
            query: ({ memberType, memberId }) => ({
                url: `${OPS}/${MEMBER_BASE[memberType]}/${memberId}/profile`, method: 'GET',
            }),
            transformResponse: (res) => res.data || { sections: {}, meta: {} },
            providesTags: (r, e, { memberId }) => [{ type: 'OpsPatient', id: memberId }],
        }),

        // Who last changed this patient's profile, and when. Admin-only —
        // there is no patient-facing equivalent.
        //
        // The tag id is deliberately built with the same ``scopeTag`` the
        // patient-profile mutations use: they invalidate
        // ``ProfileAudit/CURRENT@<patientId>`` via ``invalidatesProfile``, so
        // a save inside the embedded ProfileSetting refreshes this header
        // without the two components knowing about each other.
        getOpsPatientProvenance: builder.query({
            query: (patientId) => ({
                url: `${OPS}/patients/${patientId}/profile-provenance`, method: 'GET',
            }),
            transformResponse: (res) => res?.data || res,
            providesTags: (r, e, patientId) => [
                { type: 'ProfileAudit', id: scopeTag(patientId, 'CURRENT') },
            ],
        }),

        updateOpsMemberSection: builder.mutation({
            query: ({ memberType, memberId, section, data }) => ({
                url: `${OPS}/${MEMBER_BASE[memberType]}/${memberId}/profile/${section}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (r, e, { memberType, memberId }) => [
                { type: 'OpsPatient', id: memberId },
                { type: 'OpsPatient', id: `LIST-${memberType}` },
                { type: SHARED_LIST_TAG[memberType] || 'OpsPatient', id: 'LIST' },
            ],
        }),

        // ── Booking (patient only) ──
        // These three backed the old bespoke "Book on behalf" panel, which the
        // patient's real booking screens replaced (see PatientBookingBox). The
        // backend routes are still live, so they're kept as the thin
        // programmatic path for booking one appointment without driving the
        // full flow.
        getOpsDoctors: builder.query({
            query: (search = '') => {
                const qs = search ? `?search=${encodeURIComponent(search)}` : '';
                return { url: `${OPS}/doctors${qs}`, method: 'GET' };
            },
            transformResponse: (res) => res.data?.doctors || [],
        }),
        getOpsDoctorSlots: builder.query({
            query: ({ doctorId, date, consultationType }) => ({
                url: `${OPS}/doctors/${doctorId}/slots`,
                method: 'GET',
                params: clean({ date, consultation_type: consultationType }),
            }),
            transformResponse: (res) => res.data?.slots || [],
        }),
        bookOnBehalf: builder.mutation({
            query: ({ patientId, ...data }) => ({
                url: `${OPS}/patients/${patientId}/appointments`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'Appointment', id: 'LIST' }, { type: 'OpsBooking', id: 'LIST' }],
        }),

        // Record the offline payment state of a booking an admin just made on
        // a patient's behalf. This is the ops stand-in for the Razorpay step —
        // an admin can't complete the patient's checkout, so they either leave
        // the booking unpaid (patient pays from their own app) or record that
        // it was already settled at the counter. `kind` is one of
        // appointment | order | booking_installment; the amount always comes
        // from the row server-side.
        //
        // The invalidations cover all three booking kinds because one endpoint
        // serves all three and the caller shouldn't have to remember which
        // list its `kind` refreshes.
        settleOpsPayment: builder.mutation({
            query: ({ patientId, kind, id, markAsPaid = false }) => ({
                url: `${OPS}/patients/${patientId}/settle-payment`,
                method: 'POST',
                data: { kind, id, mark_as_paid: markAsPaid },
            }),
            transformResponse: (res) => res?.data || res,
            invalidatesTags: [
                'Appointment', 'MarketplaceOrder', 'GroupOfferingBooking',
                { type: 'OpsBooking', id: 'LIST' },
            ],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetOpsMembersQuery,
    useGetOpsMemberProfileQuery,
    useGetOpsPatientProvenanceQuery,
    useUpdateOpsMemberSectionMutation,
    useGetOpsDoctorsQuery,
    useLazyGetOpsDoctorSlotsQuery,
    useBookOnBehalfMutation,
    useSettleOpsPaymentMutation,
} = operationsEndpoints;
