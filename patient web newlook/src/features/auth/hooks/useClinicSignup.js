/**
 * useClinicSignup — Round 3+4 wrapper around the shared facility-signup
 * hook. Returns the same shape ``useDoctorSignup`` does so the signup
 * page component code can stay symmetric.
 */
import useFacilitySignup from './useFacilitySignup';

const useClinicSignup = () => useFacilitySignup({ signupType: 'clinic' });

export default useClinicSignup;
