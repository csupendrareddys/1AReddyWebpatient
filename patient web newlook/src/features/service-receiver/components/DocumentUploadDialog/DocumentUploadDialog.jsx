import { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    TextField,
    MenuItem,
    CircularProgress,
    Alert,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const documentTypes = [
    { value: 'report', label: 'Medical Report' },
    { value: 'lab_result', label: 'Lab Result' },
    { value: 'prescription', label: 'Prescription' },
    { value: 'imaging', label: 'X-Ray / MRI / CT Scan' },
    { value: 'insurance', label: 'Insurance Document' },
    { value: 'other', label: 'Other' },
];

const DocumentUploadDialog = ({ open, onClose, onSubmit, loading = false, error = null }) => {
    const [documentName, setDocumentName] = useState('');
    const [attachmentLink, setAttachmentLink] = useState('');
    const [description, setDescription] = useState('');
    const [documentType, setDocumentType] = useState('');

    const handleSubmit = () => {
        if (documentName && attachmentLink) {
            onSubmit({
                document_name: documentName,
                attachment_link: attachmentLink,
                description: description || undefined,
                document_type: documentType || undefined,
            });
        }
    };

    const handleClose = () => {
        setDocumentName('');
        setAttachmentLink('');
        setDescription('');
        setDocumentType('');
        onClose();
    };

    const isValid = documentName.trim() !== '' && attachmentLink.trim() !== '';

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle component="div">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <AttachFileIcon color="primary" />
                    <Typography variant="h6">Upload Document</Typography>
                </Box>
            </DialogTitle>
            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                <Box sx={{ mt: 2 }}>
                    <TextField
                        fullWidth
                        required
                        label="Document Name"
                        placeholder="e.g., Blood Test Report"
                        value={documentName}
                        onChange={(e) => setDocumentName(e.target.value)}
                        variant="outlined"
                        sx={{ mb: 2 }}
                    />

                    <TextField
                        fullWidth
                        required
                        label="Document Link"
                        placeholder="https://drive.google.com/..."
                        value={attachmentLink}
                        onChange={(e) => setAttachmentLink(e.target.value)}
                        variant="outlined"
                        helperText="Paste a link to your document (Google Drive, Dropbox, etc.)"
                        sx={{ mb: 2 }}
                    />

                    <TextField
                        fullWidth
                        select
                        label="Document Type"
                        value={documentType}
                        onChange={(e) => setDocumentType(e.target.value)}
                        variant="outlined"
                        sx={{ mb: 2 }}
                    >
                        <MenuItem value="">
                            <em>Select type (optional)</em>
                        </MenuItem>
                        {documentTypes.map((type) => (
                            <MenuItem key={type.value} value={type.value}>
                                {type.label}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        fullWidth
                        multiline
                        rows={3}
                        label="Description (optional)"
                        placeholder="Any additional notes about this document..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        variant="outlined"
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={handleClose} disabled={loading}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={!isValid || loading}
                    startIcon={loading ? <CircularProgress size={20} /> : <CloudUploadIcon />}
                >
                    {loading ? 'Uploading...' : 'Upload Document'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DocumentUploadDialog;
