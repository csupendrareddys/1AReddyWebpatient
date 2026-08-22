/**
 * AttendanceSection — Doctor Attendance & Activity Tab
 * Reads field configs from page config API so admin can control
 * labels, visibility, and features dynamically.
 */
import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSelector } from 'react-redux';
import { Box, Typography, CircularProgress, Alert } from '@mui/material';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import CampaignIcon from '@mui/icons-material/Campaign';
import LoginIcon from '@mui/icons-material/Login';
import PhoneMissedIcon from '@mui/icons-material/PhoneMissed';
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary';

import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';
import { useGetPublicDoctorProfileConfigQuery } from '../../../admin/api/doctorProfileConfigEndpoints';
import AcceptanceStageSection from '../components/AcceptanceStageSection';
import ExecutionStageSection from '../components/ExecutionStageSection';
import LiveCallStageSection from '../components/LiveCallStageSection';
import PlaceholderSection from '../components/PlaceholderSection';

// Default section definitions — overridden by page config when available
const DEFAULT_SECTIONS = [
    { key: 'acceptance', configVisibleKey: 'acceptance_stage_visible', configLabelKey: 'acceptance_stage_label', defaultLabel: 'Acceptance Stage', icon: <AssignmentTurnedInIcon fontSize="small" /> },
    { key: 'executive', configVisibleKey: 'execution_stage_visible', configLabelKey: 'execution_stage_label', defaultLabel: 'Executive Stage', icon: <BusinessCenterIcon fontSize="small" /> },
    { key: 'live_call', configVisibleKey: 'livecall_stage_visible', configLabelKey: 'livecall_stage_label', defaultLabel: 'Live / Call Stage', icon: <PhoneInTalkIcon fontSize="small" /> },
    { key: 'delivery', configVisibleKey: 'delivery_stage_visible', configLabelKey: 'delivery_stage_label', defaultLabel: 'Delivery / Prescription', icon: <LocalPharmacyIcon fontSize="small" /> },
    { key: 'camp', configVisibleKey: 'camp_stage_visible', configLabelKey: 'camp_stage_label', defaultLabel: 'Doctor in Camp', icon: <CampaignIcon fontSize="small" /> },
    { key: 'login_report',   configVisibleKey: 'login_report_visible',   configLabelKey: 'login_report_label',   defaultLabel: 'Login Report',          icon: <LoginIcon fontSize="small" /> },
    { key: 'no_response',   configVisibleKey: 'no_response_visible',    configLabelKey: 'no_response_label',    defaultLabel: 'No Response',           icon: <PhoneMissedIcon fontSize="small" /> },
    { key: 'asset_library', configVisibleKey: 'asset_library_visible',  configLabelKey: 'asset_library_label',  defaultLabel: 'Asset Library Usage',   icon: <PhotoLibraryIcon fontSize="small" /> },
];

const PLACEHOLDER_DESCRIPTIONS = {
    delivery: 'Track prescription delivery, follow-up instructions, medication dispensing, and post-consultation actions.',
    camp: 'Manage and track doctor participation in health camps, outreach programs, and community events.',
    login_report:   'View login activity reports including session durations, login times, and access patterns.',
    no_response:    'Tracks the number of times the doctor did not respond within each attendance stage (Acceptance, Execution, Live Call, Delivery, Camp). Helps admin monitor responsiveness and SLA breaches per stage.',
    asset_library:  'Tracks how many times the doctor used the asset library (images, videos, documents) to explain a process or issue to a patient during a consultation. Useful for measuring engagement quality.',
};

