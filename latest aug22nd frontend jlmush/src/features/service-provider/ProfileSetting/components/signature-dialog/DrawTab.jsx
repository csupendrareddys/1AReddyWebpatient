import React from 'react';
import { Box, Button, Stack } from '@mui/material';
import { ReactSketchCanvas } from 'react-sketch-canvas';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UndoIcon from '@mui/icons-material/Undo';
import ColorPicker from './ColorPicker';

const DrawTab = ({ canvasRef, strokeColor, onColorChange }) => {
    return (
        <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
                <ColorPicker value={strokeColor} onChange={onColorChange} />
                <Box display="flex" gap={1}>
                    <Button
                        size="small"
                        startIcon={<UndoIcon />}
                        onClick={() => canvasRef.current?.undo()}
                        sx={{ textTransform: 'none' }}
                    >
                        Undo
                    </Button>
                    <Button
                        size="small"
                        startIcon={<DeleteOutlineIcon />}
                        onClick={() => canvasRef.current?.clearCanvas()}
                        sx={{ textTransform: 'none' }}
                        color="error"
                    >
                        Clear
                    </Button>
                </Box>
            </Stack>
            <Box
                sx={{
                    border: '1px solid #e0e0e0',
                    borderRadius: 2,
                    overflow: 'hidden',
                    backgroundColor: '#fafafa',
                    position: 'relative',
                }}
            >
                <ReactSketchCanvas
                    ref={canvasRef}
                    width="100%"
                    height="200px"
                    strokeWidth={3}
                    strokeColor={strokeColor}
                    canvasColor="transparent"
                    style={{ cursor: 'crosshair' }}
                />
                <Box
                    sx={{
                        position: 'absolute',
                        bottom: 12,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '80%',
                        borderBottom: '2px solid #cfd8dc',
                        pointerEvents: 'none',
                    }}
                />
            </Box>
        </Box>
    );
};

export default React.memo(DrawTab);
