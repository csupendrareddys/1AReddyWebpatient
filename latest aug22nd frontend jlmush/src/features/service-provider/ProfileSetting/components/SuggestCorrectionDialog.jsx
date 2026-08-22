/**
 * SuggestCorrectionDialog — Remarks & attachment editor for a single metric.
 * Doctor can ONLY submit remarks and attachments — NOT change the value.
 * Value corrections are decided by admin after reviewing the request.
 * Saves to LOCAL state only. Actual submission happens on group Confirm.
 */
import { useState, useEffect, useRef } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, Typography, Alert, Box, IconButton,
    List, ListItem, ListItemIcon, ListItemText, Tooltip, Chip,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import VisibilityIcon from '@mui/icons-material/Visibility';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DeleteIcon from '@mui/icons-material/Delete';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ImageIcon from '@mui/icons-material/Image';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import DescriptionIcon from '@mui/icons-material/Description';

const FILE_ICONS = {
    image: <ImageIcon color="primary" />,
    pdf: <PictureAsPdfIcon color="error" />,
    doc: <DescriptionIcon color="info" />,
    default: <InsertDriveFileIcon color="action" />,
};

const getFileIcon = (file) => {
    const name = file.name?.toLowerCase() || '';
    if (name.match(/\.(jpg|jpeg|png|gif|webp|bmp)$/)) return FILE_ICONS.image;
    if (name.endsWith('.pdf')) return FILE_ICONS.pdf;
    if (name.match(/\.(doc|docx)$/)) return FILE_ICONS.doc;
    return FILE_ICONS.default;
};

const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const SuggestCorrectionDialog = ({
    open,
    onClose,
    metricType,
    metricLabel,
    originalValue,
    existingCorrection,    // { reason, attachments } — from local state
    onSaveLocal,           // (metricType, { reason, attachments }) => void
    onRemoveLocal,         // (metricType) => void — remove local correction
}) => {
    const [reason, setReason] = useState('');
    const [attachments, setAttachments] = useState([]);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (open) {
            if (existingCorrection) {
                setReason(existingCorrection.reason || '');
                setAttachments(existingCorrection.attachments || []);
            } else {
                setReason('');
                setAttachments([]);
            }
            setError('');
        }
    }, [open, existingCorrection]);

    const handleAddFiles = (e) => {
        const files = Array.from(e.target.files || []);
        const newAttachments = files.map((file) => ({
            file,
            name: file.name,
            size: file.size,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        }));
        setAttachments((prev) => [...prev, ...newAttachments]);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleRemoveAttachment = (index) => {
        setAttachments((prev) => {
            const removed = prev[index];
            if (removed?.preview) URL.revokeObjectURL(removed.preview);
            return prev.filter((_, i) => i !== index);
        });
    };

    const handleReupload = (index) => {
        handleRemoveAttachment(index);
        fileInputRef.current?.click();
    };

    const handleViewAttachment = (att) => {
        if (att.preview) {
            window.open(att.preview, '_blank');
        } else if (att.url) {
            window.open(att.url, '_blank');
        } else if (att.file) {
            const url = URL.createObjectURL(att.file);
            window.open(url, '_blank');
        }
    };

    const handleSave = () => {
        setError('');
        if (!reason.trim()) {
            setError('Please provide your remarks for this metric');
            return;
        }

        onSaveLocal(metricType, {
            reason: reason.trim(),
            attachments,
        });
        onClose();
    };

    const handleRemove = () => {
        if (onRemoveLocal) onRemoveLocal(metricType);
        onClose();
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                Submit Remarks — {metricLabel}
            </DialogTitle>
            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <TextField
                    label="Current (Computed) Value"
                    value={originalValue}
                    fullWidth
                    disabled
                    size="small"
                    sx={{ mb: 2, mt: 1 }}
                />

                <Alert severity="info" sx={{ mb: 2 }}>
                    Submit your remarks and supporting documents. The admin will review and decide if a correction is needed.
                </Alert>

                <TextField
                    label="Remarks (required)"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    fullWidth
                    autoFocus
                    multiline
                    rows={3}
                    size="small"
                    placeholder="Explain your concern about this metric value..."
                    sx={{ mb: 2 }}
                />

                {/* Attachments */}
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Typography variant="subtitle2" fontWeight={600}>
                            Attachments
                        </Typography>
                        <Chip label="Photo, PDF, Docs" size="small" variant="outlined" />
                        <Button
                            size="small"
                            startIcon={<AttachFileIcon />}
                            onClick={() => fileInputRef.current?.click()}
                            variant="outlined"
                            sx={{ ml: 'auto' }}
                        >
                            Add File
                        </Button>
                        <input
                            ref={fileInputRef}
                            type="file"
                            hidden
                            multiple
                            accept="image/*,.pdf,.doc,.docx"
                            onChange={handleAddFiles}
                        />
                    </Box>

                    {attachments.length > 0 ? (
                        <List dense sx={{ bgcolor: 'grey.50', borderRadius: 1 }}>
                            {attachments.map((att, idx) => (
                                <ListItem
                                    key={idx}
                                    secondaryAction={
                                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                                            <Tooltip title="View">
                                                <IconButton size="small" onClick={() => handleViewAttachment(att)}>
                                                    <VisibilityIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Reupload">
                                                <IconButton size="small" onClick={() => handleReupload(idx)}>
                                                    <UploadFileIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                            <Tooltip title="Remove">
                                                <IconButton size="small" color="error" onClick={() => handleRemoveAttachment(idx)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </Box>
                                    }
                                >
                                    <ListItemIcon sx={{ minWidth: 36 }}>
                                        {getFileIcon(att)}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={att.name}
                                        secondary={att.size ? formatFileSize(att.size) : null}
                                        primaryTypographyProps={{ variant: 'body2', noWrap: true, sx: { maxWidth: 200 } }}
                                    />
                                </ListItem>
                            ))}
                        </List>
                    ) : (
                        <Typography variant="body2" color="text.secondary" sx={{ py: 1, textAlign: 'center' }}>
                            No attachments added
                        </Typography>
                    )}
                </Box>
            </DialogContent>
            <DialogActions>
                {existingCorrection && (
                    <Button onClick={handleRemove} color="error" sx={{ mr: 'auto' }}>
                        Remove Remarks
                    </Button>
                )}
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={handleSave} variant="contained">
                    Save Locally
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SuggestCorrectionDialog;
