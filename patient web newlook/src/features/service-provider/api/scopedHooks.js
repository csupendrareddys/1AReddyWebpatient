/**
 * The wrappers that turn a generated RTK-Query hook into a doctor-scope-aware
 * one. Used by ``api/scopedDoctorApi`` so no section has to know it might be
 * running inside Operations.
 *
 * Each reads the active {@link useDoctorScope} and folds the target doctor id
 * into the hook's arg. With no scope the arg passes through untouched, so a
 * doctor using their own pages keeps the exact URLs and cache keys they always
 * had — see ./doctorScope.js for why the id rides on the arg.
 */
import { useCallback } from 'react';

import { useDoctorScope } from '../ProfileSetting/context/DoctorScopeContext';
import { withScope } from './doctorScope';

/** Wrap a generated query hook so its arg carries the active scope. */
export const scopedQuery = (useGeneratedQuery) => (arg, options) => {
    const { scope } = useDoctorScope();
    return useGeneratedQuery(withScope(scope, arg), options);
};

/**
 * Wrap a generated mutation hook so the trigger's arg carries the active
 * scope. The returned trigger keeps a stable identity (components list it in
 * `useCallback` deps) and still returns RTK Query's promise, so `.unwrap()`
 * works untouched.
 */
export const scopedMutation = (useGeneratedMutation) => (options) => {
    const { scope } = useDoctorScope();
    const [trigger, state] = useGeneratedMutation(options);
    const scopedTrigger = useCallback(
        (arg) => trigger(withScope(scope, arg)),
        [trigger, scope],
    );
    return [scopedTrigger, state];
};

/** Same as {@link scopedMutation} for a lazy query's `trigger`. */
export const scopedLazyQuery = (useGeneratedLazyQuery) => (options) => {
    const { scope } = useDoctorScope();
    const [trigger, state, info] = useGeneratedLazyQuery(options);
    const scopedTrigger = useCallback(
        (arg, preferCacheValue) => trigger(withScope(scope, arg), preferCacheValue),
        [trigger, scope],
    );
    return [scopedTrigger, state, info];
};
