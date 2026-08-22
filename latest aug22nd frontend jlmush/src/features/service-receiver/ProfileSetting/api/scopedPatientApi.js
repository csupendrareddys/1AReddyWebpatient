/**
 * Scope-aware re-exports of the patient profile hooks.
 *
 * Every ProfileSetting section imports its hooks from here instead of straight
 * from ``patientEndpoints`` / ``patientHealthEndpoints`` / ``entityProfileEndpoints``.
 * The wrapper reads the active {@link usePatientScope} and folds the target
 * patient id into the RTK-Query arg, so:
 *
 *   * a patient on their own settings page gets the unchanged behaviour
 *     (no scope → arg passes through untouched → same URLs, same cache keys);
 *   * a super-admin in Operations gets the same components pointed at
 *     ``/api/v1/admin/operations/patients/<id>/act/...`` with per-patient cache
 *     entries and tags.
 *
 * Call signatures are identical to the generated hooks, so switching a section
 * over is a one-line import change and nothing else.
 */
import { scopedQuery, scopedMutation } from '../../api/scopedHooks';

import {
    useGetProfileLastUpdateQuery as _useGetProfileLastUpdateQuery,
    useGetProfileSectionUpdatesQuery as _useGetProfileSectionUpdatesQuery,
    useGetPersonalDetailsQuery as _useGetPersonalDetailsQuery,
    useUpdatePersonalDetailsMutation as _useUpdatePersonalDetailsMutation,
    useGetContactIdentityQuery as _useGetContactIdentityQuery,
    useUpdateContactIdentityMutation as _useUpdateContactIdentityMutation,
    useGetAddressQuery as _useGetAddressQuery,
    useUpdateAddressMutation as _useUpdateAddressMutation,
    useGetEmergencyContactQuery as _useGetEmergencyContactQuery,
    useUpdateEmergencyContactMutation as _useUpdateEmergencyContactMutation,
    useGetInsuranceQuery as _useGetInsuranceQuery,
    useUpdateInsuranceMutation as _useUpdateInsuranceMutation,
    useGetFemaleHealthQuery as _useGetFemaleHealthQuery,
    useUpdateFemaleHealthMutation as _useUpdateFemaleHealthMutation,
    useGetHouseGroupQuery as _useGetHouseGroupQuery,
    useAddHouseGroupMemberMutation as _useAddHouseGroupMemberMutation,
    useUpdateHouseGroupMemberMutation as _useUpdateHouseGroupMemberMutation,
    useDeleteHouseGroupMemberMutation as _useDeleteHouseGroupMemberMutation,
} from '../../api/patientEndpoints';

import {
    useGetHealthRecordsQuery as _useGetHealthRecordsQuery,
    useAddHealthRecordMutation as _useAddHealthRecordMutation,
    useGetHealthRecordQuery as _useGetHealthRecordQuery,
    useUpdateHealthRecordMutation as _useUpdateHealthRecordMutation,
    useDeleteHealthRecordMutation as _useDeleteHealthRecordMutation,
    useGetHealthRecordsByTypeQuery as _useGetHealthRecordsByTypeQuery,
    useGetHealthRecordAttachmentsQuery as _useGetHealthRecordAttachmentsQuery,
    useUploadHealthRecordAttachmentMutation as _useUploadHealthRecordAttachmentMutation,
    useDeleteHealthRecordAttachmentMutation as _useDeleteHealthRecordAttachmentMutation,
    useGetVitalsQuery as _useGetVitalsQuery,
    useUpdateVitalsMutation as _useUpdateVitalsMutation,
    useGetHabitsQuery as _useGetHabitsQuery,
    useUpdateHabitsMutation as _useUpdateHabitsMutation,
    useGetSurgeriesQuery as _useGetSurgeriesQuery,
    useAddSurgeryMutation as _useAddSurgeryMutation,
    useGetHouseGroupRequestsQuery as _useGetHouseGroupRequestsQuery,
    useSendHouseGroupRequestMutation as _useSendHouseGroupRequestMutation,
    useAcceptHouseGroupRequestMutation as _useAcceptHouseGroupRequestMutation,
    useRejectHouseGroupRequestMutation as _useRejectHouseGroupRequestMutation,
    useCancelHouseGroupRequestMutation as _useCancelHouseGroupRequestMutation,
    useGenerateInviteCodeMutation as _useGenerateInviteCodeMutation,
    useJoinByInviteCodeMutation as _useJoinByInviteCodeMutation,
    useUpdateMemberPermissionsMutation as _useUpdateMemberPermissionsMutation,
} from '../../api/patientHealthEndpoints';

import {
    useGetMyEntityProfileQuery as _useGetMyEntityProfileQuery,
    useUpdateMyEntityProfileMutation as _useUpdateMyEntityProfileMutation,
} from '../../../service-provider/EntityProfile/api/entityProfileEndpoints';

