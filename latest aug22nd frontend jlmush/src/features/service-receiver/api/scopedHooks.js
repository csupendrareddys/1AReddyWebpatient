/**
 * The two wrappers that turn a generated RTK-Query hook into a scope-aware
 * one. Shared by ``ProfileSetting/api/scopedPatientApi`` (profile surfaces)
 * and ``api/scopedBookingApi`` (booking surfaces) so the two can't drift.
 *
 * Both read the active {@link usePatientScope} and fold the target patient id
 * into the hook's arg. With no scope the arg passes through untouched, so a
 * patient using their own pages keeps the exact URLs and cache keys they
 * always had — see ./patientScope.js for why the id rides on the arg.
 */
import { useCallback } from 'react';

import { usePatientScope } from '../ProfileSetting/context/PatientScopeContext';
import { withScope } from './patientScope';
import useResilientQuery from '../../../common/hooks/useResilientQuery';

/** Wrap a generated query hook so its arg carries the active scope.
 *
 * Also routed through {@link useResilientQuery} so the React-18 StrictMode
 * subscription race can't leave a scoped section (profile, vitals, appointments…)
 * blank while its request has already 200'd — it primes the data from an
 * imperative refetch when the live subscription wedges. */
export const scopedQuery = (useGeneratedQuery) => (arg, options) => {
    const { patientId } = usePatientScope();
    return useResilientQuery(useGeneratedQuery, withScope(patientId, arg), options);
};

/**
 * Wrap a generated mutation hook so the trigger's arg carries the active
 * scope. The returned trigger keeps a stable identity (components list it in
 * `useCallback` deps) and still returns RTK Query's promise, so `.unwrap()`
 * works untouched.
 */
export const scopedMutation = (useGeneratedMutation) => (options) => {
    const { patientId } = usePatientScope();
    const [trigger, state] = useGeneratedMutation(options);
    const scopedTrigger = useCallback(
        (arg) => trigger(withScope(patientId, arg)),
        [trigger, patientId],
    );
    return [scopedTrigger, state];
};

/** Same as {@link scopedMutation} for a lazy query's `trigger`. */
export const scopedLazyQuery = (useGeneratedLazyQuery) => (options) => {
    const { patientId } = usePatientScope();
    const [trigger, state, info] = useGeneratedLazyQuery(options);
    const scopedTrigger = useCallback(
        (arg, preferCacheValue) => trigger(withScope(patientId, arg), preferCacheValue),
        [trigger, patientId],
    );
    return [scopedTrigger, state, info];
};
