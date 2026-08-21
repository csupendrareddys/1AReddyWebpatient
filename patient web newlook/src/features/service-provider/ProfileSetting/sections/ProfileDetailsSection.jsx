import React, { useState, useCallback, lazy, Suspense } from 'react';
import { useSelector } from 'react-redux';
import { Box, Button, CircularProgress } from '@mui/material';

const PersonalProfessionalSection = lazy(() => import('./PersonalProfessionalSection'));
const SignaturesSection = lazy(() => import('./SignaturesSection'));
const AboutMeSection = lazy(() => import('./AboutMeSection'));
const EducationSection = lazy(() => import('./EducationSection'));
const BankDetailsSection = lazy(() => import('./BankDetailsSection'));
const DeclarationSection = lazy(() => import('./DeclarationSection'));

const ProfileDetailsSection = React.memo(({
    previewMode = false, configOverride = null, registerSave,
    // Which sub-tabs this viewer may open, by index — the same contract
    // ``ProfileSetting`` uses for its top tabs, and forwarded from there. A
    // My Link Employee holds the profile but never the doctor's bank details.
    allowSubTab = () => true,
}) => {
    const [profileSubTab, setProfileSubTab] = useState(0);

    // Clinic/hospital accounts borrow this doctor page for their authorized
    // person, so the first sub-tab is that person's details — not a doctor's.
    const userRole = useSelector((s) => s?.auth?.user?.role);
    const isFacility = userRole === 'clinic' || userRole === 'hospital';
    const subTabLabels = [
        isFacility ? 'Authorized Person Profile Details' : 'Personal & Professional Details',
        'Signatures & Pricing', 'About Me', 'Education Details', 'Bank Details', 'Declaration & Documents',
    ];

    // Forward registerSave to the active sub-section
    // Each sub-section calls registerSave with its own save handler
    // When the sub-tab changes, the new section re-registers

    return (
        <Box>
            {/* Sub-navigation bar */}
            <Box
                sx={{
                    display: 'flex',
                    gap: 1,
                    mb: 3,
                    borderBottom: '2px solid #e0e0e0',
                    pb: 0,
                }}
            >
                {subTabLabels.map((label, idx) => (
                    <Button
                        key={label}
                        onClick={() => setProfileSubTab(idx)}
                        variant="text"
                        disableRipple
                        sx={{
                            // Hidden, not removed — these indices are
                            // positional and resequencing them would silently
                            // repoint the content below.
                            display: allowSubTab(idx) ? undefined : 'none',
                            borderRadius: 0,
                            borderBottom: profileSubTab === idx ? '3px solid' : '3px solid transparent',
                            borderColor: profileSubTab === idx ? 'primary.main' : 'transparent',
                            color: profileSubTab === idx ? 'primary.main' : 'text.secondary',
                            fontWeight: profileSubTab === idx ? 700 : 500,
                            px: 2,
                            pb: 1,
                            mb: '-2px',
                            textTransform: 'none',
                            fontSize: '0.95rem',
                            '&:hover': {
                                background: 'transparent',
                                color: 'primary.main',
                            },
                        }}
                    >
                        {label}
                    </Button>
                ))}
            </Box>

            {/* Sub-tab content — lazy loaded, only active sub-tab mounted */}
            <Suspense fallback={<Box display="flex" justifyContent="center" py={4}><CircularProgress /></Box>}>
                {profileSubTab === 0 && (
                    <PersonalProfessionalSection
                        previewMode={previewMode}
                        configOverride={configOverride}
                        registerSave={registerSave}
                    />
                )}
                {profileSubTab === 1 && (
                    <SignaturesSection
                        previewMode={previewMode}
                        configOverride={configOverride}
                        registerSave={registerSave}
                    />
                )}
                {profileSubTab === 2 && (
                    <AboutMeSection
                        previewMode={previewMode}
                        configOverride={configOverride}
                        registerSave={registerSave}
                    />
                )}
                {profileSubTab === 3 && (
                    <EducationSection
                        previewMode={previewMode}
                        configOverride={configOverride}
                        registerSave={registerSave}
                    />
                )}
                {profileSubTab === 4 && allowSubTab(4) && (
                    <BankDetailsSection
                        previewMode={previewMode}
                        configOverride={configOverride}
                        registerSave={registerSave}
                    />
                )}
                {profileSubTab === 5 && (
                    <DeclarationSection
                        previewMode={previewMode}
                        configOverride={configOverride}
                        registerSave={registerSave}
                    />
                )}
            </Suspense>
        </Box>
    );
});

ProfileDetailsSection.displayName = 'ProfileDetailsSection';
export default ProfileDetailsSection;
