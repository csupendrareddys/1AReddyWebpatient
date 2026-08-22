import React, { useState, useRef, useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
} from '@mui/material';
import DrawIcon from '@mui/icons-material/Draw';
import ImageIcon from '@mui/icons-material/Image';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import DrawTab from './signature-dialog/DrawTab';
import ImageTab from './signature-dialog/ImageTab';
import TypeTab from './signature-dialog/TypeTab';
import { exportTypedSignature } from './signature-dialog/TypeTab';

const FONT_OPTIONS_MAP = {
    'Dancing Script': '"Dancing Script", cursive',
    'Great Vibes': '"Great Vibes", cursive',
    'Pacifico': '"Pacifico", cursive',
    'Caveat': '"Caveat", cursive',
};

const MODE_CONFIG = {
    draw: { icon: <DrawIcon />, title: 'Draw Signature' },
    image: { icon: <ImageIcon />, title: 'Upload Signature Image' },
    type: { icon: <TextFieldsIcon />, title: 'Type Signature' },
};

/**
 * Single-mode signature creation dialog.
 * @param {string} mode - 'draw' | 'image' | 'type'
 */
const CreateSignatureDialog = ({ open, onClose, onSave, mode = 'draw' }) => {
    const [strokeColor, setStrokeColor] = useState('#000000');
    const [selectedFont, setSelectedFont] = useState('Dancing Script');
    const [typedText, setTypedText] = useState('');
    const [uploadedFile, setUploadedFile] = useState(null);
    const [uploadedPreview, setUploadedPreview] = useState(null);
    const [saving, setSaving] = useState(false);

    const canvasRef = useRef(null);

    const resetState = useCallback(() => {
        setStrokeColor('#000000');
        setSelectedFont('Dancing Script');
        setTypedText('');
        if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
        setUploadedFile(null);
        setUploadedPreview(null);
        setSaving(false);
        setTimeout(() => canvasRef.current?.clearCanvas(), 0);
    }, [uploadedPreview]);

    const handleClose = () => {
        resetState();
        onClose();
    };

    const handleImageChange = (file, preview) => {
        if (uploadedPreview) URL.revokeObjectURL(uploadedPreview);
        setUploadedFile(file);
        setUploadedPreview(preview);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            let file = null;

            if (mode === 'draw') {
                const dataUrl = await canvasRef.current.exportImage('png');
                const res = await fetch(dataUrl);
                const blob = await res.blob();
                file = new File([blob], 'signature-draw.png', { type: 'image/png' });
            } else if (mode === 'image') {
                file = uploadedFile;
            } else if (mode === 'type') {
                if (!typedText.trim()) {
                    setSaving(false);
                    return;
                }
                const fontFamily = FONT_OPTIONS_MAP[selectedFont] || FONT_OPTIONS_MAP['Dancing Script'];
                const blob = await exportTypedSignature(typedText, fontFamily, strokeColor);
                file = new File([blob], 'signature-typed.png', { type: 'image/png' });
            }

            if (file) {
                onSave(file);
                resetState();
                onClose();
            }
        } catch (err) {
            console.error('Failed to save signature:', err);
        } finally {
            setSaving(false);
        }
    };

    const isSaveDisabled = () => {
        if (saving) return true;
        if (mode === 'image' && !uploadedFile) return true;
        if (mode === 'type' && !typedText.trim()) return true;
        return false;
    };

    const config = MODE_CONFIG[mode] || MODE_CONFIG.draw;

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{ sx: { borderRadius: 2 } }}
        >
            <DialogTitle sx={{ pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                {config.icon}
                {config.title}
            </DialogTitle>

            <DialogContent sx={{ pt: '8px !important' }}>
                {mode === 'draw' && (
                    <DrawTab
                        canvasRef={canvasRef}
                        strokeColor={strokeColor}
                        onColorChange={setStrokeColor}
                    />
                )}
                {mode === 'image' && (
                    <ImageTab
                        uploadedFile={uploadedFile}
                        uploadedPreview={uploadedPreview}
                        onFileChange={handleImageChange}
                    />
                )}
                {mode === 'type' && (
                    <TypeTab
                        typedText={typedText}
                        onTextChange={setTypedText}
                        selectedFont={selectedFont}
                        onFontChange={setSelectedFont}
                        strokeColor={strokeColor}
                        onColorChange={setStrokeColor}
                    />
                )}
            </DialogContent>

            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={handleClose} sx={{ textTransform: 'none' }}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSave}
                    disabled={isSaveDisabled()}
                    sx={{ textTransform: 'none' }}
                >
                    {saving ? 'Saving...' : 'Save'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default React.memo(CreateSignatureDialog);
