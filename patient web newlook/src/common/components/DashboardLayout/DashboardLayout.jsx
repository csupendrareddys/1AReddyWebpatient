/**
 * DashboardLayout — Reusable root layout wrapper for any role
 * Provides persistent collapsible sidebar + top bar
 * Renders child routes via <Outlet />
 *
 * Usage: Pass a `config` prop with role-specific sidebar configuration
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import DashboardSidebar from './DashboardSidebar';
import DashboardTopBar from './DashboardTopBar';
import './DashboardLayout.css';

const DashboardLayout = ({ config }) => {
    const { isDarkMode } = useSelector((state) => state.theme);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const toggleSidebar = () => setSidebarOpen((prev) => !prev);

    return (
        <div className={`dashboard-layout ${isDarkMode ? 'dark-mode' : ''} ${!sidebarOpen ? 'dashboard-layout--collapsed' : ''}`}>
            <DashboardSidebar isOpen={sidebarOpen} onToggle={toggleSidebar} config={config} />
            <div className="dashboard-layout__content-wrapper">
                <DashboardTopBar onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} accentColor={config.accentColor} />
                <main className="dashboard-layout__main">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default DashboardLayout;
