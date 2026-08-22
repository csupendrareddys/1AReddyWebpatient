/**
 * PharmacyLayout — Pharmacy role layout configuration
 * Wraps DashboardLayout with Pharmacy-specific sidebar config
 */
import DashboardLayout from '../../../common/components/DashboardLayout/DashboardLayout';
import DashboardIcon from '@mui/icons-material/Dashboard';
import InventoryIcon from '@mui/icons-material/Inventory';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import SettingsIcon from '@mui/icons-material/Settings';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';

const pharmacyConfig = {
    portalName: 'Pharmacy Portal',
    portalIcon: LocalPharmacyIcon,
    accentColor: '#2E7D32',
    accentDark: '#1B5E20',
    loginPath: '/',  // Stale '/login' 404s — redirect to public landing
    roleLabel: 'PHARMACY',
    navItems: [
        { label: 'Dashboard', icon: DashboardIcon, path: '/dashboard/pharmacy', exact: true },
        { type: 'divider' },
        { label: 'Inventory', icon: InventoryIcon, path: '/dashboard/pharmacy/inventory', disabled: true },
        { label: 'Orders', icon: ShoppingCartIcon, path: '/dashboard/pharmacy/orders', disabled: true },
        { label: 'Settings', icon: SettingsIcon, path: '/dashboard/pharmacy/settings', disabled: true },
    ],
};

const PharmacyLayout = () => <DashboardLayout config={pharmacyConfig} />;

export default PharmacyLayout;
