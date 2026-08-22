import { apiSlice } from '../../../app/api/apiSlice';
import { doctorScopedUrl, splitScope } from './doctorScope';

// NOTE: endpoint names here share ONE registry with every other
// injectEndpoints call in the app. RTK Query SILENTLY DISCARDS a
// duplicate name when overrideExisting is false, so a name also used
// in an admin endpoints file resolves to whichever module loaded
// first — the caller then hits the wrong URL with the wrong args.
// The doctor's own-data endpoints are therefore named my*, distinct
// from the admin's doctor-by-id equivalents.
const DOCTOR_URL = '/api/v1/doctor';

/**
 * Endpoints an admin can drive on a doctor's behalf from Operations read their
 * base URL from the arg's scope instead of the constant above — see
 * ./doctorScope.js. Everything else here is still doctor-only and keeps the
 * literal ``/api/v1/doctor`` prefix.
 *
 * Cache TAGS are deliberately left alone. Tags only drive refetching, and the
 * per-doctor cache separation already comes from the arg; an over-broad tag
 * costs one extra refetch, whereas a scoped tag that no longer matches an
 * existing bare invalidation elsewhere would silently stop refreshing.
 */

const doctorEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        // Vendor holding state — held (pending verification / inactive / trial
        // expired) + the admin chat channel to converse in.
        getAccountState: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/account-state`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: ['AccountStatus'],
        }),
        // Fetch Appointments with filter (scoped: the availability calendar
        // reads it to grey out already-booked starts, and that calendar is
        // mounted in Operations)
        getDoctorAppointments: builder.query({
            query: (arg = {}) => {
                const [ops, params = {}] = splitScope(arg);
                const queryParams = new URLSearchParams(params).toString();
                return {
                    url: doctorScopedUrl(ops, `/appointments?${queryParams}`),
                    method: 'GET',
                };
            },
            transformResponse: (response) => ({
                appointments: response.data?.appointments || [],
                pagination: response.data?.pagination,
            }),
            providesTags: (result) =>
                result
                    ? [
                          ...result.appointments.map(({ id }) => ({ type: 'Appointment', id })),
                          { type: 'Appointment', id: 'LIST' },
                      ]
                    : [{ type: 'Appointment', id: 'LIST' }],
        }),

        // Single appointment by ID
        // Scoped: the prescription form reads it for the appointment header,
        // and that form is mounted in Operations. Unscoped it 403s there —
        // the doctor blueprint is role-gated — and the form silently loses the
        // patient name and slot it is being written against.
        getAppointmentById: builder.query({
            query: (arg) => {
                const [ops, appointmentId] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/appointments/${appointmentId}`),
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, arg) => [
                { type: 'Appointment', id: splitScope(arg)[1] },
            ],
        }),

        // Appointment Actions
        acceptAppointment: builder.mutation({
            query: (appointmentId) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/accept`,
                method: 'POST',
            }),
            invalidatesTags: (result, error, appointmentId) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),
        rejectAppointment: builder.mutation({
            query: ({ appointmentId, reason }) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/reject`,
                method: 'POST',
                data: { reason },
            }),
            invalidatesTags: (result, error, { appointmentId }) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),
        completeAppointment: builder.mutation({
            query: (appointmentId) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/complete`,
                method: 'POST',
            }),
            invalidatesTags: (result, error, appointmentId) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),

        // Prescription
        createPrescription: builder.mutation({
            query: ({ appointmentId, data }) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/prescription`,
                method: 'POST',
                data,
            }),
            // Creating a prescription also completes the appointment usually
            invalidatesTags: (result, error, { appointmentId }) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),

        // ────── Marketplace ──────

        // The catalog this doctor may sell from. Tenant-wide rows, but filtered
        // by the doctor's own specialization — so it has to be scoped, or the
        // Operations "Add to My Store" dialog lists the admin's (empty) set.
        getDoctorProducts: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/products'), method: 'GET',
            }),
            transformResponse: (res) => res.data?.products || res.products || [],
            providesTags: [{ type: 'Product', id: 'LIST' }],
        }),

        // Per-consultation-type audience targeting (Slot Visibility tab).
        // The whole map travels in ONE call — the UI batches per-type edits.
        getConsultationTargeting: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/consultation-targeting`, method: 'GET' }),
            transformResponse: (res) => res?.data?.targeting_by_type || {},
            providesTags: [{ type: 'Doctor', id: 'CONSULT_TARGETING' }],
        }),
        updateConsultationTargeting: builder.mutation({
            query: (targeting_by_type) => ({
                url: `${DOCTOR_URL}/consultation-targeting`, method: 'PUT',
                data: { targeting_by_type },
            }),
            invalidatesTags: [{ type: 'Doctor', id: 'CONSULT_TARGETING' }],
        }),
        // Active product categories — options for the targeting form.
        getDoctorProductCategories: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/product-categories`, method: 'GET' }),
            transformResponse: (res) => res?.data?.product_categories || [],
        }),

        // Register interest in a catalog service / group plan (doctors don't
        // create group offerings — an admin assigns the plan).
        expressServiceInterest: builder.mutation({
            query: ({ product_id, note }) => ({
                url: `${DOCTOR_URL}/service-interest`, method: 'POST', data: { product_id, note },
            }),
            invalidatesTags: [{ type: 'ServiceInterest', id: 'MINE' }],
        }),
        // Product ids the doctor has already registered interest in (avoid dupes).
        getMyServiceInterests: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/service-interest`, method: 'GET' }),
            transformResponse: (res) => res.data?.product_ids || [],
            providesTags: [{ type: 'ServiceInterest', id: 'MINE' }],
        }),
        // Landing features an admin linked to a catalog product (feature-product linking).
        getProductFeatures: builder.query({
            query: (productId) => ({ url: `${DOCTOR_URL}/products/${productId}/features`, method: 'GET' }),
            transformResponse: (res) => res.data?.features || [],
        }),

        attachAppointmentProduct: builder.mutation({
            query: ({ appointmentId, product_id, doctor_price, doctor_description }) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/product`,
                method: 'POST',
                data: { product_id, doctor_price, doctor_description },
            }),
            invalidatesTags: (res, err, { appointmentId }) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),

        updateAppointmentProduct: builder.mutation({
            query: ({ appointmentId, doctor_price, doctor_description }) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/product`,
                method: 'PUT',
                data: { doctor_price, doctor_description },
            }),
            invalidatesTags: (res, err, { appointmentId }) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),

        completeAppointmentProduct: builder.mutation({
            query: (appointmentId) => ({
                url: `${DOCTOR_URL}/appointments/${appointmentId}/product/complete`,
                method: 'POST',
            }),
            invalidatesTags: (res, err, appointmentId) => [
                { type: 'Appointment', id: appointmentId },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),

        // ── Patient Medical Context for Appointment ── (scoped)
        getAppointmentPatientContext: builder.query({
            query: (arg) => {
                const [ops, appointmentId] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/appointments/${appointmentId}/patient-context`),
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, arg) => [
                { type: 'Appointment', id: `context-${splitScope(arg)[1]}` },
            ],
        }),

        // ── Prescriptions ──
        // The four READS below are scoped — Operations mounts the doctor's
        // "Prescriptions / Documents" hub. The writes beside them are not, and
        // the proxy allowlist doesn't carry them either: authoring a
        // prescription in a doctor's name isn't a support operation.
        getDoctorPrescriptions: builder.query({
            query: (arg = {}) => {
                const [ops, params = {}] = splitScope(arg);
                const qs = new URLSearchParams(params).toString();
                return { url: doctorScopedUrl(ops, `/prescriptions?${qs}`), method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result) =>
                result?.prescriptions
                    ? [
                          ...result.prescriptions.map(({ id }) => ({ type: 'Prescription', id })),
                          { type: 'Prescription', id: 'LIST' },
                      ]
                    : [{ type: 'Prescription', id: 'LIST' }],
        }),
        getDoctorPrescription: builder.query({
            query: (arg) => {
                const [ops, id] = splitScope(arg);
                return { url: doctorScopedUrl(ops, `/prescriptions/${id}`), method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, arg) => [
                { type: 'Prescription', id: splitScope(arg)[1] },
            ],
        }),
        savePrescription: builder.mutation({
            query: (arg) => {
                const [ops, { appointmentId, ...data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/appointments/${appointmentId}/prescription`),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Prescription', id: 'LIST' },
                { type: 'Appointment', id: splitScope(arg)[1].appointmentId },
                { type: 'Appointment', id: 'LIST' },
                { type: 'Appointment', id: 'PENDING_RX' },
            ],
        }),
        updatePrescription: builder.mutation({
            query: (arg) => {
                const [ops, { prescriptionId, ...data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/prescriptions/${prescriptionId}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Prescription', id: splitScope(arg)[1].prescriptionId },
                { type: 'Prescription', id: 'LIST' },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),
        deletePrescription: builder.mutation({
            query: (arg) => {
                const [ops, id] = splitScope(arg);
                return { url: doctorScopedUrl(ops, `/prescriptions/${id}`), method: 'DELETE' };
            },
            invalidatesTags: [{ type: 'Prescription', id: 'LIST' }],
        }),
        revisePrescription: builder.mutation({
            query: (arg) => {
                const [ops, { prescriptionId, ...data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/prescriptions/${prescriptionId}/revise`),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: [
                { type: 'Prescription', id: 'LIST' },
                { type: 'Appointment', id: 'PENDING_RX' },
            ],
        }),
        // Scoped only because the doctor blueprint is role-gated: called
        // unproxied by an admin these 403 and the form silently loses its
        // medicine search and its banned-drug check mid-compose.
        searchMedicines: builder.query({
            query: (arg) => {
                const [ops, q] = splitScope(arg);
                return {
                    url: doctorScopedUrl(
                        ops, `/medicines/search?q=${encodeURIComponent(q)}&limit=15`),
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data?.medicines || [],
        }),
        checkBanned: builder.query({
            query: (arg) => {
                const [ops, name] = splitScope(arg);
                return {
                    url: doctorScopedUrl(
                        ops, `/banned-check?generic_name=${encodeURIComponent(name)}`),
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
        }),

        // ── Appointments pending prescription ── (scoped)
        getAppointmentsPendingPrescriptions: builder.query({
            query: (arg = {}) => {
                const [ops, params = {}] = splitScope(arg);
                const qs = new URLSearchParams(params).toString();
                return {
                    url: doctorScopedUrl(ops, `/appointments/pending-prescriptions?${qs}`),
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Appointment', id: 'PENDING_RX' }],
        }),

        // ── Documents ──
        // Same lifecycle as prescriptions (draft → pending_approval →
        // approved → active, plus revise) but attached to a purchased
        // service (marketplace order), not an appointment. See
        // MyDocumentsPage / backend document_routes.py.
        // Reads scoped for the same reason as the prescription ones above.
        getMyDoctorDocuments: builder.query({
            query: (arg = {}) => {
                const [ops, params = {}] = splitScope(arg);
                const qs = new URLSearchParams(params).toString();
                return { url: doctorScopedUrl(ops, `/documents?${qs}`), method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result) =>
                result?.documents
                    ? [
                          ...result.documents.map(({ id }) => ({ type: 'Document', id })),
                          { type: 'Document', id: 'LIST' },
                      ]
                    : [{ type: 'Document', id: 'LIST' }],
        }),
        getDoctorDocument: builder.query({
            query: (arg) => {
                const [ops, id] = splitScope(arg);
                return { url: doctorScopedUrl(ops, `/documents/${id}`), method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, arg) => [
                { type: 'Document', id: splitScope(arg)[1] },
            ],
        }),
        saveDocument: builder.mutation({
            query: (arg) => {
                const [ops, { orderId, ...data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/orders/${orderId}/document`),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: 'LIST' },
                { type: 'Document', id: `order-${splitScope(arg)[1].orderId}` },
                { type: 'Document', id: 'PENDING_ORDERS' },
            ],
        }),
        // Manual PDF upload — the only difference from saveDocument is that the
        // doctor supplies a ready PDF instead of clinical form fields. Creates
        // a DRAFT that follows the same submit → approve → push lifecycle.
        uploadDocument: builder.mutation({
            query: (arg) => {
                const [ops, { orderId, file, title }] = splitScope(arg);
                const formData = new FormData();
                formData.append('file', file);
                if (title) formData.append('title', title);
                return {
                    url: doctorScopedUrl(ops, `/orders/${orderId}/document/upload`),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: 'LIST' },
                { type: 'Document', id: `order-${splitScope(arg)[1].orderId}` },
                { type: 'Document', id: 'PENDING_ORDERS' },
            ],
        }),
        // Group-offering completion document — same DoctorDocument model +
        // lifecycle as a service-order document, just owned by a plan booking.
        uploadBookingDocument: builder.mutation({
            query: ({ bookingId, file, title }) => {
                const formData = new FormData();
                formData.append('file', file);
                if (title) formData.append('title', title);
                return {
                    url: `${DOCTOR_URL}/group-offering-bookings/${bookingId}/document/upload`,
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: [
                { type: 'Document', id: 'LIST' },
                'PlanBooking',
            ],
        }),
        updateDocument: builder.mutation({
            query: (arg) => {
                const [ops, { documentId, ...data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/documents/${documentId}`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: splitScope(arg)[1].documentId },
                { type: 'Document', id: 'LIST' },
                'PlanBooking',
            ],
        }),
        // The document's one optional supporting file. Separate from
        // uploadDocument: that PDF *is* the document, this rides alongside
        // generated content. Needs an existing document id, so the form
        // saves first and uploads after.
        uploadDocumentAttachment: builder.mutation({
            query: (arg) => {
                const [ops, { documentId, file }] = splitScope(arg);
                const formData = new FormData();
                formData.append('file', file);
                return {
                    url: doctorScopedUrl(ops, `/documents/${documentId}/attachment`),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: splitScope(arg)[1].documentId },
                { type: 'Document', id: 'LIST' },
            ],
        }),
        deleteDocumentAttachment: builder.mutation({
            query: (arg) => {
                const [ops, { documentId }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/documents/${documentId}/attachment`),
                    method: 'DELETE',
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: splitScope(arg)[1].documentId },
                { type: 'Document', id: 'LIST' },
            ],
        }),
        // Per-field attachments. Unlike the document-wide slot above these
        // are a list, so POST appends and DELETE targets one file by id.
        // The field must already be saved on the document — the form
        // therefore saves first, then uploads whatever was staged.
        addFieldAttachment: builder.mutation({
            query: (arg) => {
                const [ops, { documentId, fieldId, file }] = splitScope(arg);
                const formData = new FormData();
                formData.append('file', file);
                return {
                    url: doctorScopedUrl(
                        ops, `/documents/${documentId}/fields/${fieldId}/attachment`),
                    method: 'POST',
                    data: formData,
                    headers: { 'Content-Type': 'multipart/form-data' },
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: splitScope(arg)[1].documentId },
            ],
        }),
        deleteFieldAttachment: builder.mutation({
            query: (arg) => {
                const [ops, { documentId, fieldId, attachmentId }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(
                        ops,
                        `/documents/${documentId}/fields/${fieldId}/attachment/${attachmentId}`),
                    method: 'DELETE',
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Document', id: splitScope(arg)[1].documentId },
            ],
        }),
        deleteDocument: builder.mutation({
            query: (arg) => {
                const [ops, id] = splitScope(arg);
                return { url: doctorScopedUrl(ops, `/documents/${id}`), method: 'DELETE' };
            },
            invalidatesTags: [{ type: 'Document', id: 'LIST' }],
        }),
        reviseDocument: builder.mutation({
            query: (arg) => {
                const [ops, { documentId, ...data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/documents/${documentId}/revise`),
                    method: 'POST',
                    data,
                };
            },
            invalidatesTags: [
                { type: 'Document', id: 'LIST' },
                { type: 'Document', id: 'PENDING_ORDERS' },
            ],
        }),
        // Purchased services still awaiting a document — the
        // "Pending (To Generate)" tab.
        getOrdersPendingDocuments: builder.query({
            query: (arg = {}) => {
                const [ops, params = {}] = splitScope(arg);
                const qs = new URLSearchParams(params).toString();
                return {
                    url: doctorScopedUrl(ops, `/orders/pending-documents?${qs}`),
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Document', id: 'PENDING_ORDERS' }],
        }),
        // Order header for the document form (which service, which patient).
        getDoctorOrder: builder.query({
            query: (arg) => {
                const [ops, orderId] = splitScope(arg);
                return { url: doctorScopedUrl(ops, `/orders/${orderId}`), method: 'GET' };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, arg) => [
                { type: 'Document', id: `order-${splitScope(arg)[1]}` },
            ],
        }),
        getDoctorDocumentSummary: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/documents/summary'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data || {},
            providesTags: [
                { type: 'Document', id: 'LIST' },
                { type: 'Document', id: 'PENDING_ORDERS' },
            ],
        }),

        // ── Treatable Symptoms ── (scoped: Operations mounts this tab)
        getDoctorSymptoms: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/symptoms'), method: 'GET',
            }),
            transformResponse: (response) => response?.data?.symptoms || [],
            providesTags: ['DoctorSymptoms'],
        }),
        getAvailableSymptoms: builder.query({
            // The tenant's symptom catalogue rather than the doctor's picks,
            // but it's routed through the scope anyway: the patient-side
            // equivalents showed that a lone unscoped read inside an otherwise
            // proxied tab is the one that 403s and looks like a bug.
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/symptoms/available'),
                method: 'GET',
            }),
            transformResponse: (response) => ({
                symptoms: response?.data?.symptoms || [],
                categories: response?.data?.categories || [],
            }),
        }),
        updateDoctorSymptoms: builder.mutation({
            query: (arg) => {
                const [ops, symptom_ids] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, '/symptoms'),
                    method: 'PUT',
                    data: { symptom_ids },
                };
            },
            invalidatesTags: ['DoctorSymptoms'],
        }),

        // ── Prescription Template Config ──
        getMyPrescriptionTemplate: builder.query({
            query: () => ({ url: '/api/v1/admin/prescription-config/template', method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: ['PrescriptionTemplate'],
        }),

        // ── Follow-Up ──
        initiateFollowUp: builder.mutation({
            query: ({ prescriptionId, ...data }) => ({
                url: `${DOCTOR_URL}/prescriptions/${prescriptionId}/follow-up`,
                method: 'POST',
                data,
            }),
            invalidatesTags: [
                { type: 'Prescription', id: 'LIST' },
                { type: 'Appointment', id: 'LIST' },
            ],
        }),
        getDoctorOwnSlots: builder.query({
            query: ({ doctorId, date, consultationType }) => ({
                url: `${DOCTOR_URL}/${doctorId}/slots`,
                method: 'GET',
                params: { date, consultation_type: consultationType },
            }),
            transformResponse: (res) => res.data?.slots || [],
        }),
        getDoctorOwnSlotSummary: builder.query({
            query: ({ doctorId, month, consultationType }) => ({
                url: `${DOCTOR_URL}/${doctorId}/slot-summary`,
                method: 'GET',
                params: { month, ...(consultationType && { consultation_type: consultationType }) },
            }),
            transformResponse: (res) => res.data || {},
        }),

        // Update patient vitals during consultation (scoped)
        updatePatientVitals: builder.mutation({
            query: (arg) => {
                const [ops, { appointmentId, data }] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, `/appointments/${appointmentId}/patient-vitals`),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: (result, error, arg) => [
                { type: 'Appointment', id: splitScope(arg)[1].appointmentId },
            ],
        }),

        // Billing
        getMyBilling: builder.query({
            query: (params = {}) => {
                const queryParams = new URLSearchParams(params).toString();
                return {
                    url: `${DOCTOR_URL}/billing?${queryParams}`,
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Billing', id: 'LIST' }],
        }),

        // Payouts
        getMyPayouts: builder.query({
            query: (params = {}) => {
                const queryParams = new URLSearchParams(params).toString();
                return {
                    url: `${DOCTOR_URL}/payouts?${queryParams}`,
                    method: 'GET',
                };
            },
            transformResponse: (res) => res.data || {},
            providesTags: (result) =>
                result?.payouts
                    ? [
                          ...result.payouts.map(({ id }) => ({ type: 'Payout', id })),
                          { type: 'Payout', id: 'LIST' },
                      ]
                    : [{ type: 'Payout', id: 'LIST' }],
        }),

        getPayoutBill: builder.query({
            query: (payoutId) => ({
                url: `${DOCTOR_URL}/payouts/${payoutId}/bill`,
                method: 'GET',
            }),
            transformResponse: (res) => res.data || {},
            providesTags: (result, error, payoutId) => [{ type: 'Payout', id: payoutId }],
        }),

        getPayoutBillPdf: builder.query({
            query: (payoutId) => ({
                url: `${DOCTOR_URL}/payouts/${payoutId}/bill-pdf`,
                method: 'GET',
            }),
            transformResponse: (res) => res.data || {},
        }),

        // Collect a released (CLAIMABLE) payout. This IS the release — it sends the
        // money to the doctor's verified bank via Cashfree. No admin step follows.
        claimPayout: builder.mutation({
            query: (payoutId) => ({
                url: `${DOCTOR_URL}/payouts/${payoutId}/claim`,
                method: 'POST',
            }),
            invalidatesTags: [{ type: 'Payout', id: 'LIST' }],
        }),
        claimAllPayouts: builder.mutation({
            query: () => ({ url: `${DOCTOR_URL}/payouts/claim-all`, method: 'POST' }),
            invalidatesTags: [{ type: 'Payout', id: 'LIST' }],
        }),

        // Doctor's own auto-receive preference (autopay | claim).
        getPayoutPreference: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/payouts/preference`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Payout', id: 'PREFERENCE' }],
        }),
        setPayoutPreference: builder.mutation({
            query: (payout_mode) => ({
                url: `${DOCTOR_URL}/payouts/preference`,
                method: 'PUT',
                data: { payout_mode },
            }),
            invalidatesTags: [{ type: 'Payout', id: 'PREFERENCE' }, { type: 'Payout', id: 'LIST' }],
        }),

        // Salary / retainer payouts (employee / consultant doctors).
        getDoctorSalaryPayouts: builder.query({
            query: () => ({ url: `${DOCTOR_URL}/salary-payouts`, method: 'GET' }),
            transformResponse: (res) => res.data?.salary_payouts || [],
            providesTags: ['SalaryPayout'],
        }),

        // Prescription progress summary — drives the My Prescriptions
        // progress bar (pending-to-write + yet-to-publish counts).
        getDoctorPrescriptionSummary: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/prescriptions/summary'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data || {},
            providesTags: [
                { type: 'Prescription', id: 'LIST' },
                { type: 'Appointment', id: 'PENDING_RX' },
            ],
        }),

        // Item 3B — appointments master switch + offered consultation types.
        // (scoped: the Manage page it lives on is mounted in Operations)
        getAppointmentSettings: builder.query({
            query: (arg) => ({
                url: doctorScopedUrl(splitScope(arg)[0], '/appointment-settings'),
                method: 'GET',
            }),
            transformResponse: (res) => res.data || {},
            providesTags: [{ type: 'Doctor', id: 'APPT_SETTINGS' }],
        }),
        updateAppointmentSettings: builder.mutation({
            query: (arg) => {
                const [ops, data] = splitScope(arg);
                return {
                    url: doctorScopedUrl(ops, '/appointment-settings'),
                    method: 'PUT',
                    data,
                };
            },
            invalidatesTags: [{ type: 'Doctor', id: 'APPT_SETTINGS' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetAccountStateQuery,
    useGetAppointmentSettingsQuery,
    useUpdateAppointmentSettingsMutation,
    useGetDoctorAppointmentsQuery,
    useGetAppointmentByIdQuery,
    useAcceptAppointmentMutation,
    useRejectAppointmentMutation,
    useCompleteAppointmentMutation,
    useCreatePrescriptionMutation,
    useGetAppointmentPatientContextQuery,
    useGetDoctorProductsQuery,
    useExpressServiceInterestMutation,
    useGetConsultationTargetingQuery,
    useUpdateConsultationTargetingMutation,
    useGetDoctorProductCategoriesQuery,
    useGetMyServiceInterestsQuery,
    useGetProductFeaturesQuery,
    useAttachAppointmentProductMutation,
    useUpdateAppointmentProductMutation,
    useCompleteAppointmentProductMutation,
    useGetAppointmentsPendingPrescriptionsQuery,
    useGetDoctorPrescriptionsQuery,
    useGetDoctorPrescriptionSummaryQuery,
    useGetDoctorPrescriptionQuery,
    useSavePrescriptionMutation,
    useUpdatePrescriptionMutation,
    useDeletePrescriptionMutation,
    useRevisePrescriptionMutation,
    useGetOrdersPendingDocumentsQuery,
    useGetDoctorOrderQuery,
    useGetMyDoctorDocumentsQuery,
    useGetDoctorDocumentSummaryQuery,
    useGetDoctorDocumentQuery,
    useSaveDocumentMutation,
    useUploadDocumentMutation,
    useUploadBookingDocumentMutation,
    useUpdateDocumentMutation,
    useUploadDocumentAttachmentMutation,
    useDeleteDocumentAttachmentMutation,
    useAddFieldAttachmentMutation,
    useDeleteFieldAttachmentMutation,
    useDeleteDocumentMutation,
    useReviseDocumentMutation,
    useSearchMedicinesQuery,
    useCheckBannedQuery,
    useGetDoctorSymptomsQuery,
    useGetAvailableSymptomsQuery,
    useUpdateDoctorSymptomsMutation,
    useGetMyPrescriptionTemplateQuery,
    useInitiateFollowUpMutation,
    useGetDoctorOwnSlotsQuery,
    useGetDoctorOwnSlotSummaryQuery,
    useGetMyBillingQuery,
    useUpdatePatientVitalsMutation,
    useGetMyPayoutsQuery,
    useGetPayoutBillQuery,
    useLazyGetPayoutBillPdfQuery,
    useClaimPayoutMutation,
    useClaimAllPayoutsMutation,
    useGetPayoutPreferenceQuery,
    useSetPayoutPreferenceMutation,
    useGetDoctorSalaryPayoutsQuery,
} = doctorEndpoints;
