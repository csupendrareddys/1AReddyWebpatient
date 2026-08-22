import React, { useEffect } from 'react';
import {
    Box, Grid, Paper, Typography, Button, Chip, TextField,
    ToggleButtonGroup, ToggleButton, Checkbox, FormControlLabel, Divider, Alert,
} from '@mui/material';
import GavelIcon from '@mui/icons-material/Gavel';
import VerifiedIcon from '@mui/icons-material/Verified';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import useDeclaration from '../hooks/useDeclaration';
import useDoctorProfilePageConfig from '../hooks/useDoctorProfilePageConfig';
import DocUploadField from '../components/DocUploadField';
import ApprovalChip from '../../../../common/components/ApprovalChip/ApprovalChip';
import { useGetFieldStatusesQuery } from '../../../admin/api/fieldApprovalEndpoints';
import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';

const getVerificationChip = (status) => {
    if (status === 'verified') {
        return <Chip icon={<VerifiedIcon />} label="Verified" color="success" size="small" />;
    }
    if (status === 'rejected') {
        return <Chip label="Rejected" color="error" size="small" />;
    }
    return <Chip label="Pending" color="warning" size="small" variant="outlined" />;
};

const DeclarationSection = React.memo(({ previewMode = false, configOverride = null, registerSave }) => {
    const {
        declarationState,
        handleAnswerChange,
        handleExplanationChange,
        handleAttachmentChange,
        handleDocumentFileChange,
        handleSelfDeclarationChange,
        handleSave,
    } = useDeclaration(previewMode);

    const cfg = useDoctorProfilePageConfig('en', 'doctor', configOverride);

    // Fetch field approval statuses
    const { data: myDoctorId } = useGetMyDoctorIdQuery(undefined, { skip: previewMode });
    const { data: fieldStatusData } = useGetFieldStatusesQuery(
        { entityType: 'doctor', entityId: myDoctorId },
        { skip: previewMode || !myDoctorId }
    );
    const fieldStatuses = fieldStatusData?.field_statuses || {};

    const getFieldApprovalStatus = (fieldName) => {
        const key = `declaration.${fieldName}`;
        return fieldStatuses[key]?.status || null;
    };

    const pendingFields = Object.entries(fieldStatuses)
        .filter(([key, info]) => key.startsWith('declaration.') && (info.status === 'pending' || info.status === 'query'))
        .map(([key, info]) => ({ key, ...info }));

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSave, 'Save Declaration & Documents', declarationState?.isSubmitting);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSave, declarationState?.isSubmitting]);

    const { questions, documentTypes, selfDeclaration } = declarationState;

    return (
        <Box>
            {pendingFields.length > 0 && !previewMode && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight="bold">
                        {pendingFields.length} declaration field(s) waiting for approval
                    </Typography>
                </Alert>
            )}
            {/* Section Header */}
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <GavelIcon color="primary" />
                <Typography variant="h6" fontWeight="bold">
                    Declaration & Documents
                </Typography>
            </Box>

            {/* ── Declaration Questions ──────────────────────────────────── */}
            {questions.length > 0 && (
                <Paper elevation={1} sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                    <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                        Declaration Questions
                    </Typography>

                    {questions.map((q, index) => (
                        <Box key={q.configId} sx={{ mb: 3, pb: index < questions.length - 1 ? 2 : 0, borderBottom: index < questions.length - 1 ? '1px solid #e0e0e0' : 'none' }}>
                            <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                                <Typography variant="body1" fontWeight={500}>
                                    {index + 1}. {q.label}
                                    {q.isRequired && <span style={{ color: 'red' }}> *</span>}
                                </Typography>
                            </Box>
                            {q.description && (
                                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                    {q.description}
                                </Typography>
                            )}

                            {/* Yes / No Toggle */}
                            <ToggleButtonGroup
                                value={q.answer}
                                exclusive
                                onChange={(_, val) => {
                                    if (val !== null) handleAnswerChange(q.configId, val);
                                }}
                                size="small"
                                disabled={previewMode}
                                sx={{ mb: 1.5 }}
                            >
                                <ToggleButton value={true} color="success" sx={{ px: 3 }}>
                                    Yes
                                </ToggleButton>
                                <ToggleButton value={false} color="error" sx={{ px: 3 }}>
                                    No
                                </ToggleButton>
                            </ToggleButtonGroup>

                            {/* Conditional: Explanation + Attachment (shown when answer = Yes) */}
                            {q.answer === true && (
                                <Box sx={{ ml: 2, mt: 1, pl: 2, borderLeft: '3px solid #e0e0e0' }}>
                                    {q.hasExplanation && (
                                        <TextField
                                            fullWidth
                                            size="small"
                                            multiline
                                            minRows={2}
                                            label="Please explain"
                                            value={q.explanation}
                                            onChange={(e) => handleExplanationChange(q.configId, e.target.value)}
                                            disabled={previewMode}
                                            sx={{ mb: 1.5 }}
                                        />
                                    )}
                                    {q.hasAttachment && (
                                        <DocUploadField
                                            fieldName={`question_${q.configId}_attachment`}
                                            label="Attach Supporting Document"
                                            accept="image/*,.pdf,.doc,.docx"
                                            value={q.attachment?.file || q.attachment?.fileUrl || ''}
                                            onChange={(file) => handleAttachmentChange(q.configId, file)}
                                            onClear={() => handleAttachmentChange(q.configId, null)}
                                        />
                                    )}
                                </Box>
                            )}
                        </Box>
                    ))}
                </Paper>
            )}

            {/* ── Self-Declaration Checkboxes ────────────────────────────── */}
            <Paper elevation={1} sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2 }}>
                    Self-Declaration
                </Typography>
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={selfDeclaration.termsAccepted}
                            onChange={(e) => handleSelfDeclarationChange('termsAccepted', e.target.checked)}
                            disabled={previewMode}
                        />
                    }
                    label={
                        <Typography variant="body2">
                            I accept the <strong>Terms & Conditions</strong> and confirm that all information provided is accurate to the best of my knowledge.
                        </Typography>
                    }
                />
                <FormControlLabel
                    control={
                        <Checkbox
                            checked={selfDeclaration.policiesAccepted}
                            onChange={(e) => handleSelfDeclarationChange('policiesAccepted', e.target.checked)}
                            disabled={previewMode}
                        />
                    }
                    label={
                        <Typography variant="body2">
                            I agree to abide by the <strong>Company Policies</strong> and regulations as applicable.
                        </Typography>
                    }
                />
            </Paper>

            {/* ── Upload Documents ────────────────────────────────────────── */}
            {documentTypes.length > 0 && (
                <Paper elevation={1} sx={{ p: 3, mb: 3, borderRadius: 2 }}>
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <UploadFileIcon color="primary" />
                        <Typography variant="subtitle1" fontWeight="bold">
                            Upload Documents
                        </Typography>
                    </Box>

                    <Grid container spacing={3}>
                        {documentTypes.map((doc) => (
                            <Grid item xs={12} sm={6} key={doc.configId}>
                                <Box sx={{ p: 2, border: '1px solid #e0e0e0', borderRadius: 2 }}>
                                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                        <Typography variant="body2" fontWeight={600}>
                                            {doc.label}
                                            {doc.isRequired && <span style={{ color: 'red' }}> *</span>}
                                        </Typography>
                                        {getVerificationChip(doc.file?.verificationStatus)}
                                    </Box>
                                    {doc.description && (
                                        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                                            {doc.description}
                                        </Typography>
                                    )}
                                    <DocUploadField
                                        fieldName={`document_${doc.configId}_file`}
                                        label={`Upload ${doc.label}`}
                                        accept="image/*,.pdf,.doc,.docx"
                                        value={doc.file?.file || doc.file?.fileUrl || ''}
                                        onChange={(file) => handleDocumentFileChange(doc.configId, file)}
                                        onClear={() => handleDocumentFileChange(doc.configId, null)}
                                    />
                                </Box>
                            </Grid>
                        ))}
                    </Grid>
                </Paper>
            )}

            {/* Empty state when no questions or documents configured */}
            {questions.length === 0 && documentTypes.length === 0 && (
                <Paper elevation={0} sx={{ p: 4, textAlign: 'center', bgcolor: '#f5f5f5', borderRadius: 2 }}>
                    <Typography color="text.secondary">
                        No declaration questions or document types have been configured yet.
                        Please contact the administrator.
                    </Typography>
                </Paper>
            )}
        </Box>
    );
});

DeclarationSection.displayName = 'DeclarationSection';
export default DeclarationSection;
