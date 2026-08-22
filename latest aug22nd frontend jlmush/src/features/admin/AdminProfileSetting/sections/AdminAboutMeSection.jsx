import React, { useEffect } from 'react';
import {
    Box, Typography, Paper, Grid, TextField, Chip
} from '@mui/material';
import useAdminAboutMe from '../hooks/useAdminAboutMe';
import useAdminProfilePageConfig from '../hooks/useAdminProfilePageConfig';
import AboutAttachField from '../../../service-provider/ProfileSetting/components/AboutAttachField';

const AdminAboutMeSection = ({ previewMode, configOverride, registerSave }) => {
    const {
        aboutState,
        handleAboutTextChange,
        handleAboutAttachmentChange,
        handleRemoveAboutAttachment,
        handleSaveAbout,
    } = useAdminAboutMe(previewMode);

    const cfg = useAdminProfilePageConfig('en', 'admin', configOverride);

    useEffect(() => {
        registerSave(handleSaveAbout, 'Save About Info', aboutState.isSubmitting);
    }, [registerSave, handleSaveAbout, aboutState.isSubmitting]);

    if (!cfg.isSectionVisible('about_me')) return null;

    return (
        <Box>
            <div className="section-title-bar">{cfg.getSectionLabel('about_me', 'About Me')}</div>
            <Typography variant="body2" color="textSecondary" mb={3}>
                Tell us about yourself, your work, and your current role.
            </Typography>
            <Grid container spacing={3}>
                {/* Brief About */}
                {cfg.isFieldVisible('brief_about_text') && <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{cfg.getFieldLabel('brief_about_text', 'Brief About')}</Typography>
                        <TextField fullWidth multiline rows={4} placeholder="Write a brief introduction about yourself..." value={aboutState.briefAbout.text} onChange={(e) => handleAboutTextChange('briefAbout', e.target.value)} />
                        <Box display="flex" alignItems="center" gap={2} mt={2} flexWrap="wrap">
                            <AboutAttachField
                                fieldName="briefAboutAttachment"
                                attachment={aboutState.briefAbout.attachment}
                                attachmentUrl={aboutState.briefAbout.attachmentUrl}
                                preview={aboutState.briefAbout.preview}
                                attachmentName={aboutState.briefAbout.attachmentName}
                                onChange={(file) => handleAboutAttachmentChange('briefAbout', file)}
                                onClear={() => handleRemoveAboutAttachment('briefAbout')}
                            />
                            <Chip label={aboutState.briefAbout.verificationStatus} size="small" color={aboutState.briefAbout.verificationStatus === 'verified' ? 'success' : 'warning'} sx={{ ml: 'auto' }} />
                        </Box>
                    </Paper>
                </Grid>}

                {/* Nature of Work */}
                {cfg.isFieldVisible('nature_of_work_text') && <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{cfg.getFieldLabel('nature_of_work_text', 'Nature of Work')}</Typography>
                        <TextField fullWidth multiline rows={4} placeholder="Describe the nature of your medical practice..." value={aboutState.natureOfWork.text} onChange={(e) => handleAboutTextChange('natureOfWork', e.target.value)} />
                        <Box display="flex" alignItems="center" gap={2} mt={2} flexWrap="wrap">
                            <AboutAttachField
                                fieldName="natureOfWorkAttachment"
                                attachment={aboutState.natureOfWork.attachment}
                                attachmentUrl={aboutState.natureOfWork.attachmentUrl}
                                preview={aboutState.natureOfWork.preview}
                                attachmentName={aboutState.natureOfWork.attachmentName}
                                onChange={(file) => handleAboutAttachmentChange('natureOfWork', file)}
                                onClear={() => handleRemoveAboutAttachment('natureOfWork')}
                            />
                            <Chip label={aboutState.natureOfWork.verificationStatus} size="small" color={aboutState.natureOfWork.verificationStatus === 'verified' ? 'success' : 'warning'} sx={{ ml: 'auto' }} />
                        </Box>
                    </Paper>
                </Grid>}

                {/* Currently Working With */}
                {cfg.isFieldVisible('currently_working_with_text') && <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{cfg.getFieldLabel('currently_working_with_text', 'Currently Working With')}</Typography>
                        <TextField fullWidth multiline rows={4} placeholder="Where are you currently practicing or affiliated with..." value={aboutState.currentlyWorkingWith.text} onChange={(e) => handleAboutTextChange('currentlyWorkingWith', e.target.value)} />
                        <Box display="flex" alignItems="center" gap={2} mt={2} flexWrap="wrap">
                            <AboutAttachField
                                fieldName="currentlyWorkingWithAttachment"
                                attachment={aboutState.currentlyWorkingWith.attachment}
                                attachmentUrl={aboutState.currentlyWorkingWith.attachmentUrl}
                                preview={aboutState.currentlyWorkingWith.preview}
                                attachmentName={aboutState.currentlyWorkingWith.attachmentName}
                                onChange={(file) => handleAboutAttachmentChange('currentlyWorkingWith', file)}
                                onClear={() => handleRemoveAboutAttachment('currentlyWorkingWith')}
                            />
                            <Chip label={aboutState.currentlyWorkingWith.verificationStatus} size="small" color={aboutState.currentlyWorkingWith.verificationStatus === 'verified' ? 'success' : 'warning'} sx={{ ml: 'auto' }} />
                        </Box>
                    </Paper>
                </Grid>}
            </Grid>
        </Box>
    );
};

const MemoizedAdminAboutMeSection = React.memo(AdminAboutMeSection);
MemoizedAdminAboutMeSection.displayName = 'AdminAboutMeSection';

export default MemoizedAdminAboutMeSection;
