import React from 'react';
import { Box, Typography } from '@mui/material';

const DEFAULT_COLORS = ['#000000', '#1565C0', '#C62828', '#2E7D32'];

const ColorPicker = ({ value, onChange, colors = DEFAULT_COLORS, label = 'Change Color' }) => (
    <Box display="flex" gap={1} alignItems="center">
        <Typography variant="body2" color="textSecondary" sx={{ mr: 0.5 }}>
            {label}
        </Typography>
        {colors.map((color) => (
            <Box
                key={color}
                onClick={() => onChange(color)}
                sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    backgroundColor: color,
                    cursor: 'pointer',
                    border: value === color ? '3px solid' : '2px solid transparent',
                    borderColor: value === color ? 'primary.main' : 'transparent',
                    outline: value === color ? `2px solid ${color}` : 'none',
                    outlineOffset: 1,
                    transition: 'all 0.15s ease',
                    '&:hover': { transform: 'scale(1.15)' },
                }}
            />
        ))}
    </Box>
);

export default React.memo(ColorPicker);
