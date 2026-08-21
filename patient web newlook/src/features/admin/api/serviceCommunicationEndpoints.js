/**
 * Service Communication admin endpoints (RTK Query).
 *
 * Communication that comes bundled INTO an admin Service/Product (nutrition
 * package, wellness plan, chronic-disease management...). The admin sets the
 * terms per product here; a patient's purchase then snapshots them.
 *
 * Distinct from the appointment consultation flow — these settings belong to
 * the purchased service, not to a doctor's consultation settings.
 */
import { apiSlice } from '../../../app/api/apiSlice';
import {
    scopeOf, apiScopedUrl, splitScope as splitPatientScope,
} from '../../service-receiver/api/patientScope';
import {
    scopeOf as doctorScopeOf,
    splitScope as splitDoctorScope,
    apiScopedUrl as doctorApiScopedUrl,
} from '../../service-provider/api/doctorScope';

const BASE = '/api/service-communication';

/**
 * A channel call carries EITHER a doctor/ops scope OR a patient/guardian-family
 * scope (never both). ``splitAnyScope`` strips whichever is present and returns
 * ``[scopeId, payload]`` — the endpoints below use only the payload, and
 * ``channelUrl`` (which inspects both keys) builds the matching proxied URL.
 * This is what lets ONE set of channel endpoints serve the doctor, the patient,
 * an admin acting on a doctor, and a guardian acting on a minor.
 */
const splitAnyScope = (arg) => {
    const [d, restD] = splitDoctorScope(arg);
    if (d != null) return [d, restD];
    return splitPatientScope(arg);
};

/**
 * Both member scopes reach this blueprint, because both sides of a service
 * conversation are mounted in Operations: the patient's bookings list shows
 * which of their channels are open, and the doctor's "Service Chats" page is
 * a tab on the doctor detail screen.
 *
 * Reads and writes are both scoped on the doctor side — an operator can take
 * part in the conversation on the doctor's behalf. What they post is attributed
 * to the doctor's participant row, but the backend stamps it with the acting
 * admin (``sent_by_admin`` / ``sent_by_admin_name`` on the message), so the
 * thread shows a "Sent by support" marker to the patient and the doctor alike —
 * the ops audit log is no longer the only trace. The one exception is joining a
 * live call: the proxy allowlist refuses ``calls/<id>/join``, so that stays with
 * the doctor whatever the UI offers.
 *
 * Each scope reads its own underscored arg key, so an arg carrying one passes
 * through the other untouched and an unscoped caller keeps its existing URL.
 */
const channelUrl = (arg, path) => {
    // A doctor / ops-on-doctor scope routes to the doctor proxy; a patient or
    // guardian-on-MINOR (``family:<id>``) scope routes to the patient proxy so
    // the minor's channels load, not the guardian's. Only one is ever set.
    const ops = doctorScopeOf(arg);
    if (ops) return doctorApiScopedUrl(ops, `/service-communication${path}`);
    const pat = scopeOf(arg);
    if (pat) return apiScopedUrl(pat, `/service-communication${path}`);
    return `${BASE}${path}`;
};

const serviceCommunicationEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Hold state for ANY logged-in user (doctor via vendor logic, others via
        // account status). Used by non-doctor layouts to route held users to the
        // holding page.
        getHoldingAccountState: builder.query({
            query: () => ({ url: `${BASE}/account-state`, method: 'GET' }),
            transformResponse: (res) => res.data || res,
        }),
        // Returns { product_id, config } where config is null when the product
        // has no communication terms yet — the form renders defaults in that
        // case rather than erroring.
        getServiceCommunicationConfig: builder.query({
            query: (productId) => ({
                url: `${BASE}/config/${productId}`,
                method: 'GET',
            }),
            transformResponse: (response) => response?.data?.config || null,
            providesTags: (result, error, productId) => [
                { type: 'ServiceCommunicationConfig', id: productId },
            ],
        }),

        upsertServiceCommunicationConfig: builder.mutation({
            query: ({ productId, ...data }) => ({
                url: `${BASE}/config/${productId}`,
                method: 'PUT',
                data,
            }),
            invalidatesTags: (result, error, arg) => [
                { type: 'ServiceCommunicationConfig', id: arg.productId },
            ],
        }),

        // Admin/manual activation — the marketplace purchase route is still a
        // stub, so this is how a channel comes into existence today.
        activatePurchasedService: builder.mutation({
            query: (data) => ({
                url: `${BASE}/purchases`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'ServiceChannel', id: 'LIST' }],
        }),

        // Group-offering activation — mints the group chat + one 1:1 channel
        // per serving doctor in a single call. Body: { group_id, patient_id }.
        activateGroupPurchase: builder.mutation({
            query: (data) => ({
                url: `${BASE}/group-purchases`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [{ type: 'ServiceChannel', id: 'LIST' }],
        }),

        listMyServiceChannels: builder.query({
            // Scope-aware on BOTH sides: the bookings list an admin views in
            // Operations shows the PATIENT's open channels, and the doctor
            // detail screen's Service Chats tab shows the DOCTOR's. Read
            // unscoped either would answer with the admin's own (empty) set.
            query: (arg) => ({
                url: doctorScopeOf(arg)
                    ? doctorApiScopedUrl(doctorScopeOf(arg), '/service-communication/channels')
                    : apiScopedUrl(scopeOf(arg), '/service-communication/channels'),
                method: 'GET',
            }),
            transformResponse: (response) => response?.data?.channels || [],
            providesTags: [{ type: 'ServiceChannel', id: 'LIST' }],
        }),

        getServiceChannel: builder.query({
            query: (arg) => {
                const [, channelId] = splitAnyScope(arg);
                return { url: channelUrl(arg, `/channels/${channelId}`), method: 'GET' };
            },
            transformResponse: (response) => response?.data || null,
            providesTags: (result, error, arg) => [
                { type: 'ServiceChannel', id: splitAnyScope(arg)[1] },
            ],
        }),

        // Chat history, oldest-first. ``before`` pages further back.
        getChannelMessages: builder.query({
            query: (arg) => {
                const [, { channelId, before, limit = 50 }] = splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/messages`),
                    method: 'GET',
                    params: { ...(before ? { before } : {}), limit },
                };
            },
            transformResponse: (response) => response?.data
                || { messages: [], has_more: false },
            providesTags: (result, error, arg) => [
                { type: 'ChannelMessages', id: splitAnyScope(arg)[1].channelId },
            ],
        }),

        sendChannelMessage: builder.mutation({
            query: (arg) => {
                const [, { channelId, body, client_msg_id }] = splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/messages`),
                    method: 'POST',
                    data: { body, client_msg_id },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'ChannelMessages', id: splitAnyScope(arg)[1].channelId },
                { type: 'ServiceChannel', id: 'LIST' },
            ],
        }),

        markChannelRead: builder.mutation({
            query: (arg) => {
                const [, channelId] = splitAnyScope(arg);
                return { url: channelUrl(arg, `/channels/${channelId}/read`), method: 'POST' };
            },
            invalidatesTags: [{ type: 'ServiceChannel', id: 'LIST' }],
        }),

        // ── Scheduled calls ──────────────────────────────────────────
        getChannelCalls: builder.query({
            query: (arg) => {
                const [, channelId] = splitAnyScope(arg);
                return { url: channelUrl(arg, `/channels/${channelId}/calls`), method: 'GET' };
            },
            transformResponse: (response) => response?.data?.calls || [],
            providesTags: (result, error, arg) => [
                { type: 'ChannelCalls', id: splitAnyScope(arg)[1] },
            ],
        }),
        scheduleChannelCall: builder.mutation({
            query: (arg) => {
                const [, { channelId, mode, scheduled_start, scheduled_end }] =
                    splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/calls`),
                    method: 'POST',
                    data: { mode, scheduled_start, scheduled_end },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'ChannelCalls', id: splitAnyScope(arg)[1].channelId },
            ],
        }),
        proposeChannelCall: builder.mutation({
            query: (arg) => {
                const [, { channelId, suggested_time, note }] = splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/calls/propose`),
                    method: 'POST',
                    data: { suggested_time, note },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'ChannelMessages', id: splitAnyScope(arg)[1].channelId },
            ],
        }),
        // One mutation for the accept/cancel/join/leave/end actions — they
        // share a shape (channelId + callId → refetch the call list).
        // ``join`` is NOT proxied by the backend allowlist — an admin can move
        // a call through its schedule on the doctor's behalf, but not walk into
        // the room. That call comes from the meeting page, not from here.
        callAction: builder.mutation({
            query: (arg) => {
                const [, { channelId, callId, action }] = splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/calls/${callId}/${action}`),
                    method: 'POST',
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'ChannelCalls', id: splitAnyScope(arg)[1].channelId },
                { type: 'ServiceChannel', id: splitAnyScope(arg)[1].channelId },
            ],
        }),

        // ── Documents ────────────────────────────────────────────────
        // The unified "My Documents" list — every document across all the
        // caller's services (patient or doctor).
        getMyDocuments: builder.query({
            query: () => ({ url: `${BASE}/my/documents`, method: 'GET' }),
            transformResponse: (response) => response?.data?.documents || [],
            providesTags: [{ type: 'ChannelDocuments', id: 'MINE' }],
        }),
        getChannelDocuments: builder.query({
            query: (arg) => {
                const [, channelId] = splitAnyScope(arg);
                return { url: channelUrl(arg, `/channels/${channelId}/documents`), method: 'GET' };
            },
            transformResponse: (response) => response?.data?.documents || [],
            providesTags: (result, error, arg) => [
                { type: 'ChannelDocuments', id: splitAnyScope(arg)[1] },
            ],
        }),
        uploadChannelDocument: builder.mutation({
            query: (arg) => {
                const [, { channelId, file, description }] = splitAnyScope(arg);
                const formData = new FormData();
                formData.append('file', file);
                if (description) formData.append('description', description);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/documents`),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'ChannelDocuments', id: splitAnyScope(arg)[1].channelId },
                { type: 'ChannelDocuments', id: 'MINE' },
                { type: 'ChannelTimeline', id: splitAnyScope(arg)[1].channelId },
            ],
        }),
        // Returns a short-lived presigned URL for one document.
        // A GET, modelled as a mutation because it's fired on click rather than
        // on render. Scoped like the reads above — Operations can open a file
        // already shared in the thread, it just can't add one.
        getChannelDocumentUrl: builder.mutation({
            query: (arg) => {
                const [, { channelId, docId }] = splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/documents/${docId}/download`),
                    method: 'GET',
                };
            },
            transformResponse: (response) => response?.data || {},
        }),

        // ── Forms ────────────────────────────────────────────────────
        getChannelForms: builder.query({
            query: (arg) => {
                const [, channelId] = splitAnyScope(arg);
                return { url: channelUrl(arg, `/channels/${channelId}/forms`), method: 'GET' };
            },
            transformResponse: (response) => response?.data?.forms || [],
            providesTags: (result, error, arg) => [
                { type: 'ChannelForms', id: splitAnyScope(arg)[1] },
            ],
        }),
        submitChannelForm: builder.mutation({
            query: (arg) => {
                const [, { channelId, form_key, answers, schema_version }] =
                    splitAnyScope(arg);
                return {
                    url: channelUrl(arg, `/channels/${channelId}/forms`),
                    method: 'POST',
                    data: { form_key, answers, schema_version },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'ChannelForms', id: splitAnyScope(arg)[1].channelId },
                { type: 'ChannelTimeline', id: splitAnyScope(arg)[1].channelId },
            ],
        }),

        // ── Timeline (audit trail) ───────────────────────────────────
        getChannelTimeline: builder.query({
            query: (arg) => {
                const [, channelId] = splitAnyScope(arg);
                return { url: channelUrl(arg, `/channels/${channelId}/timeline`), method: 'GET' };
            },
            transformResponse: (response) => response?.data?.events || [],
            providesTags: (result, error, arg) => [
                { type: 'ChannelTimeline', id: splitAnyScope(arg)[1] },
            ],
        }),

        // ── Vendor holding / onboarding chats (admin side) ──
        getHeldVendors: builder.query({
            query: () => ({ url: '/api/admin/holding-channels', method: 'GET' }),
            transformResponse: (res) => res?.data?.vendors || [],
            providesTags: ['HeldVendors'],
        }),
        openHoldingChannel: builder.mutation({
            // A held doctor opens by doctor_id; every other vertical (clinic /
            // hospital / corporate / patient) opens by user_id.
            query: ({ doctor_id, user_id }) => ({
                url: doctor_id
                    ? `/api/admin/holding-channels/${doctor_id}/open`
                    : `/api/admin/holding-channels/user/${user_id}/open`,
                method: 'POST',
            }),
            transformResponse: (res) => res?.data || {},
            invalidatesTags: ['HeldVendors'],
        }),
    }),
});

export const {
    useGetServiceCommunicationConfigQuery,
    useUpsertServiceCommunicationConfigMutation,
    useActivatePurchasedServiceMutation,
    useActivateGroupPurchaseMutation,
    useListMyServiceChannelsQuery,
    useGetServiceChannelQuery,
    useGetHoldingAccountStateQuery,
    useGetChannelMessagesQuery,
    useSendChannelMessageMutation,
    useMarkChannelReadMutation,
    useGetChannelCallsQuery,
    useScheduleChannelCallMutation,
    useProposeChannelCallMutation,
    useCallActionMutation,
    useGetMyDocumentsQuery,
    useGetChannelDocumentsQuery,
    useUploadChannelDocumentMutation,
    useGetChannelDocumentUrlMutation,
    useGetChannelFormsQuery,
    useSubmitChannelFormMutation,
    useGetChannelTimelineQuery,
    useGetHeldVendorsQuery,
    useOpenHoldingChannelMutation,
} = serviceCommunicationEndpoints;

export default serviceCommunicationEndpoints;
