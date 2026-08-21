/**
 * Scope-aware re-exports of the doctor-side RTK-Query hooks.
 *
 * The doctor sections that use RTK Query import their hooks from here instead
 * of straight from ``doctorEndpoints`` / ``doctorApprovalsEndpoints`` /
 * ``doctorAttendanceEndpoints``. The wrapper reads the active
 * {@link useDoctorScope} and folds the target doctor id into the arg, so:
 *
 *   * a doctor on their own pages gets the unchanged behaviour (no scope →
 *     arg passes through untouched → same URLs, same cache keys);
 *   * a super-admin in Operations gets the same components pointed at
 *     ``/api/admin/operations/doctor-members/<id>/act/...`` with per-doctor
 *     cache entries.
 *
 * Call signatures are identical to the generated hooks, so switching a section
 * over is a one-line import change and nothing else.
 *
 * Only the endpoints that resolve the doctor from ``current_user`` are here.
 * The doctor-analytics, field-approval and attendance-metrics reads the same
 * tabs make already take the doctor as a path parameter and already allow
 * admins, so they're called directly as the admin — they just need to be given
 * the right id, which is what {@link useGetMyDoctorIdQuery} below is for.
 */
import { useDoctorScope } from '../ProfileSetting/context/DoctorScopeContext';
import { scopedQuery, scopedMutation } from './scopedHooks';

import {
    useGetDoctorSymptomsQuery as _useGetDoctorSymptomsQuery,
    useGetAvailableSymptomsQuery as _useGetAvailableSymptomsQuery,
    useUpdateDoctorSymptomsMutation as _useUpdateDoctorSymptomsMutation,
    useGetAppointmentPatientContextQuery as _useGetAppointmentPatientContextQuery,
    useUpdatePatientVitalsMutation as _useUpdatePatientVitalsMutation,
    useGetAppointmentSettingsQuery as _useGetAppointmentSettingsQuery,
    useUpdateAppointmentSettingsMutation as _useUpdateAppointmentSettingsMutation,
    useGetDoctorAppointmentsQuery as _useGetDoctorAppointmentsQuery,
    useGetAppointmentByIdQuery as _useGetAppointmentByIdQuery,
    useGetDoctorProductsQuery as _useGetDoctorProductsQuery,
    useGetDoctorPrescriptionsQuery as _useGetDoctorPrescriptionsQuery,
    useGetDoctorPrescriptionQuery as _useGetDoctorPrescriptionQuery,
    useGetDoctorPrescriptionSummaryQuery as _useGetDoctorPrescriptionSummaryQuery,
    useGetAppointmentsPendingPrescriptionsQuery
        as _useGetAppointmentsPendingPrescriptionsQuery,
    useGetDoctorDocumentsQuery as _useGetDoctorDocumentsQuery,
    useGetDoctorDocumentQuery as _useGetDoctorDocumentQuery,
    useGetDoctorDocumentSummaryQuery as _useGetDoctorDocumentSummaryQuery,
    useGetOrdersPendingDocumentsQuery as _useGetOrdersPendingDocumentsQuery,
    useGetDoctorOrderQuery as _useGetDoctorOrderQuery,
    useSavePrescriptionMutation as _useSavePrescriptionMutation,
    useUpdatePrescriptionMutation as _useUpdatePrescriptionMutation,
    useDeletePrescriptionMutation as _useDeletePrescriptionMutation,
    useRevisePrescriptionMutation as _useRevisePrescriptionMutation,
    useSearchMedicinesQuery as _useSearchMedicinesQuery,
    useCheckBannedQuery as _useCheckBannedQuery,
    useSaveDocumentMutation as _useSaveDocumentMutation,
    useUploadDocumentMutation as _useUploadDocumentMutation,
    useUpdateDocumentMutation as _useUpdateDocumentMutation,
    useDeleteDocumentMutation as _useDeleteDocumentMutation,
    useReviseDocumentMutation as _useReviseDocumentMutation,
    useUploadDocumentAttachmentMutation as _useUploadDocumentAttachmentMutation,
    useDeleteDocumentAttachmentMutation as _useDeleteDocumentAttachmentMutation,
    useAddFieldAttachmentMutation as _useAddFieldAttachmentMutation,
    useDeleteFieldAttachmentMutation as _useDeleteFieldAttachmentMutation,
} from './doctorEndpoints';

