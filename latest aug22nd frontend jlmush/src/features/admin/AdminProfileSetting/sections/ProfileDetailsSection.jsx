/**
 * Admin ProfileDetailsSection — Container for sub-sections.
 * Structurally identical to the doctor's ProfileDetailsSection.
 * All sub-fields (Personal, Signatures, About, Education, Bank, Declaration) are fully functional.
 */
import React, { useState, useCallback, lazy, Suspense } from 'react';
import { Box, Button, CircularProgress } from '@mui/material';

const PersonalProfessionalSection = lazy(() => import('./AdminPersonalProfessionalSection'));
const SignaturesSection = lazy(() => import('./AdminSignaturesSection'));
const AboutMeSection = lazy(() => import('./AdminAboutMeSection'));
const EducationSection = lazy(() => import('./AdminEducationSection'));
const BankDetailsSection = lazy(() => import('./AdminBankDetailsSection'));
const DeclarationSection = lazy(() => import('./AdminDeclarationSection'));

const ProfileDetailsSection = React.memo(({ previewMode = false, configOverride = null, registerSave }) => {
    const [profileSubTab, setProfileSubTab] = useState(0);

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
                {['Personal & Professional Details', 'Signatures & Pricing', 'About Me', 'Education Details', 'Bank Details', 'Declaration & Documents'].map((label, idx) => (
                    <Button
                        key={label}
                        onClick={() => setProfileSubTab(idx)}
                        variant="text"
                        disableRipple
                        sx={{
                            borderRadius: 0,
                            borderBottom: profileSubTab === idx ? '3px solid' : '3px solid transparent',
                            borderColor: profileSubTab === idx ? 'primary.main' : 'transparent',
                            color: profileSubTab === idx ? 'primary.main' : 'text.secondary',
                            fontWeight: profileSubTab === idx ? 600 : 400,
                            textTransform: 'none',
                            px: 2,
                            py: 1.5,
                            minWidth: 'auto',
                            transition: 'all 0.2s',
                            '&:hover': { backgroundColor: 'action.hover' },
                        }}
                    >
                        {label}
                    </Button>
                ))}
            </Box>

            {/* Sub-section content */}
            <Suspense fallback={<Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>}>
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
                {profileSubTab === 4 && (
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

ProfileDetailsSection.displayName = 'AdminProfileDetailsSection';

export default ProfileDetailsSection;
