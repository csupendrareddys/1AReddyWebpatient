/**
 * ClinicDashboard — Round 3+4 landing page for marketplace clinics.
 * Thin wrapper around the shared FacilityDashboard.
 */
import MedicalServicesIcon from '@mui/icons-material/MedicalServices';
import FacilityDashboard from '../../common/pages/FacilityDashboard';

const ClinicDashboard = () => (
    <FacilityDashboard
        portalLabel="Clinic Portal"
        portalIcon={MedicalServicesIcon}
        accentGradient="linear-gradient(135deg, #0277BD, #01579B)"
        membershipPath="/dashboard/clinic/membership"
        roleLabel="CLINIC"
    />
);

export default ClinicDashboard;
