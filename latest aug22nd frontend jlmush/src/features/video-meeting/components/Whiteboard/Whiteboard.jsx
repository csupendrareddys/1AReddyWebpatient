import { useState, useEffect, useRef } from 'react';
import { Box, Typography, IconButton, Tooltip, ToggleButtonGroup, ToggleButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { ReactSketchCanvas } from 'react-sketch-canvas';

/**
 * Whiteboard - Shared drawing canvas synced via Twilio Video DataTrack.
 *
 * DataTrack protocol:
 *   { type: 'whiteboard', payload: { action: 'stroke' | 'clear', data: [...paths] } }
 *
 * Receives messages via the centralized `onMessage` registration from useTwilioRoom.
 * Only doctors can draw. Patients see a read-only live view.
 */
const Whiteboard = ({ dataTrack, onMessage, isDoctor = false }) => {
    const canvasRef = useRef(null);
    const isRemoteUpdate = useRef(false);
    const [strokeColor, setStrokeColor] = useState('#1976d2');

    const colors = ['#1976d2', '#d32f2f', '#2e7d32', '#000000', '#ff9800'];

    // Register with the centralized message dispatcher
    useEffect(() => {
        if (!onMessage) return;
        const cleanup = onMessage('whiteboard', (data) => {
            try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'whiteboard') {
                    isRemoteUpdate.current = true;

                    if (parsed.payload.action === 'clear') {
                        canvasRef.current?.clearCanvas();
                    } else if (parsed.payload.action === 'stroke') {
                        // Clear first, then load the full path snapshot from doctor
                        canvasRef.current?.clearCanvas();
                        setTimeout(() => {
                            canvasRef.current?.loadPaths(parsed.payload.data);
                        }, 10);
                    }

                    setTimeout(() => { isRemoteUpdate.current = false; }, 200);
                }
            } catch { /* non-JSON or non-whiteboard — ignore */ }
        });
        return cleanup;
    }, [onMessage]);

    const handleStroke = async () => {
        // Don't re-broadcast strokes received from remote or if user is not doctor
        if (isRemoteUpdate.current || !dataTrack || !isDoctor) return;

        try {
            const paths = await canvasRef.current?.exportPaths();
            if (paths && paths.length > 0) {
                dataTrack.send(
                    JSON.stringify({
                        type: 'whiteboard',
                        payload: { action: 'stroke', data: paths },
                    })
                );
            }
        } catch {
            // Canvas export failed silently
        }
    };

    const handleClear = () => {
        if (!isDoctor) return;
        canvasRef.current?.clearCanvas();
        if (dataTrack) {
            dataTrack.send(
                JSON.stringify({
                    type: 'whiteboard',
                    payload: { action: 'clear' },
                })
            );
        }
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Toolbar */}
            <Box
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    p: 1,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                }}
            >
                <Typography variant="subtitle1" fontWeight={600}>
                    Whiteboard {!isDoctor && '(View Only)'}
                </Typography>

                {/* Toolbar — only shown to doctor */}
                {isDoctor && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {/* Color picker */}
                        <ToggleButtonGroup
                            value={strokeColor}
                            exclusive
                            onChange={(_, val) => val && setStrokeColor(val)}
                            size="small"
                        >
                            {colors.map((color) => (
                                <ToggleButton
                                    key={color}
                                    value={color}
                                    sx={{
                                        width: 24,
                                        height: 24,
                                        minWidth: 24,
                                        p: 0,
                                        bgcolor: color,
                                        border: strokeColor === color ? '2px solid' : '1px solid',
                                        borderColor: strokeColor === color ? 'text.primary' : 'divider',
                                        '&:hover': { bgcolor: color, opacity: 0.8 },
                                        '&.Mui-selected': { bgcolor: color },
                                        '&.Mui-selected:hover': { bgcolor: color, opacity: 0.8 },
                                    }}
                                />
                            ))}
                        </ToggleButtonGroup>

                        <Tooltip title="Clear whiteboard">
                            <IconButton size="small" onClick={handleClear} color="error">
                                <DeleteIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                )}
            </Box>

            {/* Canvas */}
            <Box
                sx={{
                    flex: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    overflow: 'hidden',
                    m: 1,
                }}
            >
                <ReactSketchCanvas
                    ref={canvasRef}
                    strokeWidth={3}
                    strokeColor={strokeColor}
                    canvasColor="#ffffff"
                    style={{
                        width: '100%',
                        height: '100%',
                        pointerEvents: isDoctor ? 'auto' : 'none',
                        cursor: isDoctor ? 'crosshair' : 'default',
                    }}
                    onStroke={handleStroke}
                />
            </Box>
        </Box>
    );
};

export default Whiteboard;