const AttendanceSection = ({ previewMode = false, registerSave, doctorId: propDoctorId, isAdmin = false }) => {
    const [activeSubTab, setActiveSubTab] = useState(0);
    const { user } = useSelector((state) => state.auth);
    const isUserAdmin = isAdmin || user?.role === 'super_admin' || user?.role === 'sub_admin';

    // Resolve doctor ID
    const { data: myDoctorId, isLoading: loadingMyId } = useGetMyDoctorIdQuery(undefined, {
        skip: !!propDoctorId || isUserAdmin,
    });
    const doctorId = propDoctorId || myDoctorId;

    // Fetch live page config for attendance field configs
    const { data: profileConfig } = useGetPublicDoctorProfileConfigQuery({ userType: 'doctor' });

    // Build a lookup map: field_key → field config
    const fieldConfigMap = useMemo(() => {
        const map = {};
        const fieldConfigs = profileConfig?.field_configs || [];
        for (const fc of fieldConfigs) {
            if (fc.section === 'doctor_attendance') {
                map[fc.field_key] = fc;
            }
        }
        return map;
    }, [profileConfig]);

    // Helper to get config value — returns label or placeholder, respects is_present
    const getLabel = (configLabelKey, defaultLabel) => {
        const fc = fieldConfigMap[configLabelKey];
        if (!fc) return defaultLabel;
        return fc.label || fc.placeholder || defaultLabel;
    };

    const isVisible = (configVisibleKey) => {
        const fc = fieldConfigMap[configVisibleKey];
        if (!fc) return true; // Default visible if not configured
        return fc.is_present !== false;
    };

    const allowRemarks = useMemo(() => {
        const fc = fieldConfigMap['allow_doctor_remarks'];
        if (!fc) return true;
        return fc.is_present !== false;
    }, [fieldConfigMap]);

    // Filter sections by visibility from config
    const visibleSections = useMemo(() => {
        return DEFAULT_SECTIONS.filter((s) => isVisible(s.configVisibleKey)).map((s) => ({
            ...s,
            label: getLabel(s.configLabelKey, s.defaultLabel),
        }));
    }, [fieldConfigMap]);

    // Register no-op save (attendance doesn't need a save button)
    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Attendance & Activity', true);
        }
    }, [registerSave]);

    if (loadingMyId || (!doctorId && !isUserAdmin)) {
        return <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>;
    }

    if (!doctorId) {
        return <Alert severity="warning">Doctor profile not found.</Alert>;
    }

    const activeSection = visibleSections[activeSubTab];

    return (
        <Box>
            {/* Sub-Navigation Buttons */}
            <Box sx={{
                display: 'flex',
                gap: 0,
                mb: 3,
                overflowX: 'auto',
                borderBottom: '2px solid',
                borderColor: 'divider',
            }}>
                {visibleSections.map((section, index) => (
                    <Box
                        key={section.key}
                        onClick={() => setActiveSubTab(index)}
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                            px: 2,
                            py: 1.5,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            fontWeight: activeSubTab === index ? 600 : 400,
                            color: activeSubTab === index ? 'primary.main' : 'text.secondary',
                            borderBottom: activeSubTab === index ? '3px solid' : '3px solid transparent',
                            borderColor: activeSubTab === index ? 'primary.main' : 'transparent',
                            transition: 'all 0.2s',
                            '&:hover': {
                                color: 'primary.main',
                                bgcolor: 'action.hover',
                            },
                        }}
                    >
                        {section.icon}
                        <Typography variant="body2" fontWeight="inherit">
                            {section.label}
                        </Typography>
                    </Box>
                ))}
            </Box>

            {/* Section Content */}
            <Suspense fallback={<Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>}>
                {activeSection?.key === 'acceptance' && (
                    <AcceptanceStageSection
                        doctorId={doctorId}
                        previewMode={previewMode || !allowRemarks}
                        fieldConfigMap={fieldConfigMap}
                    />
                )}
                {activeSection?.key === 'executive' && (
                    <ExecutionStageSection
                        doctorId={doctorId}
                        previewMode={previewMode || !allowRemarks}
                        fieldConfigMap={fieldConfigMap}
                    />
                )}
                {activeSection?.key === 'live_call' && (
                    <LiveCallStageSection
                        doctorId={doctorId}
                        previewMode={previewMode || !allowRemarks}
                        fieldConfigMap={fieldConfigMap}
                    />
                )}
                {activeSection?.key === 'delivery' && (
                    <PlaceholderSection
                        title={getLabel('delivery_stage_label', 'Delivery / Prescription Stage')}
                        description={PLACEHOLDER_DESCRIPTIONS.delivery}
                    />
                )}
                {activeSection?.key === 'camp' && (
                    <PlaceholderSection
                        title={getLabel('camp_stage_label', 'Doctor in Camp')}
                        description={PLACEHOLDER_DESCRIPTIONS.camp}
                    />
                )}
                {activeSection?.key === 'login_report' && (
                    <PlaceholderSection
                        title={getLabel('login_report_label', 'Login Report')}
                        description={PLACEHOLDER_DESCRIPTIONS.login_report}
                    />
                )}
                {activeSection?.key === 'no_response' && (
                    <PlaceholderSection
                        title={getLabel('no_response_label', 'No Response')}
                        description={PLACEHOLDER_DESCRIPTIONS.no_response}
                    />
                )}
                {activeSection?.key === 'asset_library' && (
                    <PlaceholderSection
                        title={getLabel('asset_library_label', 'Asset Library Usage')}
                        description={PLACEHOLDER_DESCRIPTIONS.asset_library}
                    />
                )}
            </Suspense>
        </Box>
    );
};

export default AttendanceSection;
