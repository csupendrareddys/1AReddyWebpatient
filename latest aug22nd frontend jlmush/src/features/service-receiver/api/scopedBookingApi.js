/**
 * Scope-aware re-exports of the patient BOOKING hooks.
 *
 * Sibling of ``ProfileSetting/api/scopedPatientApi`` and the same deal: the
 * booking pages (consultation match + BookAppointment, the services
 * marketplace, health plans) import their hooks from here instead of straight
 * from the endpoint modules, so one set of components serves both
 *
 *   * a patient booking for themselves — no scope, unchanged URLs and cache
 *     keys, and the real Razorpay checkout; and
 *   * a super-admin in Operations booking on that patient's behalf — every
 *     request re-pointed at ``/api/v1/admin/operations/patients/<id>/act/...``,
 *     per-patient cache entries, and the offline settlement step in
 *     ``usePatientCheckout`` standing in for the gateway.
 *
 * Call signatures are identical to the generated hooks, so switching a page
 * over is a one-line import change.
 *
 * NOT re-exported here, on purpose: ``useCreatePaymentOrderMutation`` /
 * ``useVerifyPaymentMutation``. Those talk to Razorpay and have no
 * act-on-behalf path — an admin cannot complete someone else's checkout.
 * Anything that needs to settle money goes through ``usePatientCheckout``.
 */
import { scopedQuery, scopedMutation } from './scopedHooks';

import {
    // Doctor discovery + slots (priced per viewer, hence scoped)
    useGetDoctorsListQuery as _useGetDoctorsListQuery,
    useGetDoctorDetailQuery as _useGetDoctorDetailQuery,
    useGetDoctorSlotsQuery as _useGetDoctorSlotsQuery,
    useGetDoctorSlotSummaryQuery as _useGetDoctorSlotSummaryQuery,
    useGetDoctorAvailableConsultationTypesQuery as _useGetDoctorAvailableConsultationTypesQuery,
    useGetSlotAvailabilitySummaryQuery as _useGetSlotAvailabilitySummaryQuery,
    useSearchDoctorsByTypeQuery as _useSearchDoctorsByTypeQuery,
    useMatchDoctorsBySymptomsMutation as _useMatchDoctorsBySymptomsMutation,
    // Appointments
    useBookAppointmentMutation as _useBookAppointmentMutation,
    useCancelAppointmentMutation as _useCancelAppointmentMutation,
    useGetUpcomingOrdersQuery as _useGetUpcomingOrdersQuery,
    useGetPreviousOrdersQuery as _useGetPreviousOrdersQuery,
    useGetOrderDetailQuery as _useGetOrderDetailQuery,
    useAddOrderDocumentMutation as _useAddOrderDocumentMutation,
    useGetAppointmentPrescriptionsQuery as _useGetAppointmentPrescriptionsQuery,
    useGetFollowUpInvitesQuery as _useGetFollowUpInvitesQuery,
    useBookFollowUpMutation as _useBookFollowUpMutation,
    // Intake context (book-for + shared records)
    useCreateAppointmentContextMutation as _useCreateAppointmentContextMutation,
    useGetAppointmentContextQuery as _useGetAppointmentContextQuery,
    useUpdateAppointmentContextMutation as _useUpdateAppointmentContextMutation,
    useDeleteAppointmentContextMutation as _useDeleteAppointmentContextMutation,
    useLinkAppointmentContextMutation as _useLinkAppointmentContextMutation,
    // Pricing the buyer sees
    useGetMemberOffersQuery as _useGetMemberOffersQuery,
    useVerifyRedeemCodeMutation as _useVerifyRedeemCodeMutation,
    useGetCreditsQuery as _useGetCreditsQuery,
    useGetCreditQuoteQuery as _useGetCreditQuoteQuery,
    useGetOfferingFeaturesQuery as _useGetOfferingFeaturesQuery,
    useGetSpendingQuery as _useGetSpendingQuery,
    // Group offerings (health plans)
    useBrowseGroupOfferingsQuery as _useBrowseGroupOfferingsQuery,
    useGetGroupOfferingDetailQuery as _useGetGroupOfferingDetailQuery,
    useGetGroupOfferingTeamsQuery as _useGetGroupOfferingTeamsQuery,
    useBookGroupOfferingMutation as _useBookGroupOfferingMutation,
    useGetMyGroupOfferingBookingsQuery as _useGetMyGroupOfferingBookingsQuery,
    // Prescriptions / Documents hub — scoped so a guardian sees the MINOR's.
    useGetPatientPrescriptionsQuery as _useGetPatientPrescriptionsQuery,
    useGetPatientDocumentsQuery as _useGetPatientDocumentsQuery,
} from './patientEndpoints';

import {
    useBrowseMarketplaceQuery as _useBrowseMarketplaceQuery,
    usePurchaseMarketplaceProductMutation as _usePurchaseMarketplaceProductMutation,
    useUploadOrderAttachmentMutation as _useUploadOrderAttachmentMutation,
    useGetPatientMarketplaceOrdersQuery as _useGetPatientMarketplaceOrdersQuery,
} from '../../marketplace/api/marketplaceApi';

