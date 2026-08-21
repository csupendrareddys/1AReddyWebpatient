/**
 * PatientScopeContext — "whose patient account am I acting on?"
 *
 * Default (no provider, or `patientId` null): the logged-in patient, acting on
 * themselves. That's every ``/dashboard/patient/*`` route and it behaves
 * exactly as it always has.
 *
 * With a `patientId`: a super-admin in Operations acting on behalf of that
 * patient. The patient-side components don't branch on this — they consume the
 * wrapped hooks in ``api/scopedPatientApi`` (profile) and
 * ``api/scopedBookingApi`` (booking), which read the scope from here and
 * re-point every request at the act-on-behalf proxy. That's what lets
 * Operations reuse the real ``ProfileSetting`` page and the real booking
 * screens instead of maintaining parallel admin-only copies that drift.
 *
 * ``basePath`` is where those pages live in the URL. The booking flow is
 * genuinely multi-page (pick a type → match doctors → pick a slot), so the
 * pages navigate between each other by absolute path. Under Operations they
 * are mounted below the member-detail route instead of ``/dashboard/patient``,
 * and every such navigation is written ``${basePath}/…`` so one value moves
 * the whole flow. (A nested router would have avoided the plumbing but React
 * Router forbids one inside another, so the base path is the honest fix.)
 *
 * ``markAsPaid`` is the one thing an admin has to decide that a patient never
 * does. Every booking flow ends at a Razorpay popup the admin can't complete,
 * so ops mode substitutes an offline settlement (see usePatientCheckout) with
 * two honest options: leave it unpaid for the patient to pay from their own
 * app, or record that they already paid at the counter. It lives here rather
 * than in each page so one control at the top of the Operations booking tab
 * governs consultations, services and health plans alike. Default false —
 * asserting a payment happened is the claim that needs the deliberate click.
 */
import { createContext, useContext, useMemo, useState } from 'react';

/** Where the patient's own pages live when nobody is acting on their behalf. */
export const PATIENT_BASE_PATH = '/dashboard/patient';

const DEFAULT = {
    patientId: null,
    isOps: false,
    scopeKind: 'self',
    basePath: PATIENT_BASE_PATH,
    markAsPaid: false,
    setMarkAsPaid: () => {},
};

const PatientScopeContext = createContext(DEFAULT);

/**
 * ``patientId``     — an admin (Operations) acting on that patient. Offline
 *                     settlement applies (``isOps``).
 * ``familyMemberId``— a patient GUARDIAN acting on their own minor sub-profile.
 *                     Same act-on-behalf plumbing, but the guardian pays through
 *                     the real gateway like any patient, so ``isOps`` stays false.
 * The threaded scope id (``patientId`` field below, kept for the wrapped hooks)
 * is ``family:<memberId>`` for a guardian, the bare id for ops, null for self.
 */
export const PatientScopeProvider = ({
    patientId = null, familyMemberId = null, staffPatientId = null,
    staffFamilyMemberId = null,
    basePath = PATIENT_BASE_PATH, children,
}) => {
    const [markAsPaid, setMarkAsPaid] = useState(false);
    // A support-staff CAREGIVER acting on the patient who employs them rides the
    // same act-on-behalf plumbing as a guardian — ``staff:<patientId>`` re-points
    // requests at ``/api/patient-staff/act/<patientId>/...`` (see patientScope.js).
    // ``staff-family:<memberId>`` is the same caregiver acting on one of that
    // patient's MINORS → ``/api/patient-staff/act-minor/<memberId>/...``. Both are
    // ``isOps`` false and defer payment to the account owner (the caregiver never
    // pays); a minor's bill is settled by the parent.
    const scopeId = staffFamilyMemberId ? `staff-family:${staffFamilyMemberId}`
        : staffPatientId ? `staff:${staffPatientId}`
            : familyMemberId ? `family:${familyMemberId}`
                : (patientId || null);
    const value = useMemo(
        () => ({
            patientId: scopeId,          // the wrapped hooks thread this
            isOps: !!patientId,          // ops-only — never for a guardian / caregiver
            // A caregiver-on-minor keeps the 'staff' semantics (defer payment to
            // the owner, hide live-call join); only the act path differs.
            scopeKind: (staffPatientId || staffFamilyMemberId) ? 'staff'
                : familyMemberId ? 'family'
                    : (patientId ? 'ops' : 'self'),
            basePath: basePath || PATIENT_BASE_PATH,
            markAsPaid,
            setMarkAsPaid,
        }),
        [scopeId, patientId, familyMemberId, staffPatientId, staffFamilyMemberId,
            basePath, markAsPaid],
    );
    return (
        <PatientScopeContext.Provider value={value}>
            {children}
        </PatientScopeContext.Provider>
    );
};

/**
 * @returns {{patientId: string|null, isOps: boolean, basePath: string,
 *            markAsPaid: boolean, setMarkAsPaid: (v: boolean) => void}}
 */
export const usePatientScope = () => useContext(PatientScopeContext);

export default PatientScopeContext;
