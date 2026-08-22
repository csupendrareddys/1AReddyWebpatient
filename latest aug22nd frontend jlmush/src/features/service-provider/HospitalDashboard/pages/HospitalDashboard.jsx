/**
 * HospitalDashboard — Round 3+4 landing page for marketplace hospitals.
 * Thin wrapper around the shared FacilityDashboard.
 */
import ApartmentIcon from '@mui/icons-material/Apartment';
import FacilityDashboard from '../../common/pages/FacilityDashboard';

const HospitalDashboard = () => (
    <FacilityDashboard
        portalLabel="Hospital Portal"
        portalIcon={ApartmentIcon}
        accentGradient="linear-gradient(135deg, #6A1B9A, #4A148C)"
        membershipPath="/dashboard/hospital/membership"
        roleLabel="HOSPITAL"
    />
);

export default HospitalDashboard;
