/**
 * AdminLayout — Root layout wrapper for all admin pages
 * Provides persistent sidebar + top bar, renders child routes via <Outlet />
 * Sidebar is collapsible — content expands to full width when closed
 */
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useSelector } from 'react-redux';
import AdminSidebar from '../AdminSidebar/AdminSidebar';
import AdminTopBar from '../AdminTopBar/AdminTopBar';
import SharedSnackbar from '../SharedSnackbar/SharedSnackbar';
import './AdminLayout.css';

const AdminLayout = () => {
    const { isDarkMode } = useSelector((state) => state.theme);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    const toggleSidebar = () => setSidebarOpen((prev) => !prev);

    return (
        <div className={`admin-layout ${isDarkMode ? 'dark-mode' : ''} ${!sidebarOpen ? 'admin-layout--collapsed' : ''}`}>
            <AdminSidebar isOpen={sidebarOpen} onToggle={toggleSidebar} />
            <div className="admin-layout__content-wrapper">
                <AdminTopBar onToggleSidebar={toggleSidebar} sidebarOpen={sidebarOpen} />
                <main className="admin-layout__main">
                    <Outlet />
                </main>
            </div>
            {/* Global consumer for ``adminSharedUiSlice.snackbar`` —
                any admin page that dispatches setSnackbar() gets a
                visible toast without each page wiring its own. */}
            <SharedSnackbar />
        </div>
    );
};

export default AdminLayout;
