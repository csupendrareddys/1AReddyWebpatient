import React, { useRef } from 'react';
import { Box, Button, Typography } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

const ImageTab = ({ uploadedFile, uploadedPreview, onFileChange }) => {
    const fileInputRef = useRef(null);

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) {
            const preview = URL.createObjectURL(file);
            onFileChange(file, preview);
        }
        // Reset so same file can be re-selected
        e.target.value = '';
    };

    const handleRemove = () => {
        onFileChange(null, null);
    };

    return (
        <Box>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleFileSelect}
            />
            {uploadedPreview ? (
                <Box textAlign="center">
                    <Box
                        sx={{
                            border: '1px solid #e0e0e0',
                            borderRadius: 2,
                            p: 2,
                            mb: 2,
                            backgroundColor: '#fafafa',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            minHeight: 180,
                        }}
                    >
                        <img
                            src={uploadedPreview}
                            alt="Signature preview"
                            style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }}
                        />
                    </Box>
                    <Typography variant="caption" color="textSecondary" display="block" sx={{ mb: 1 }}>
                        {uploadedFile?.name}
                    </Typography>
                    <Box display="flex" gap={1} justifyContent="center">
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => fileInputRef.current?.click()}
                            sx={{ textTransform: 'none' }}
                        >
                            Change Image
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={handleRemove}
                            sx={{ textTransform: 'none' }}
                        >
                            Remove
                        </Button>
                    </Box>
                </Box>
            ) : (
                <Box
                    onClick={() => fileInputRef.current?.click()}
                    sx={{
                        border: '2px dashed #bdbdbd',
                        borderRadius: 2,
                        p: 4,
                        textAlign: 'center',
                        cursor: 'pointer',
                        minHeight: 180,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'border-color 0.2s, background-color 0.2s',
                        '&:hover': {
                            borderColor: 'primary.main',
                            backgroundColor: 'action.hover',
                        },
                    }}
                >
                    <CloudUploadIcon sx={{ fontSize: 48, color: '#bdbdbd', mb: 1 }} />
                    <Typography variant="body1" color="textSecondary">
                        Click to upload signature image
                    </Typography>
                    <Typography variant="caption" color="textSecondary">
                        PNG, JPG, or SVG
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export default React.memo(ImageTab);