import {
    useListMyServiceChannelsQuery as _useListMyServiceChannelsQuery,
    useGetServiceChannelQuery as _useGetServiceChannelQuery,
    useGetChannelMessagesQuery as _useGetChannelMessagesQuery,
    useGetChannelCallsQuery as _useGetChannelCallsQuery,
    useGetChannelDocumentsQuery as _useGetChannelDocumentsQuery,
    useGetChannelTimelineQuery as _useGetChannelTimelineQuery,
    useGetChannelDocumentUrlMutation as _useGetChannelDocumentUrlMutation,
    useSendChannelMessageMutation as _useSendChannelMessageMutation,
    useMarkChannelReadMutation as _useMarkChannelReadMutation,
    useScheduleChannelCallMutation as _useScheduleChannelCallMutation,
    useProposeChannelCallMutation as _useProposeChannelCallMutation,
    useCallActionMutation as _useCallActionMutation,
    useUploadChannelDocumentMutation as _useUploadChannelDocumentMutation,
} from '../../admin/api/serviceCommunicationEndpoints';

import {
    useGetDoctorMarketplaceProductsQuery as _useGetDoctorMarketplaceProductsQuery,
    useSelectMarketplaceProductMutation as _useSelectMarketplaceProductMutation,
    useUpdateMarketplaceProductMutation as _useUpdateMarketplaceProductMutation,
    useRemoveMarketplaceProductMutation as _useRemoveMarketplaceProductMutation,
    useGetServiceGroupsQuery as _useGetServiceGroupsQuery,
    useCreateServiceGroupMutation as _useCreateServiceGroupMutation,
    useUpdateServiceGroupMutation as _useUpdateServiceGroupMutation,
    useDeleteServiceGroupMutation as _useDeleteServiceGroupMutation,
    useGetGroupInvitationsQuery as _useGetGroupInvitationsQuery,
    useRespondGroupInviteMutation as _useRespondGroupInviteMutation,
    useGetDoctorMarketplaceSalesQuery as _useGetDoctorMarketplaceSalesQuery,
    useUpdateMarketplaceOrderMutation as _useUpdateMarketplaceOrderMutation,
    useGetIncomingPlanBookingsQuery as _useGetIncomingPlanBookingsQuery,
    useAcceptPlanBookingMutation as _useAcceptPlanBookingMutation,
    useRejectPlanBookingMutation as _useRejectPlanBookingMutation,
} from '../../marketplace/api/marketplaceApi';

import {
    useGetNetworkConnectionsQuery as _useGetNetworkConnectionsQuery,
} from '../MyNetwork/api/networkEndpoints';

import {
    useGetSlotVisibilityQuery as _useGetSlotVisibilityQuery,
    useSubmitSlotVisibilityMutation as _useSubmitSlotVisibilityMutation,
} from '../../admin/api/doctorApprovalsEndpoints';

import {
    useVerifyAppointmentMutation as _useVerifyAppointmentMutation,
} from '../../admin/api/doctorAttendanceEndpoints';

import {
    useGetMyDoctorIdQuery as _useGetMyDoctorIdQuery,
} from '../../admin/api/doctorAnalyticsEndpoints';

// ── Treatable Symptoms tab ──
export const useGetDoctorSymptomsQuery = scopedQuery(_useGetDoctorSymptomsQuery);
export const useGetAvailableSymptomsQuery = scopedQuery(_useGetAvailableSymptomsQuery);
export const useUpdateDoctorSymptomsMutation = scopedMutation(_useUpdateDoctorSymptomsMutation);

// ── Slot Visibility tab ──
export const useGetSlotVisibilityQuery = scopedQuery(_useGetSlotVisibilityQuery);
export const useSubmitSlotVisibilityMutation = scopedMutation(_useSubmitSlotVisibilityMutation);

// ── Appointments ──
export const useVerifyAppointmentMutation = scopedMutation(_useVerifyAppointmentMutation);
export const useGetAppointmentPatientContextQuery =
    scopedQuery(_useGetAppointmentPatientContextQuery);
