/**
 * ClinicSignupPage — Round 3+4. Apex marketplace clinic signup.
 *
 * Thin wrapper around the shared ``FacilitySignupForm`` component.
 * All form-state + validation lives in ``useClinicSignup``.
 */
import useClinicSignup from '../../hooks/useClinicSignup';
import FacilitySignupForm
    from '../../components/FacilitySignupForm/FacilitySignupForm';

const ClinicSignupPage = () => {
    const hookValues = useClinicSignup();
    return (
        <FacilitySignupForm
            vertical="clinic"
            headline="Clinic Registration"
            sub="Join the larazen marketplace and get discovered by patients near you."
            {...hookValues}
        />
    );
};

export default ClinicSignupPage;
