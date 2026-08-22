/**
 * useHospitalSignup — Round 3+4 wrapper around the shared facility-signup
 * hook. Only differs from clinic in that the form collects a
 * ``hospital_type`` field; that's surfaced via the shared hook's
 * ``includeHospitalType`` flag.
 */
import useFacilitySignup from './useFacilitySignup';

const useHospitalSignup = () => useFacilitySignup({ signupType: 'hospital' });

export default useHospitalSignup;