export const useUpdatePatientVitalsMutation = scopedMutation(_useUpdatePatientVitalsMutation);
// The list itself — the availability calendar reads it to lock booked starts.
// (The appointments PAGE fetches through the redux thunks instead, which take
// their scope from the URL; see ./doctorScope.js.)
export const useGetDoctorAppointmentsQuery = scopedQuery(_useGetDoctorAppointmentsQuery);
// One appointment — the header of the prescription form.
export const useGetAppointmentByIdQuery = scopedQuery(_useGetAppointmentByIdQuery);

// ── "Manage Appointments / Services" → Appointments ──
export const useGetAppointmentSettingsQuery = scopedQuery(_useGetAppointmentSettingsQuery);
export const useUpdateAppointmentSettingsMutation =
    scopedMutation(_useUpdateAppointmentSettingsMutation);

// ── "Manage Appointments / Services" → Service List ──
export const useGetDoctorProductsQuery = scopedQuery(_useGetDoctorProductsQuery);
export const useGetDoctorMarketplaceProductsQuery =
    scopedQuery(_useGetDoctorMarketplaceProductsQuery);
export const useSelectMarketplaceProductMutation =
    scopedMutation(_useSelectMarketplaceProductMutation);
export const useUpdateMarketplaceProductMutation =
    scopedMutation(_useUpdateMarketplaceProductMutation);
export const useRemoveMarketplaceProductMutation =
    scopedMutation(_useRemoveMarketplaceProductMutation);

// ── "Manage Appointments / Services" → Group Offering ──
export const useGetServiceGroupsQuery = scopedQuery(_useGetServiceGroupsQuery);
export const useCreateServiceGroupMutation = scopedMutation(_useCreateServiceGroupMutation);
export const useUpdateServiceGroupMutation = scopedMutation(_useUpdateServiceGroupMutation);
export const useDeleteServiceGroupMutation = scopedMutation(_useDeleteServiceGroupMutation);
export const useGetGroupInvitationsQuery = scopedQuery(_useGetGroupInvitationsQuery);
export const useRespondGroupInviteMutation = scopedMutation(_useRespondGroupInviteMutation);
// Co-doctor picker on the group dialog.
export const useGetNetworkConnectionsQuery = scopedQuery(_useGetNetworkConnectionsQuery);

// ── "My Appointments / Service List" → Service List ──
// The tracking counterpart to the catalog block above: orders patients have
// placed against this doctor, and the accept / reject / progress decision on
// each. Unscoped these read the ADMIN's sales — an empty table, which reads as
// "this doctor has sold nothing" rather than as the wrong question.
export const useGetDoctorMarketplaceSalesQuery = scopedQuery(_useGetDoctorMarketplaceSalesQuery);
export const useUpdateMarketplaceOrderMutation =
    scopedMutation(_useUpdateMarketplaceOrderMutation);

// ── "My Appointments / Service List" → My Group Offering ──
export const useGetIncomingPlanBookingsQuery = scopedQuery(_useGetIncomingPlanBookingsQuery);
export const useAcceptPlanBookingMutation = scopedMutation(_useAcceptPlanBookingMutation);
export const useRejectPlanBookingMutation = scopedMutation(_useRejectPlanBookingMutation);

// ── "Prescriptions / Documents" ──
// Reads AND writes. Authoring, revising and publishing all run on the doctor's
// behalf here, and the patient receives a document with the doctor's name on
// it — the ops audit row is the only place the operator's hand is recorded. The
// prescription form's medicine search and banned-drug check are scoped too, not
// for identity but because the doctor blueprint is role-gated and they'd 403
// mid-compose otherwise.
export const useGetDoctorPrescriptionsQuery = scopedQuery(_useGetDoctorPrescriptionsQuery);
export const useGetDoctorPrescriptionQuery = scopedQuery(_useGetDoctorPrescriptionQuery);
export const useGetDoctorPrescriptionSummaryQuery =
    scopedQuery(_useGetDoctorPrescriptionSummaryQuery);
export const useGetAppointmentsPendingPrescriptionsQuery =
    scopedQuery(_useGetAppointmentsPendingPrescriptionsQuery);
