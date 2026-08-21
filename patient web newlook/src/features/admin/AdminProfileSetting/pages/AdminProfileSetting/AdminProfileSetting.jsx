/**
 * AdminProfileSetting — Main profile settings page for Sub-Admins.
 * Structurally mirrors the Doctor ProfileSetting page.
 *
 * - Profile Details: Fully functional (backend + DB)
 * - Account Status: Profile completion real, Publish Status is placeholder
 * - Availability, Working Hours, Pricing, Analytics, Attendance: Placeholder UI only
 */
import React, { lazy, Suspense, useCallback, useState } from 'react';
import {
    Box, Container, Typography, Paper, Button,
    Alert, Snackbar, Tabs, Tab, Chip, CircularProgress
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import useProfileUI from '../../hooks/useProfileUI';
import useAdminProfilePageConfig from '../../hooks/useAdminProfilePageConfig';
import ApprovalBanner from '../../../../../common/components/ApprovalBanner/ApprovalBanner';
import { useGetAdminMyProfileQuery } from '../../../api/adminProfileConfigEndpoints';
import './AdminProfileSetting.css';

const ProfileDetailsSection = lazy(() => import('../../sections/ProfileDetailsSection'));
const AccountStatusSection = lazy(() => import('../../../../service-provider/ProfileSetting/sections/AccountStatusSection'));
const AvailabilitySection = lazy(() => import('../../sections/AvailabilitySection'));
const WorkingHoursSection = lazy(() => import('../../sections/WorkingHoursSection'));
const PricingSection = lazy(() => import('../../sections/PricingSection'));
const AnalyticsSection = lazy(() => import('../../sections/AnalyticsSection'));
const AttendanceSection = lazy(() => import('../../sections/AttendanceSection'));

const AdminProfileSetting = ({ configOverride = null, previewMode = false }) => {
    const {
        activeTab,
        loading,
        error,
        snackbar,
        handleTabChange,
        handleCloseSnackbar,
    } = useProfileUI(previewMode);

    const cfg = useAdminProfilePageConfig('en', 'admin', configOverride);

    // Fetch admin ID for AccountStatusSection
    const { data: adminProfile } = useGetAdminMyProfileQuery(undefined, { skip: previewMode });
    const adminId = adminProfile?.id;

    // registerSave pattern: each section registers its own save handler + label
    const [saveInfo, setSaveInfo] = useState({ handler: null, label: 'Save', disabled: false });
    const registerSave = useCallback((handler, label, disabled) => {
        setSaveInfo({ handler, label: label || 'Save', disabled: !!disabled });
    }, []);

    const handleSaveForTab = () => {
        if (saveInfo.handler) saveInfo.handler();
    };

    return (
        <Box className="admin-profile-container" sx={previewMode ? { pointerEvents: 'none', opacity: 0.95, position: 'relative' } : {}}>
            {previewMode && (
                <Chip label="Preview Mode" color="info" size="small" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 10 }} />
            )}
            <Container maxWidth="lg" sx={{ mt: previewMode ? 1 : 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                    <Typography variant="h4" fontWeight="bold">{cfg.pageTitle}</Typography>
                </Box>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                {/* Tabs — Account Status at index 1 */}
                <Paper sx={{ mb: 3 }}>
                    <Tabs value={activeTab} onChange={handleTabChange} indicatorColor="primary" textColor="primary" variant="scrollable" scrollButtons="auto">
                        <Tab label="Profile Details" />
                        <Tab label="Account Status" />
                        <Tab label="Availability / Schedule" />
                        <Tab label="Working Hours" />
                        <Tab label="Consultation Pricing" />
                        <Tab label="Analytics" />
                        <Tab label="Attendance & Activity" />
                    </Tabs>
                </Paper>

                {/* Tab Content — lazy loaded, only active tab mounted */}
                <Suspense fallback={<Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>}>
                    {activeTab === 0 && (
                        <ProfileDetailsSection
                            previewMode={previewMode}
                            configOverride={configOverride}
                            registerSave={registerSave}
                        />
                    )}
                    {activeTab === 1 && (
                        <AccountStatusSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                            doctorId={adminId}
                            entityType="admin"
                            isAdminView={false}
                        />
                    )}
                    {activeTab === 2 && (
                        <AvailabilitySection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {activeTab === 3 && (
                        <WorkingHoursSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {activeTab === 4 && (
                        <PricingSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {activeTab === 5 && (
                        <AnalyticsSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                    {activeTab === 6 && (
                        <AttendanceSection
                            previewMode={previewMode}
                            registerSave={registerSave}
                        />
                    )}
                </Suspense>
            </Container>

            {/* Sticky Footer — hidden in preview mode */}
            {!previewMode && (
                <Box className="action-buttons-container">
                    <Container maxWidth="lg" sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                        <Button
                            variant="contained"
                            color="primary"
                            startIcon={<SaveIcon />}
                            onClick={handleSaveForTab}
                            disabled={loading || saveInfo.disabled}
                            size="large"
                            sx={{ px: 4 }}
                        >
                            {loading || saveInfo.disabled ? 'Saving...' : saveInfo.label}
                        </Button>
                    </Container>
                </Box>
            )}

            {/* Snackbar */}
            <Snackbar
                open={snackbar.open}
                autoHideDuration={4000}
                onClose={handleCloseSnackbar}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%' }}>
                    {snackbar.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default AdminProfileSetting;
