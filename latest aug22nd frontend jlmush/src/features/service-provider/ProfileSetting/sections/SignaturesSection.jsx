import React, { useState, useEffect } from 'react';
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
import DrawIcon from '@mui/icons-material/Draw';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import useSignatures from '../hooks/useSignatures';
import useDoctorProfilePageConfig from '../hooks/useDoctorProfilePageConfig';
import ApprovalChip from '../../../../common/components/ApprovalChip/ApprovalChip';
import { useGetFieldStatusesQuery } from '../../../admin/api/fieldApprovalEndpoints';
import { useGetMyDoctorIdQuery } from '../../api/scopedDoctorApi';
import CreateSignatureDialog from '../components/CreateSignatureDialog';

// Each signature card is locked to one input method
const SIGNATURE_CARDS = [
    {
        key: 'signature1',
        label: 'Signature (Image)',
        mode: 'image',
        icon: <CloudUploadIcon />,
        description: 'Upload an image of your signature',
        fieldStatusKey: 'signature1',
    },
    {
        key: 'signature2',
        label: 'Signature (Draw)',
        mode: 'draw',
        icon: <DrawIcon />,
        description: 'Sign using touch or mouse',
        fieldStatusKey: 'signature2',
    },
    {
        key: 'digitalSignature',
        label: 'Digital Signature (Type)',
        mode: 'type',
        icon: <TextFieldsIcon />,
        description: 'Type your signature in cursive font',
        fieldStatusKey: 'digital_signature',
    },
];

const SignaturesSection = React.memo(({ previewMode = false, configOverride, registerSave }) => {
    const {
        signaturesState,
        handleSignatureFileChange,
        handleRemoveSignature,
        handleSaveSignatures,
    } = useSignatures(previewMode);

    const cfg = useDoctorProfilePageConfig(configOverride);

    // Fetch field approval statuses
    const { data: myDoctorId } = useGetMyDoctorIdQuery(undefined, { skip: previewMode });
    const { data: fieldStatusData } = useGetFieldStatusesQuery(
        { entityType: 'doctor', entityId: myDoctorId },
        { skip: previewMode || !myDoctorId }
    );
    const fieldStatuses = fieldStatusData?.field_statuses || {};

    // Dialog state
    const [dialogOpen, setDialogOpen] = useState(false);
    const [activeCard, setActiveCard] = useState(null); // { key, mode }

    const openDialog = (card) => {
        setActiveCard(card);
        setDialogOpen(true);
    };

    const handleDialogSave = (file) => {
        if (activeCard) {
            handleSignatureFileChange(activeCard.key, file);
        }
    };

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
            <div className="section-title-bar">{cfg.getSectionLabel('signatures', 'Signatures')}</div>
            <Typography variant="body2" color="textSecondary" mb={3}>
                All three signatures are required for verification — upload an image, draw by hand, and type your signature.
            </Typography>
            <Grid container spacing={3}>
                {SIGNATURE_CARDS.map((card) => {
                    const sig = signaturesState[card.key];
                    const hasSignature = sig?.preview || sig?.fileUrl;

                    return (
                        <Grid item xs={12} md={4} key={card.key}>
                            <Paper sx={{ p: 3, textAlign: 'center' }}>
                                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                                    {card.label}{' '}
                                    <Chip label="Required" size="small" color="error" sx={{ ml: 1 }} />
                                    <ApprovalChip status={getFieldApprovalStatus(card.fieldStatusKey)} />
                                </Typography>
                                <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 2 }}>
                                    {card.description}
                                </Typography>

                                {hasSignature ? (
                                    <Box sx={{ mb: 2 }}>
                                        <img
                                            src={sig.preview || sig.fileUrl}
                                            alt={card.label}
                                            style={{
                                                maxWidth: '100%',
                                                maxHeight: 150,
                                                objectFit: 'contain',
                                                border: '1px solid #eee',
                                                borderRadius: 4,
                                            }}
                                        />
                                        <Typography variant="caption" display="block" color="textSecondary">
                                            {sig.fileName || 'Uploaded'}
                                        </Typography>
                                        <Chip
                                            label={sig.verificationStatus}
                                            size="small"
                                            color={sig.verificationStatus === 'verified' ? 'success' : 'warning'}
                                            sx={{ mt: 1 }}
                                        />
                                    </Box>
                                ) : (
                                    <Box sx={{ mb: 2, p: 3, border: '2px dashed #ccc', borderRadius: 2 }}>
                                        <Box sx={{ color: '#ccc', mb: 1 }}>
                                            {React.cloneElement(card.icon, { sx: { fontSize: 48, color: '#ccc' } })}
                                        </Box>
                                        <Typography variant="body2" color="textSecondary">No signature yet</Typography>
                                    </Box>
                                )}

                                <Box display="flex" gap={1} justifyContent="center" flexWrap="wrap">
                                    {hasSignature ? (
                                        <>
                                            <Tooltip title="Edit this signature">
                                                <Button
                                                    variant="outlined"
                                                    startIcon={<EditIcon />}
                                                    size="small"
                                                    color="warning"
                                                    sx={{ textTransform: 'none' }}
                                                    onClick={() => openDialog(card)}
                                                >
                                                    Edit
                                                </Button>
                                            </Tooltip>
                                            <Tooltip title="Clear and redo">
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    startIcon={<ReplayIcon />}
                                                    color="error"
                                                    sx={{ textTransform: 'none' }}
                                                    onClick={() => {
                                                        handleRemoveSignature(card.key);
                                                        openDialog(card);
                                                    }}
                                                >
                                                    Re-do
                                                </Button>
                                            </Tooltip>
                                        </>
                                    ) : (
                                        <Button
                                            variant="outlined"
                                            startIcon={card.icon}
                                            size="small"
                                            onClick={() => openDialog(card)}
                                        >
                                            {card.mode === 'image' ? 'Upload' : card.mode === 'draw' ? 'Draw' : 'Type'}
                                        </Button>
                                    )}
                                </Box>
                            </Paper>
                        </Grid>
                    );
                })}
            </Grid>

            {/* Single-mode Signature Dialog */}
            <CreateSignatureDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSave={handleDialogSave}
                mode={activeCard?.mode || 'draw'}
            />
        </Box>
    );
});

SignaturesSection.displayName = 'SignaturesSection';
export default SignaturesSection;