export const useGetDoctorDocumentsQuery = scopedQuery(_useGetDoctorDocumentsQuery);
export const useGetDoctorDocumentQuery = scopedQuery(_useGetDoctorDocumentQuery);
export const useGetDoctorDocumentSummaryQuery = scopedQuery(_useGetDoctorDocumentSummaryQuery);
export const useGetOrdersPendingDocumentsQuery = scopedQuery(_useGetOrdersPendingDocumentsQuery);
export const useGetDoctorOrderQuery = scopedQuery(_useGetDoctorOrderQuery);
export const useSearchMedicinesQuery = scopedQuery(_useSearchMedicinesQuery);
export const useCheckBannedQuery = scopedQuery(_useCheckBannedQuery);
export const useSavePrescriptionMutation = scopedMutation(_useSavePrescriptionMutation);
export const useUpdatePrescriptionMutation = scopedMutation(_useUpdatePrescriptionMutation);
export const useDeletePrescriptionMutation = scopedMutation(_useDeletePrescriptionMutation);
export const useRevisePrescriptionMutation = scopedMutation(_useRevisePrescriptionMutation);
export const useSaveDocumentMutation = scopedMutation(_useSaveDocumentMutation);
export const useUploadDocumentMutation = scopedMutation(_useUploadDocumentMutation);
export const useUpdateDocumentMutation = scopedMutation(_useUpdateDocumentMutation);
export const useDeleteDocumentMutation = scopedMutation(_useDeleteDocumentMutation);
export const useReviseDocumentMutation = scopedMutation(_useReviseDocumentMutation);
export const useUploadDocumentAttachmentMutation =
    scopedMutation(_useUploadDocumentAttachmentMutation);
export const useDeleteDocumentAttachmentMutation =
    scopedMutation(_useDeleteDocumentAttachmentMutation);
export const useAddFieldAttachmentMutation = scopedMutation(_useAddFieldAttachmentMutation);
export const useDeleteFieldAttachmentMutation = scopedMutation(_useDeleteFieldAttachmentMutation);

// ── "Service Chats" ──
// Reads and writes: an operator can take part in a doctor↔patient conversation
// on the doctor's behalf. Joining a live call is the one thing left out — the
// proxy allowlist refuses ``calls/<id>/join``, so ``callAction`` below can move
// a call through its schedule but can't walk into the room.
export const useListMyServiceChannelsQuery = scopedQuery(_useListMyServiceChannelsQuery);
export const useGetServiceChannelQuery = scopedQuery(_useGetServiceChannelQuery);
export const useGetChannelMessagesQuery = scopedQuery(_useGetChannelMessagesQuery);
export const useGetChannelCallsQuery = scopedQuery(_useGetChannelCallsQuery);
export const useGetChannelDocumentsQuery = scopedQuery(_useGetChannelDocumentsQuery);
export const useGetChannelTimelineQuery = scopedQuery(_useGetChannelTimelineQuery);
// Presigned download for one file already shared in the thread. A GET the
// generated hook models as a mutation, which is why it is wrapped here as one.
export const useGetChannelDocumentUrlMutation =
    scopedMutation(_useGetChannelDocumentUrlMutation);
export const useSendChannelMessageMutation = scopedMutation(_useSendChannelMessageMutation);
export const useMarkChannelReadMutation = scopedMutation(_useMarkChannelReadMutation);
export const useScheduleChannelCallMutation = scopedMutation(_useScheduleChannelCallMutation);
export const useProposeChannelCallMutation = scopedMutation(_useProposeChannelCallMutation);
export const useCallActionMutation = scopedMutation(_useCallActionMutation);
export const useUploadChannelDocumentMutation =
    scopedMutation(_useUploadChannelDocumentMutation);

/**
 * "Which doctor is this page about?"
 *
 * For a doctor that's ``GET /api/doctor-analytics/me`` — their own id off the
 * token. In Operations the answer is already known (it's in the URL), so the
 * request is skipped and the scope's id is handed back in the same shape. That
 * matters beyond saving a round-trip: unscoped, ``/me`` would answer with the
 * ADMIN's doctor id — or 404 for an admin who isn't a doctor — and every tab
 * keyed off it (Analytics, Account Status, Attendance, the approval banner)
 * would silently render the wrong person, or nothing at all.
 */
export const useGetMyDoctorIdQuery = (arg, options) => {
    const { doctorId } = useDoctorScope();
    const result = _useGetMyDoctorIdQuery(arg, {
        ...options,
        skip: options?.skip || !!doctorId,
    });
    if (!doctorId) return result;
    return {
        ...result,
        data: doctorId,
        isLoading: false,
        isFetching: false,
        isSuccess: true,
        isError: false,
        error: undefined,
    };
};
