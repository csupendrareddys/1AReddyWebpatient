import React from 'react';
import { Box, TextField, Chip, Typography } from '@mui/material';
import ColorPicker from './ColorPicker';

const FONT_OPTIONS = [
    { label: 'Dancing Script', family: '"Dancing Script", cursive' },
    { label: 'Great Vibes', family: '"Great Vibes", cursive' },
    { label: 'Pacifico', family: '"Pacifico", cursive' },
    { label: 'Caveat', family: '"Caveat", cursive' },
];

/**
 * Renders typed text onto an offscreen canvas and returns a PNG Blob.
 */
export async function exportTypedSignature(text, fontFamily, color) {
    const fontSize = 64;
    // Ensure the Google Font is loaded before drawing
    await document.fonts.load(`${fontSize}px ${fontFamily}`);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    ctx.font = `${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText(text);
    const padding = 24;

    canvas.width = Math.ceil(metrics.width) + padding * 2;
    canvas.height = fontSize + padding * 2;

    // Context resets after resize, re-apply
    ctx.font = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.fillText(text, padding, padding);

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

const TypeTab = ({ typedText, onTextChange, selectedFont, onFontChange, strokeColor, onColorChange }) => {
    const activeFontFamily = FONT_OPTIONS.find((f) => f.label === selectedFont)?.family || FONT_OPTIONS[0].family;

    return (
        <Box>
            <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
                <ColorPicker value={strokeColor} onChange={onColorChange} />
                <Box display="flex" alignItems="center" gap={0.5}>
                    <Typography variant="body2" color="textSecondary" sx={{ mr: 0.5 }}>
                        Change Font
                    </Typography>
                    {FONT_OPTIONS.map((font) => (
                        <Chip
                            key={font.label}
                            label={font.label}
                            size="small"
                            variant={selectedFont === font.label ? 'filled' : 'outlined'}
                            color={selectedFont === font.label ? 'primary' : 'default'}
                            onClick={() => onFontChange(font.label)}
                            sx={{
                                fontFamily: font.family,
                                fontSize: '0.75rem',
                                cursor: 'pointer',
                            }}
                        />
                    ))}
                </Box>
            </Box>

            {/* Live preview */}
            <Box
                sx={{
                    border: '1px solid #e0e0e0',
                    borderRadius: 2,
                    p: 3,
                    mb: 2,
                    minHeight: 120,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#fafafa',
                    position: 'relative',
                }}
            >
                <Typography
                    sx={{
                        fontFamily: activeFontFamily,
                        fontSize: '2.5rem',
                        color: strokeColor,
                        textAlign: 'center',
                        wordBreak: 'break-word',
                        opacity: typedText ? 1 : 0.4,
                    }}
                >
                    {typedText || 'Type your Signature here'}
                </Typography>
                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 16,
                        left: '10%',
                        width: '80%',
                        borderBottom: '2px solid #cfd8dc',
                    }}
                />
            </Box>

            <Box display="flex" alignItems="center" gap={1}>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="Type your signature..."
                    value={typedText}
                    onChange={(e) => onTextChange(e.target.value.slice(0, 50))}
                    inputProps={{ maxLength: 50 }}
                />
                <Typography variant="caption" color="textSecondary" sx={{ whiteSpace: 'nowrap' }}>
                    {typedText.length}/50
                </Typography>
            </Box>
        </Box>
    );
};

export default React.memo(TypeTab);
