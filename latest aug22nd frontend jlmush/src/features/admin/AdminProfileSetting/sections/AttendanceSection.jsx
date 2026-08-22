/**
 * Admin AttendanceSection — Placeholder only (no backend interaction).
 * Mirrors the doctor's Attendance & Activity tab structure with sub-stages.
 */
import { useState, useEffect } from 'react';
import { Box, Paper, Typography, Chip } from '@mui/material';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import BusinessCenterIcon from '@mui/icons-material/BusinessCenter';
import PhoneInTalkIcon from '@mui/icons-material/PhoneInTalk';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import CampaignIcon from '@mui/icons-material/Campaign';
import LoginIcon from '@mui/icons-material/Login';
import ConstructionIcon from '@mui/icons-material/Construction';

const PLACEHOLDER_STAGES = [
    { key: 'acceptance', label: 'Acceptance Stage', icon: <AssignmentTurnedInIcon fontSize="small" />, description: 'Track appointment acceptance, auto-approvals, rejections, and rescheduling activity.' },
    { key: 'execution', label: 'Execution Stage', icon: <BusinessCenterIcon fontSize="small" />, description: 'Monitor attended appointments, missed appointments by doctor/patient, and technical failures.' },
    { key: 'live_call', label: 'Live / Call Stage', icon: <PhoneInTalkIcon fontSize="small" />, description: 'View live call activity including video, audio, and chat consultation breakdowns.' },
    { key: 'delivery', label: 'Delivery / Prescription', icon: <LocalPharmacyIcon fontSize="small" />, description: 'Track prescription delivery, follow-up instructions, and post-consultation actions.' },
    { key: 'camp', label: 'Camp Activity', icon: <CampaignIcon fontSize="small" />, description: 'Manage participation in health camps, outreach programs, and community events.' },
    { key: 'login_report', label: 'Login Report', icon: <LoginIcon fontSize="small" />, description: 'View login activity reports including session durations and access patterns.' },
];

const AttendanceSection = ({ previewMode = false, registerSave }) => {
    const [activeSubTab, setActiveSubTab] = useState(0);

    useEffect(() => {
        if (registerSave) {
            registerSave(null, 'Attendance & Activity', true);
        }
    }, [registerSave]);

    const activeStage = PLACEHOLDER_STAGES[activeSubTab];

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
                {PLACEHOLDER_STAGES.map((stage, index) => (
                    <Box
                        key={stage.key}
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
                        {stage.icon}
                        <Typography variant="body2" fontWeight="inherit">
                            {stage.label}
                        </Typography>
                    </Box>
                ))}
            </Box>

            {/* Placeholder content for active stage */}
            <Paper sx={{ p: 6, textAlign: 'center' }}>
                <Chip label="Placeholder" size="small" color="warning" variant="outlined" sx={{ mb: 2 }} />
                <ConstructionIcon sx={{ fontSize: 64, color: 'grey.400', mb: 2, display: 'block', mx: 'auto' }} />
                <Typography variant="h5" fontWeight={600} color="text.secondary" gutterBottom>
                    {activeStage.label}
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500, mx: 'auto' }}>
                    {activeStage.description}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2, fontStyle: 'italic' }}>
                    This module is a placeholder. Backend endpoints and database interaction will be implemented when this feature is activated.
                </Typography>
            </Paper>
        </Box>
    );
};

export default AttendanceSection;
