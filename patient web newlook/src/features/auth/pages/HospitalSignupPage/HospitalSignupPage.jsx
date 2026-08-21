/**
 * HospitalSignupPage — Round 3+4. Apex marketplace hospital signup.
 *
 * Same shape as ClinicSignupPage, but the shared form component
 * surfaces a ``hospital_type`` select because we pass
 * ``vertical='hospital'``. State lives in ``useHospitalSignup``.
 */
import useHospitalSignup from '../../hooks/useHospitalSignup';
import FacilitySignupForm
    from '../../components/FacilitySignupForm/FacilitySignupForm';

const HospitalSignupPage = () => {
    const hookValues = useHospitalSignup();
    return (
        <FacilitySignupForm
            vertical="hospital"
            headline="Hospital Registration"
            sub="List your hospital on the larazen marketplace and reach patients across India."
            {...hookValues}
        />
    );
};

export default HospitalSignupPage;
