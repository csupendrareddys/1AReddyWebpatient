import React, { useEffect } from 'react';
import {
    Box,
    Grid,
    Paper,
    Typography,
    Button,
    Chip,
    Tooltip,
    Alert,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EditIcon from '@mui/icons-material/Edit';
import ReplayIcon from '@mui/icons-material/Replay';
import useAdminSignatures from '../hooks/useAdminSignatures';
import useAdminProfilePageConfig from '../hooks/useAdminProfilePageConfig';
import ApprovalChip from '../../../../common/components/ApprovalChip/ApprovalChip';
import { useGetFieldStatusesQuery } from '../../../admin/api/fieldApprovalEndpoints';
import { useGetAdminMyProfileQuery } from '../../../admin/api/adminProfileConfigEndpoints';

const AdminSignaturesSection = React.memo(({ previewMode = false, configOverride, registerSave }) => {
    const {
        signaturesState,
        handleSignatureFileChange,
        handleRemoveSignature,
        handleSaveSignatures,
    } = useAdminSignatures(previewMode);

    const cfg = useAdminProfilePageConfig('en', 'admin', configOverride);

    // Fetch field approval statuses
    const { data: adminProfile } = useGetAdminMyProfileQuery(undefined, { skip: previewMode });
    const adminId = adminProfile?.id;
    const { data: fieldStatusData } = useGetFieldStatusesQuery(
        { entityType: 'admin', entityId: adminId },
        { skip: previewMode || !adminId }
    );
    const fieldStatuses = fieldStatusData?.field_statuses || {};

    const getFieldApprovalStatus = (fieldName) => {
        const key = `signatures.${fieldName}`;
        return fieldStatuses[key]?.status || null;
    };

    const pendingFields = Object.entries(fieldStatuses)
        .filter(([key, info]) => key.startsWith('signatures.') && (info.status === 'pending' || info.status === 'query'))
        .map(([key, info]) => ({ key, ...info }));

    useEffect(() => {
        if (registerSave) {
            registerSave(handleSaveSignatures, 'Save & Request Verification', signaturesState.isSubmitting);
            return () => registerSave(null, 'Save', false);
        }
    }, [registerSave, handleSaveSignatures, signaturesState.isSubmitting]);

    if (!cfg.isSectionVisible('signatures')) return null;

    return (
        <Box>
            {pendingFields.length > 0 && !previewMode && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="body2" fontWeight="bold">
                        {pendingFields.length} signature field(s) waiting for approval
                    </Typography>
                </Alert>
            )}
            <div className="section-title-bar">{cfg.getSectionLabel('signatures', 'Signatures & Pricing')}</div>
            <Typography variant="body2" color="textSecondary" mb={3}>
                Upload your signatures for verification. Signature 1 and Digital Signature are required.
            </Typography>
            <Grid container spacing={3}>
                {/* Signature 1 */}
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 3, textAlign: 'center' }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Signature 1 <Chip label="Required" size="small" color="error" sx={{ ml: 1 }} />
                        </Typography>
                        {(signaturesState.signature1.preview || signaturesState.signature1.fileUrl) ? (
                            <Box sx={{ mb: 2 }}>
                                <img src={signaturesState.signature1.preview || signaturesState.signature1.fileUrl} alt="Signature 1" style={{ maxWidth: '100%', maxHeight: 150, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4 }} />
                                <Typography variant="caption" display="block" color="textSecondary">{signaturesState.signature1.fileName || 'Uploaded'}</Typography>
                                <Chip label={signaturesState.signature1.verificationStatus} size="small" color={signaturesState.signature1.verificationStatus === 'verified' ? 'success' : 'warning'} sx={{ mt: 1 }} />
                            </Box>
                        ) : (
                            <Box sx={{ mb: 2, p: 3, border: '2px dashed #ccc', borderRadius: 2 }}>
                                <CloudUploadIcon sx={{ fontSize: 48, color: '#ccc' }} />
                                <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                            </Box>
                        )}
                        <Box display="flex" gap={1} justifyContent="center" flexWrap="wrap">
                            {(signaturesState.signature1.preview || signaturesState.signature1.fileUrl) ? (
                                <>
                                    <Tooltip title="Pick a replacement (keeps current until saved)">
                                        <Button variant="outlined" component="label" startIcon={<EditIcon />} size="small" color="warning" sx={{ textTransform: 'none' }}>
                                            Edit
                                            <input type="file" hidden accept="image/*" onChange={(e) => handleSignatureFileChange('signature1', e.target.files[0])} />
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="Clear and upload a new signature">
                                        <Button variant="outlined" size="small" startIcon={<ReplayIcon />} color="error" sx={{ textTransform: 'none' }}
                                            onClick={() => handleRemoveSignature('signature1')}>
                                            Re-upload
                                        </Button>
                                    </Tooltip>
                                </>
                            ) : (
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*" onChange={(e) => handleSignatureFileChange('signature1', e.target.files[0])} />
                                </Button>
                            )}
                        </Box>
                    </Paper>
                </Grid>

                {/* Signature 2 */}
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 3, textAlign: 'center' }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Signature 2 <Chip label="Optional" size="small" variant="outlined" sx={{ ml: 1 }} />
                        </Typography>
                        {(signaturesState.signature2.preview || signaturesState.signature2.fileUrl) ? (
                            <Box sx={{ mb: 2 }}>
                                <img src={signaturesState.signature2.preview || signaturesState.signature2.fileUrl} alt="Signature 2" style={{ maxWidth: '100%', maxHeight: 150, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4 }} />
                                <Typography variant="caption" display="block" color="textSecondary">{signaturesState.signature2.fileName || 'Uploaded'}</Typography>
                                <Chip label={signaturesState.signature2.verificationStatus} size="small" color={signaturesState.signature2.verificationStatus === 'verified' ? 'success' : 'warning'} sx={{ mt: 1 }} />
                            </Box>
                        ) : (
                            <Box sx={{ mb: 2, p: 3, border: '2px dashed #ccc', borderRadius: 2 }}>
                                <CloudUploadIcon sx={{ fontSize: 48, color: '#ccc' }} />
                                <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                            </Box>
                        )}
                        <Box display="flex" gap={1} justifyContent="center" flexWrap="wrap">
                            {(signaturesState.signature2.preview || signaturesState.signature2.fileUrl) ? (
                                <>
                                    <Tooltip title="Pick a replacement">
                                        <Button variant="outlined" component="label" startIcon={<EditIcon />} size="small" color="warning" sx={{ textTransform: 'none' }}>
                                            Edit
                                            <input type="file" hidden accept="image/*" onChange={(e) => handleSignatureFileChange('signature2', e.target.files[0])} />
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="Clear and upload a new signature">
                                        <Button variant="outlined" size="small" startIcon={<ReplayIcon />} color="error" sx={{ textTransform: 'none' }}
                                            onClick={() => handleRemoveSignature('signature2')}>
                                            Re-upload
                                        </Button>
                                    </Tooltip>
                                </>
                            ) : (
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*" onChange={(e) => handleSignatureFileChange('signature2', e.target.files[0])} />
                                </Button>
                            )}
                        </Box>
                    </Paper>
                </Grid>

                {/* Digital Signature */}
                <Grid item xs={12} md={4}>
                    <Paper sx={{ p: 3, textAlign: 'center' }}>
                        <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                            Digital Signature <Chip label="Required" size="small" color="error" sx={{ ml: 1 }} />
                        </Typography>
                        {(signaturesState.digitalSignature.preview || signaturesState.digitalSignature.fileUrl) ? (
                            <Box sx={{ mb: 2 }}>
                                <img src={signaturesState.digitalSignature.preview || signaturesState.digitalSignature.fileUrl} alt="Digital Signature" style={{ maxWidth: '100%', maxHeight: 150, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4 }} />
                                <Typography variant="caption" display="block" color="textSecondary">{signaturesState.digitalSignature.fileName || 'Uploaded'}</Typography>
                                <Chip label={signaturesState.digitalSignature.verificationStatus} size="small" color={signaturesState.digitalSignature.verificationStatus === 'verified' ? 'success' : 'warning'} sx={{ mt: 1 }} />
                            </Box>
                        ) : (
                            <Box sx={{ mb: 2, p: 3, border: '2px dashed #ccc', borderRadius: 2 }}>
                                <CloudUploadIcon sx={{ fontSize: 48, color: '#ccc' }} />
                                <Typography variant="body2" color="textSecondary">No file uploaded</Typography>
                            </Box>
                        )}
                        <Box display="flex" gap={1} justifyContent="center" flexWrap="wrap">
                            {(signaturesState.digitalSignature.preview || signaturesState.digitalSignature.fileUrl) ? (
                                <>
                                    <Tooltip title="Pick a replacement">
                                        <Button variant="outlined" component="label" startIcon={<EditIcon />} size="small" color="warning" sx={{ textTransform: 'none' }}>
                                            Edit
                                            <input type="file" hidden accept="image/*" onChange={(e) => handleSignatureFileChange('digitalSignature', e.target.files[0])} />
                                        </Button>
                                    </Tooltip>
                                    <Tooltip title="Clear and upload a new signature">
                                        <Button variant="outlined" size="small" startIcon={<ReplayIcon />} color="error" sx={{ textTransform: 'none' }}
                                            onClick={() => handleRemoveSignature('digitalSignature')}>
                                            Re-upload
                                        </Button>
                                    </Tooltip>
                                </>
                            ) : (
                                <Button variant="outlined" component="label" startIcon={<CloudUploadIcon />} size="small">
                                    Upload
                                    <input type="file" hidden accept="image/*" onChange={(e) => handleSignatureFileChange('digitalSignature', e.target.files[0])} />
                                </Button>
                            )}
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
});

AdminSignaturesSection.displayName = 'AdminSignaturesSection';
export default AdminSignaturesSection;
