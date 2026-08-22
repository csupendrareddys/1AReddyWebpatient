/**
 * PatientStaffLayout — the caregiver (support-staff) portal shell.
 *
 * Gives the caregiver real dashboard chrome — sidebar, top bar and a Logout
 * button — consistent with the patient and clinic portals, instead of the bare
 * page it was. Their content (My account, and the scoped patient dashboard they
 * Open) renders in the layout's Outlet.
 */
import DashboardLayout from '../../../../common/components/DashboardLayout/DashboardLayout';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import FavoriteIcon from '@mui/icons-material/Favorite';

const patientStaffConfig = {
    portalName: 'Caregiver',
    portalIcon: FavoriteIcon,
    accentColor: '#E8833A',
    accentDark: '#D4702E',
    // After logout a caregiver signs back in at the patient door.
    loginPath: '/auth/service-receiver/login',
    profilePath: '/dashboard/patient-staff',
    roleLabel: 'SUPPORT STAFF',
    navItems: [
        { label: 'My account', icon: BadgeOutlinedIcon, path: '/dashboard/patient-staff', exact: true },
    ],
};

export default function PatientStaffLayout() {
    return <DashboardLayout config={patientStaffConfig} />;
}