// The allergy master list is a tenant-level catalogue, not patient data —
// re-exported unwrapped so sections have a single import site.
export { useGetAllergyMasterListQuery } from '../../api/patientHealthEndpoints';

// ── Profile provenance (who last changed it) ──
export const useGetProfileLastUpdateQuery = scopedQuery(_useGetProfileLastUpdateQuery);
export const useGetProfileSectionUpdatesQuery = scopedQuery(_useGetProfileSectionUpdatesQuery);

// ── Profile sections ──
export const useGetPersonalDetailsQuery = scopedQuery(_useGetPersonalDetailsQuery);
export const useUpdatePersonalDetailsMutation = scopedMutation(_useUpdatePersonalDetailsMutation);
export const useGetContactIdentityQuery = scopedQuery(_useGetContactIdentityQuery);
export const useUpdateContactIdentityMutation = scopedMutation(_useUpdateContactIdentityMutation);
export const useGetAddressQuery = scopedQuery(_useGetAddressQuery);
export const useUpdateAddressMutation = scopedMutation(_useUpdateAddressMutation);
export const useGetEmergencyContactQuery = scopedQuery(_useGetEmergencyContactQuery);
export const useUpdateEmergencyContactMutation = scopedMutation(_useUpdateEmergencyContactMutation);
export const useGetInsuranceQuery = scopedQuery(_useGetInsuranceQuery);
export const useUpdateInsuranceMutation = scopedMutation(_useUpdateInsuranceMutation);
export const useGetFemaleHealthQuery = scopedQuery(_useGetFemaleHealthQuery);
export const useUpdateFemaleHealthMutation = scopedMutation(_useUpdateFemaleHealthMutation);

// ── Vitals / habits / surgeries ──
export const useGetVitalsQuery = scopedQuery(_useGetVitalsQuery);
export const useUpdateVitalsMutation = scopedMutation(_useUpdateVitalsMutation);
export const useGetHabitsQuery = scopedQuery(_useGetHabitsQuery);
export const useUpdateHabitsMutation = scopedMutation(_useUpdateHabitsMutation);
export const useGetSurgeriesQuery = scopedQuery(_useGetSurgeriesQuery);
export const useAddSurgeryMutation = scopedMutation(_useAddSurgeryMutation);

// ── Health records + attachments ──
export const useGetHealthRecordsQuery = scopedQuery(_useGetHealthRecordsQuery);
export const useAddHealthRecordMutation = scopedMutation(_useAddHealthRecordMutation);
export const useGetHealthRecordQuery = scopedQuery(_useGetHealthRecordQuery);
export const useUpdateHealthRecordMutation = scopedMutation(_useUpdateHealthRecordMutation);
export const useDeleteHealthRecordMutation = scopedMutation(_useDeleteHealthRecordMutation);
export const useGetHealthRecordsByTypeQuery = scopedQuery(_useGetHealthRecordsByTypeQuery);
export const useGetHealthRecordAttachmentsQuery = scopedQuery(_useGetHealthRecordAttachmentsQuery);
export const useUploadHealthRecordAttachmentMutation =
    scopedMutation(_useUploadHealthRecordAttachmentMutation);
export const useDeleteHealthRecordAttachmentMutation =
    scopedMutation(_useDeleteHealthRecordAttachmentMutation);

// ── House / family group ──
export const useGetHouseGroupQuery = scopedQuery(_useGetHouseGroupQuery);
export const useAddHouseGroupMemberMutation = scopedMutation(_useAddHouseGroupMemberMutation);
export const useUpdateHouseGroupMemberMutation = scopedMutation(_useUpdateHouseGroupMemberMutation);
export const useDeleteHouseGroupMemberMutation = scopedMutation(_useDeleteHouseGroupMemberMutation);
export const useGetHouseGroupRequestsQuery = scopedQuery(_useGetHouseGroupRequestsQuery);
export const useSendHouseGroupRequestMutation = scopedMutation(_useSendHouseGroupRequestMutation);
export const useAcceptHouseGroupRequestMutation =
    scopedMutation(_useAcceptHouseGroupRequestMutation);
export const useRejectHouseGroupRequestMutation =
    scopedMutation(_useRejectHouseGroupRequestMutation);
export const useCancelHouseGroupRequestMutation =
    scopedMutation(_useCancelHouseGroupRequestMutation);
export const useGenerateInviteCodeMutation = scopedMutation(_useGenerateInviteCodeMutation);
export const useJoinByInviteCodeMutation = scopedMutation(_useJoinByInviteCodeMutation);
export const useUpdateMemberPermissionsMutation =
    scopedMutation(_useUpdateMemberPermissionsMutation);

// ── Entity details ──
export const useGetMyEntityProfileQuery = scopedQuery(_useGetMyEntityProfileQuery);
export const useUpdateMyEntityProfileMutation = scopedMutation(_useUpdateMyEntityProfileMutation);