import {
    useListMyServiceChannelsQuery as _useListMyServiceChannelsQuery,
} from '../../admin/api/serviceCommunicationEndpoints';

// Symptom + platform catalogues are tenant-level reference data, not the
// buyer's — same treatment as the allergy master list in scopedPatientApi.
export { useGetSymptomsQuery, useGetPlatformsQuery } from './patientEndpoints';

// The "who is this booking for?" picker reads the family group, which already
// has a scoped hook on the profile side. Re-exported rather than re-wrapped so
// there is exactly one wrapped copy of it.
export { useGetHouseGroupQuery } from '../ProfileSetting/api/scopedPatientApi';

// ── Doctor discovery + slots ──
export const useGetDoctorsListQuery = scopedQuery(_useGetDoctorsListQuery);
export const useGetDoctorDetailQuery = scopedQuery(_useGetDoctorDetailQuery);
export const useGetDoctorSlotsQuery = scopedQuery(_useGetDoctorSlotsQuery);
export const useGetDoctorSlotSummaryQuery = scopedQuery(_useGetDoctorSlotSummaryQuery);
export const useGetDoctorAvailableConsultationTypesQuery =
    scopedQuery(_useGetDoctorAvailableConsultationTypesQuery);
export const useGetSlotAvailabilitySummaryQuery =
    scopedQuery(_useGetSlotAvailabilitySummaryQuery);
export const useSearchDoctorsByTypeQuery = scopedQuery(_useSearchDoctorsByTypeQuery);
export const useMatchDoctorsBySymptomsMutation =
    scopedMutation(_useMatchDoctorsBySymptomsMutation);

// ── Appointments ──
export const useBookAppointmentMutation = scopedMutation(_useBookAppointmentMutation);
export const useCancelAppointmentMutation = scopedMutation(_useCancelAppointmentMutation);
export const useGetUpcomingOrdersQuery = scopedQuery(_useGetUpcomingOrdersQuery);
export const useGetPreviousOrdersQuery = scopedQuery(_useGetPreviousOrdersQuery);
export const useGetOrderDetailQuery = scopedQuery(_useGetOrderDetailQuery);
export const useAddOrderDocumentMutation = scopedMutation(_useAddOrderDocumentMutation);
export const useGetAppointmentPrescriptionsQuery =
    scopedQuery(_useGetAppointmentPrescriptionsQuery);
export const useGetFollowUpInvitesQuery = scopedQuery(_useGetFollowUpInvitesQuery);
export const useBookFollowUpMutation = scopedMutation(_useBookFollowUpMutation);

// ── Intake context ──
export const useCreateAppointmentContextMutation =
    scopedMutation(_useCreateAppointmentContextMutation);
export const useGetAppointmentContextQuery = scopedQuery(_useGetAppointmentContextQuery);
export const useUpdateAppointmentContextMutation =
    scopedMutation(_useUpdateAppointmentContextMutation);
export const useDeleteAppointmentContextMutation =
    scopedMutation(_useDeleteAppointmentContextMutation);
export const useLinkAppointmentContextMutation =
    scopedMutation(_useLinkAppointmentContextMutation);

// ── What this buyer pays ──
export const useGetMemberOffersQuery = scopedQuery(_useGetMemberOffersQuery);
export const useVerifyRedeemCodeMutation = scopedMutation(_useVerifyRedeemCodeMutation);
export const useGetCreditsQuery = scopedQuery(_useGetCreditsQuery);
export const useGetCreditQuoteQuery = scopedQuery(_useGetCreditQuoteQuery);
export const useGetOfferingFeaturesQuery = scopedQuery(_useGetOfferingFeaturesQuery);
export const useGetSpendingQuery = scopedQuery(_useGetSpendingQuery);

// ── Services / products ──
export const useBrowseMarketplaceQuery = scopedQuery(_useBrowseMarketplaceQuery);
export const usePurchaseMarketplaceProductMutation =
    scopedMutation(_usePurchaseMarketplaceProductMutation);
export const useUploadOrderAttachmentMutation =
    scopedMutation(_useUploadOrderAttachmentMutation);
export const useGetPatientMarketplaceOrdersQuery =
    scopedQuery(_useGetPatientMarketplaceOrdersQuery);

// ── Group offerings (health plans) ──
export const useBrowseGroupOfferingsQuery = scopedQuery(_useBrowseGroupOfferingsQuery);
export const useGetGroupOfferingDetailQuery = scopedQuery(_useGetGroupOfferingDetailQuery);
export const useGetGroupOfferingTeamsQuery = scopedQuery(_useGetGroupOfferingTeamsQuery);
export const useBookGroupOfferingMutation = scopedMutation(_useBookGroupOfferingMutation);
export const useGetMyGroupOfferingBookingsQuery =
    scopedQuery(_useGetMyGroupOfferingBookingsQuery);

// ── Open service channels ──
export const useListMyServiceChannelsQuery = scopedQuery(_useListMyServiceChannelsQuery);

// ── Prescriptions / Documents ──
export const useGetPatientPrescriptionsQuery = scopedQuery(_useGetPatientPrescriptionsQuery);
export const useGetPatientDocumentsQuery = scopedQuery(_useGetPatientDocumentsQuery);
