/**
 * DoctorScopeContext — "whose doctor account am I acting on?"
 *
 * Default (no provider, or `doctorId` null): the logged-in doctor, acting on
 * themselves. That's every ``/dashboard/doctor/*`` route and it behaves
 * exactly as it always has.
 *
 * With a `doctorId`: someone entitled to act for that doctor — a super-admin
 * in Operations (`scopeKind` ``'ops'``), or a clinic/hospital running a doctor
 * it employs, from My Link (`scopeKind` ``'link'``). The doctor-side
 * components don't branch on either — the RTK-Query surfaces consume the
 * wrapped hooks in ``api/scopedDoctorApi``, and the older thunk surfaces go
 * through ``doctorApiPath``; both re-point their requests at the matching
 * act-on-behalf proxy. That's what lets both surfaces reuse the real
 * ``ProfileSetting`` page and the real appointments page instead of
 * maintaining parallel copies that drift.
 *
 * ``doctorId`` and ``scope`` are both published, and they are not the same
 * thing. ``doctorId`` is the plain id, for components that need to *name* the
 * doctor to an already-parameterised endpoint. ``scope`` is the token the URL
 * builders and the cache keys use, and it carries which proxy — so the same
 * doctor opened from Operations and from a clinic's My Link never share a
 * cache entry, and neither ever addresses the other's route.
 *
 * ``basePath`` is where those pages live in the URL — ``/dashboard/doctor``
 * for the doctor, or the Operations member-detail subtree for an admin — so
 * the pages' own navigation stays inside whichever surface mounted them.
 *
 * ``myDoctorId`` is the id the sections would otherwise fetch from
 * ``/api/doctor-analytics/me``. Several tabs (Analytics, Account Status,
 * Attendance, and the approval banner) key off it to call endpoints that are
 * ALREADY doctor-id-parameterised and admin-callable — those don't need the
 * proxy at all, they just need to be pointed at the right doctor. See
 * {@link useScopedMyDoctorId}.
 */
import { createContext, useContext, useLayoutEffect, useMemo } from 'react';
import { useDispatch } from 'react-redux';

import { OPS_SCOPE, makeScope } from '../../api/doctorScope';
import { clearDoctorState } from '../../redux/doctorSlice';
import { clearAboutState } from '../redux/doctorProfileAboutSlice';
import { clearBankState } from '../redux/doctorProfileBankDetailsSlice';
import { clearDeclarationState } from '../redux/doctorProfileDeclarationSlice';
import { clearEducationState } from '../redux/doctorProfileEducationSlice';
import { clearDoctorProfileUiState } from '../redux/doctorProfilePersonalDetailsSlice';
import { clearSignaturesState } from '../redux/doctorProfileSignaturesSlice';

// The slices every doctor-profile surface writes into. Unlike RTK Query,
// which keys its cache per doctor via the scoped arg, there is exactly one of
// each of these — so switching from doctor A to doctor B has to empty them or
// B's page renders A's education, bank details and about text until each
// fetch lands. In a support tool that is worse than a spinner.
const RESET_ACTIONS = [
    clearDoctorState, clearDoctorProfileUiState, clearAboutState,
    clearEducationState, clearBankState, clearDeclarationState,
    clearSignaturesState,
];

/** Where the doctor's own pages live when nobody is acting on their behalf. */
export const DOCTOR_BASE_PATH = '/dashboard/doctor';

/**
 * Where the prescription + document sub-pages live, which is NOT simply
 * ``basePath`` on both sides. The doctor reaches them at
 * ``/dashboard/doctor/prescriptions/<id>``; Operations nests the whole hub
 * under its own ``/records`` tab so the tab stays selected while you're inside
 * one. Both are ``<recordsPath>/prescriptions/<id>``, which is what lets
 * ``MyPrescriptionsPage`` build one URL that resolves in either.
 */
const recordsPathFor = (basePath, isOps) => (
    isOps ? `${basePath}/records` : basePath
);

const DEFAULT = {
    doctorId: null,
    scope: null,
    scopeKind: null,
    isOps: false,
    basePath: DOCTOR_BASE_PATH,
    recordsPath: DOCTOR_BASE_PATH,
};

const DoctorScopeContext = createContext(DEFAULT);

export const DoctorScopeProvider = ({
    doctorId = null, scopeKind = OPS_SCOPE, basePath = DOCTOR_BASE_PATH, children,
}) => {
    // Note there is nothing here publishing ``doctorId`` for the redux thunks
    // to read — they resolve it from the URL themselves, which is the same
    // place this component's own prop comes from. See ../../api/doctorScope.js
    // for why: anything this provider set in an effect would be reset by its
    // own cleanup on a StrictMode remount, and the sections' fetch effects run
    // before it could re-assert the value.

    // Empty the shared doctor slices whenever the subject changes, and again
    // on the way out so one doctor's record doesn't sit in the store while the
    // admin browses elsewhere. A layout effect, not a plain one: the sections
    // dispatch their fetches from their own mount effects, so by the time this
    // runs the requests are already in flight — but they resolve later, and
    // clearing before paint is what stops the previous doctor's data being
    // visible for a frame under the new doctor's name.
    const dispatch = useDispatch();
    useLayoutEffect(() => {
        const reset = () => RESET_ACTIONS.forEach((a) => dispatch(a()));
        reset();
        return reset;
    }, [dispatch, doctorId]);

    const value = useMemo(
        () => {
            const base = basePath || DOCTOR_BASE_PATH;
            return {
                doctorId: doctorId || null,
                scope: makeScope(doctorId, scopeKind),
                scopeKind: doctorId ? scopeKind : null,
                // "Someone other than the doctor is driving these pages" —
                // which is what the sections branch on when they hide a
                // control (joining a call, writing a prescription). True for
                // both proxies, because the reason is the same for both.
                isOps: !!doctorId,
                basePath: base,
                recordsPath: recordsPathFor(base, !!doctorId),
            };
        },
        [doctorId, scopeKind, basePath],
    );
    return (
        <DoctorScopeContext.Provider value={value}>
            {children}
        </DoctorScopeContext.Provider>
    );
};

/**
 * @returns {{doctorId: string|null, scope: string|null,
 *           scopeKind: 'ops'|'link'|null, isOps: boolean, basePath: string,
 *           recordsPath: string}}
 */
export const useDoctorScope = () => useContext(DoctorScopeContext);

export default DoctorScopeContext;
