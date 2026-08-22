/**
 * Entity-profile hooks that honour BOTH Operations scopes.
 *
 * ``EntityDetailsSection`` is mounted three ways — by a patient's profile, by
 * a clinic's or hospital's settings page, and by Operations standing in for
 * any of them — so its hooks have to answer for whichever subject is in
 * scope. The patient wrapper (``scopedPatientApi``) already existed; this adds
 * the facility one on top of it.
 *
 * Order matters and is safe in both directions: the facility scope is folded
 * in FIRST, then handed to the patient-scoped hook, which passes a
 * non-patient-scoped arg through untouched. Only one provider is ever mounted
 * around this section, so the two can't collide — and with neither, the arg
 * reaches the endpoint exactly as the facility's own page has always sent it.
 */
import { useCallback } from 'react';

import {
    useGetMyEntityProfileQuery as _useGetMyEntityProfileQuery,
    useUpdateMyEntityProfileMutation as _useUpdateMyEntityProfileMutation,
} from '../../../service-receiver/ProfileSetting/api/scopedPatientApi';
import { useFacilityScope } from '../context/FacilityScopeContext';
import { withScope } from './../../api/facilityScope';

export const useGetMyEntityProfileQuery = (arg, options) => {
    const { facility } = useFacilityScope();
    return _useGetMyEntityProfileQuery(withScope(facility, arg), options);
};

export const useUpdateMyEntityProfileMutation = (options) => {
    const { facility } = useFacilityScope();
    const [trigger, state] = _useUpdateMyEntityProfileMutation(options);
    // Stable identity — the section lists this trigger in a useCallback dep.
    const scopedTrigger = useCallback(
        (arg) => trigger(withScope(facility, arg)),
        [trigger, facility],
    );
    return [scopedTrigger, state];
};
