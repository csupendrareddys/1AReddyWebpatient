/**
 * useScopeGrantedModules — for a support-staff CAREGIVER viewing the patient's
 * profile, the set of module keys that patient granted them. The profile page
 * uses it to show only the sections the caregiver may actually touch (the gate
 * now enforces this per-section server-side, so an ungranted section would
 * otherwise render as empty, un-saveable fields).
 *
 * Returns ``null`` for every OTHER scope — the logged-in patient (self), an
 * admin in Operations, and a guardian operating a minor (family) all get the
 * full page. Family is deliberately excluded: that scope also covers a guardian
 * with FULL access to their minor, and the context can't tell the two apart, so
 * hiding there would wrongly clip a guardian's page. Caregivers are always
 * role-bounded, so ``staff`` is safe to gate.
 */
import { usePatientScope } from '../context/PatientScopeContext';
import { useGetPatientStaffMeQuery } from '../../SupportStaff/api/supportStaffEndpoints';

export default function useScopeGrantedModules() {
    const { scopeKind, patientId } = usePatientScope();
    // Gate ONLY the caregiver-on-MAIN-patient scope (``staff:<patientId>``). A
    // caregiver on a MINOR rides ``staff-family:<memberId>`` (same ``scopeKind``
    // 'staff', different prefix) — like a guardian on a minor it gets the FULL
    // page: the per-minor grant isn't in this /me shape, and the server enforces
    // the actual grant per section anyway.
    const isStaffMain = scopeKind === 'staff' && (patientId || '').startsWith('staff:');
    // Skipped (no request) for every other scope.
    const { data } = useGetPatientStaffMeQuery(undefined, { skip: !isStaffMain });
    if (!isStaffMain) return null;
    const pid = (patientId || '').replace(/^staff:/, '');
    const mine = (data?.patients || []).find((p) => p.patient_id === pid);
    return new Set(mine?.modules || []);
}
