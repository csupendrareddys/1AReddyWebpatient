/**
 * Dual-scoped service-channel hooks.
 *
 * ``MyServiceChannels`` and its child panels are ONE component tree serving four
 * callers: a patient on their own page, a DOCTOR on theirs, an admin acting on a
 * doctor from Operations, and a GUARDIAN acting on a MINOR sub-profile. Each
 * hook folds whichever scope is active — the doctor scope (``useDoctorScope``)
 * or the patient/guardian-family scope (``usePatientScope``) — into the hook
 * arg. The channel endpoints (``splitAnyScope`` + ``channelUrl`` in
 * ``serviceCommunicationEndpoints``) then route it to the matching proxy, so the
 * minor's channels/messages/calls load rather than the guardian's.
 *
 * With NEITHER scope set (someone on their own page) the arg passes through and
 * the request runs as the logged-in user — the doctor's own page and the
 * patient's own page keep behaving exactly as before.
 */
import { useCallback } from 'react';

import { usePatientScope } from '../../service-receiver/ProfileSetting/context/PatientScopeContext';
import { withScope as withPatientScope } from '../../service-receiver/api/patientScope';
import { useDoctorScope } from '../../service-provider/ProfileSetting/context/DoctorScopeContext';
import { withScope as withDoctorScope } from '../../service-provider/api/doctorScope';

import {
    useListMyServiceChannelsQuery as _useListMyServiceChannelsQuery,
    useGetServiceChannelQuery as _useGetServiceChannelQuery,
    useGetChannelMessagesQuery as _useGetChannelMessagesQuery,
    useGetChannelTimelineQuery as _useGetChannelTimelineQuery,
    useGetChannelCallsQuery as _useGetChannelCallsQuery,
    useGetChannelDocumentsQuery as _useGetChannelDocumentsQuery,
    useGetChannelFormsQuery as _useGetChannelFormsQuery,
    useSendChannelMessageMutation as _useSendChannelMessageMutation,
    useMarkChannelReadMutation as _useMarkChannelReadMutation,
    useScheduleChannelCallMutation as _useScheduleChannelCallMutation,
    useProposeChannelCallMutation as _useProposeChannelCallMutation,
    useCallActionMutation as _useCallActionMutation,
    useUploadChannelDocumentMutation as _useUploadChannelDocumentMutation,
    useGetChannelDocumentUrlMutation as _useGetChannelDocumentUrlMutation,
    useSubmitChannelFormMutation as _useSubmitChannelFormMutation,
} from '../../admin/api/serviceCommunicationEndpoints';

// Fold whichever member scope is active. Only one is ever set for a given tree
// (a doctor page has no PatientScopeProvider; a minor page has no doctor one),
// so the doctor-first order is just a deterministic tie-break.
const foldScope = (arg, doctorId, patientId) => {
    if (doctorId) return withDoctorScope(doctorId, arg);
    if (patientId) return withPatientScope(patientId, arg);
    return arg;
};

const dualQuery = (useGeneratedQuery) => (arg, options) => {
    const { doctorId } = useDoctorScope();
    const { patientId } = usePatientScope();
    return useGeneratedQuery(foldScope(arg, doctorId, patientId), options);
};

const dualMutation = (useGeneratedMutation) => (options) => {
    const { doctorId } = useDoctorScope();
    const { patientId } = usePatientScope();
    const [trigger, state] = useGeneratedMutation(options);
    const scopedTrigger = useCallback(
        (arg) => trigger(foldScope(arg, doctorId, patientId)),
        [trigger, doctorId, patientId],
    );
    return [scopedTrigger, state];
};

export const useListMyServiceChannelsQuery = dualQuery(_useListMyServiceChannelsQuery);
export const useGetServiceChannelQuery = dualQuery(_useGetServiceChannelQuery);
export const useGetChannelMessagesQuery = dualQuery(_useGetChannelMessagesQuery);
export const useGetChannelTimelineQuery = dualQuery(_useGetChannelTimelineQuery);
export const useGetChannelCallsQuery = dualQuery(_useGetChannelCallsQuery);
export const useGetChannelDocumentsQuery = dualQuery(_useGetChannelDocumentsQuery);
export const useGetChannelFormsQuery = dualQuery(_useGetChannelFormsQuery);

export const useSendChannelMessageMutation = dualMutation(_useSendChannelMessageMutation);
export const useMarkChannelReadMutation = dualMutation(_useMarkChannelReadMutation);
export const useScheduleChannelCallMutation = dualMutation(_useScheduleChannelCallMutation);
export const useProposeChannelCallMutation = dualMutation(_useProposeChannelCallMutation);
export const useCallActionMutation = dualMutation(_useCallActionMutation);
export const useUploadChannelDocumentMutation = dualMutation(_useUploadChannelDocumentMutation);
export const useGetChannelDocumentUrlMutation = dualMutation(_useGetChannelDocumentUrlMutation);
export const useSubmitChannelFormMutation = dualMutation(_useSubmitChannelFormMutation);
