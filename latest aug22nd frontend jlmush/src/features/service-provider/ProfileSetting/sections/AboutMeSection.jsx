import React, { useEffect } from 'react';
import {
    Box, Typography, Paper, Grid, TextField, Chip, Alert, Autocomplete
} from '@mui/material';
import { useGetWorkQualificationsQuery } from '../../../admin/api/marketplaceEndpoints';
import useAboutMe from '../hooks/useAboutMe';

import useDoctorProfilePageConfig from '../hooks/useDoctorProfilePageConfig';
import AboutAttachField from '../components/AboutAttachField';
import ApprovalChip from '../../../../common/components/ApprovalChip/ApprovalChip';
import { useGetFieldStatusesQuery } from '../../../admin/api/fieldApprovalEndpoints';
import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';
// Mirrors ProfileAbout.EXPERIENCE_COLUMN_BY_LEVEL on the backend.
const EXPERIENCE_LEVELS = [
    { field: 'ugYears', label: 'UG experience (years)' },
    { field: 'pgYears', label: 'PG experience (years)' },
    { field: 'superSpecialityYears', label: 'Super-speciality experience (years)' },
];

const AboutMeSection = ({ previewMode, configOverride, registerSave }) => {
    const {
        aboutState,
        handleAboutTextChange,
        handleAboutAttachmentChange,
        handleRemoveAboutAttachment,
        handleWorkQualificationChange,
        handleWorkQualificationsChange,
        handleExperienceChange,
        handleSaveAbout,
    } = useAboutMe();

    const cfg = useDoctorProfilePageConfig(configOverride);

    const { data: workQualifications = [] } = useGetWorkQualificationsQuery(undefined, { skip: previewMode });
    // Resolve the stored id against the fetched list, falling back to the name
    // the server sent so the field still reads correctly if the option list
    // hasn't loaded (or the option was since deactivated).
    const selectedWorkQualification = React.useMemo(() => {
        const id = aboutState.workQualification?.id;
        if (!id) return null;
        return workQualifications.find((w) => String(w.id) === String(id))
            || { id, name: aboutState.workQualification.name || '' };
    }, [workQualifications, aboutState.workQualification]);

    // Multi work qualifications — resolve stored ids against the option list,
    // falling back to the stored name so the chips read correctly before the
    // options load.
    const selectedWorkQualifications = React.useMemo(() => {
        return (aboutState.workQualifications || []).map((w) =>
            workQualifications.find((o) => String(o.id) === String(w.id))
            || { id: String(w.id), name: w.name || '' }
        );
    }, [workQualifications, aboutState.workQualifications]);

    // Fetch field approval statuses
    const { data: myDoctorId } = useGetMyDoctorIdQuery(undefined, { skip: previewMode });
    const { data: fieldStatusData } = useGetFieldStatusesQuery(
        { entityType: 'doctor', entityId: myDoctorId },
        { skip: previewMode || !myDoctorId }
    );
    const fieldStatuses = fieldStatusData?.field_statuses || {};

    // The backend raises these under section 'about_me' (matching the admin
    // approval queue's PROFILE_SECTIONS), so the status keys are
    // `about_me.<field>` — not `about.<field>`.
    const getFieldApprovalStatus = (fieldName) => {
        const key = `about_me.${fieldName}`;
        return fieldStatuses[key]?.status || null;
    };

    const pendingFields = Object.entries(fieldStatuses)
        .filter(([key, info]) => key.startsWith('about_me.') && (info.status === 'pending' || info.status === 'query'))
        .map(([key, info]) => ({ key, ...info }));

    useEffect(() => {
        registerSave(handleSaveAbout, 'Save About Info', aboutState.isSubmitting);
    }, [registerSave, handleSaveAbout, aboutState.isSubmitting]);

    if (!cfg.isSectionVisible('about_me')) return null;

    return (
        <Box>
            {pendingFields.length > 0 && !previewMode && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight="bold">
                        {pendingFields.length} about field(s) waiting for approval
                    </Typography>
                </Alert>
            )}
            <div className="section-title-bar">{cfg.getSectionLabel('about_me', 'About Me')}</div>
            <Typography variant="body2" color="textSecondary" mb={3}>
                Tell patients about yourself, your work, and where you currently practice.
            </Typography>
            <Grid container spacing={3}>
                {/* Brief About */}
                {cfg.isFieldVisible('brief_about_text') && <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{cfg.getFieldLabel('brief_about_text', 'Brief About')}</Typography>
                            <ApprovalChip status={getFieldApprovalStatus('brief_about')} />
                        </Box>
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
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{cfg.getFieldLabel('nature_of_work_text', 'Nature of Work')}</Typography>
                            <ApprovalChip status={getFieldApprovalStatus('nature_of_work')} />
                        </Box>
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
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>{cfg.getFieldLabel('currently_working_with_text', 'Currently Working With')}</Typography>
                            <ApprovalChip status={getFieldApprovalStatus('currently_working_with')} />
                        </Box>
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

                {/* Work Qualifications — MULTI pick from the admin-curated list.
                    The first chip is the primary (shown on the public booking
                    card, and how the booking widget groups doctors). */}
                <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Box display="flex" alignItems="center" gap={1}>
                            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                                Work Qualifications
                            </Typography>
                        </Box>
                        <Autocomplete
                            multiple
                            options={workQualifications}
                            getOptionLabel={(o) => o.name || ''}
                            isOptionEqualToValue={(o, v) => String(o.id) === String(v.id)}
                            value={selectedWorkQualifications}
                            onChange={(_, vals) => handleWorkQualificationsChange(
                                (vals || []).map((v) => ({ id: String(v.id), name: v.name }))
                            )}
                            renderInput={(params) => (
                                <TextField {...params}
                                    placeholder="Select your work qualifications"
                                    helperText="Pick one or more from the list your admin maintains. The first is your primary — it's what the public booking shows and groups you under. Changes need approval." />
                            )}
                        />
                    </Paper>
                </Grid>

                {/* Work Experience per education level */}
                <Grid item xs={12}>
                    <Paper sx={{ p: 3 }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Work Experience
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            Years worked at each level of your qualification. Leave a level blank if
                            it does not apply — some services are only offered to doctors with a
                            minimum experience.
                        </Typography>
                        <Grid container spacing={2}>
                            {EXPERIENCE_LEVELS.map(({ field, label }) => (
                                <Grid item xs={12} sm={4} key={field}>
                                    <TextField
                                        fullWidth type="number" label={label}
                                        value={aboutState.experience?.[field] ?? ''}
                                        onChange={(e) => handleExperienceChange(field, e.target.value)}
                                        inputProps={{ min: 0, max: 80 }}
                                        placeholder="Not stated"
                                    />
                                </Grid>
                            ))}
                        </Grid>
                        <Box display="flex" alignItems="center" mt={2}>
                            <Chip
                                label={aboutState.experience?.verificationStatus || 'pending'}
                                size="small"
                                color={aboutState.experience?.verificationStatus === 'verified' ? 'success' : 'warning'}
                                sx={{ ml: 'auto' }}
                            />
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

const MemoizedAboutMeSection = React.memo(AboutMeSection);
MemoizedAboutMeSection.displayName = 'AboutMeSection';

export default MemoizedAboutMeSection;
