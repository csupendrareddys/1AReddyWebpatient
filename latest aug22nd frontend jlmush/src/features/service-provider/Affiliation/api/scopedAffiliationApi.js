/**
 * Facility-roster hooks that honour the facility scope.
 *
 * ``ManageDoctors`` + ``AddDoctorDialog`` are mounted two ways: on a clinic /
 * hospital's own Manage Doctors page (no scope → their own roster), and inside a
 * clinic operating one of its login-less BRANCHES (a branch scope → the request
 * routes through ``/api/v1/clinic/branches/<id>/act/affiliation/...`` and manages
 * the BRANCH's roster). These wrappers fold the active {@link useFacilityScope}
 * into each hook's arg; with no scope the arg passes through untouched. Mirror
 * of ``EntityProfile/api/scopedEntityApi.js``.
 */
import { useCallback } from 'react';

import {
    useListFacilityDoctorsQuery as _useListFacilityDoctorsQuery,
    useRequestDoctorByCodeMutation as _useRequestDoctorByCodeMutation,
    useCancelFacilityRequestMutation as _useCancelFacilityRequestMutation,
    useInviteFacilityDoctorMutation as _useInviteFacilityDoctorMutation,
} from './affiliationEndpoints';
import { useFacilityScope } from '../../EntityProfile/context/FacilityScopeContext';
import { withScope } from '../../api/facilityScope';

export const useListFacilityDoctorsQuery = (arg, options) => {
    const { facility } = useFacilityScope();
    return _useListFacilityDoctorsQuery(withScope(facility, arg), options);
};

const scopedMutation = (useGeneratedMutation) => (options) => {
    const { facility } = useFacilityScope();
    const [trigger, state] = useGeneratedMutation(options);
    const scopedTrigger = useCallback(
        (arg) => trigger(withScope(facility, arg)),
        [trigger, facility],
    );
    return [scopedTrigger, state];
};

export const useRequestDoctorByCodeMutation = scopedMutation(_useRequestDoctorByCodeMutation);
export const useCancelFacilityRequestMutation = scopedMutation(_useCancelFacilityRequestMutation);
export const useInviteFacilityDoctorMutation = scopedMutation(_useInviteFacilityDoctorMutation);
