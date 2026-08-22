import React from 'react';
import { Box, Grid, Typography, Paper, Chip } from '@mui/material';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Read-only rendering of a single consultation type's weekly working hours.
 *
 * Used for the admin-approved ("live") schedule which the doctor can view
 * but not edit — edits happen in the sibling editable {@link WeeklyScheduleConfig}.
 * The approved snapshot only changes after an admin approves a new submission,
 * so what is shown here is exactly what patients currently see.
 *
 * @param {Object} workingHours - flat day map: { Monday: [{ start, end }], ... }
 */
const WeeklyScheduleReadOnly = ({ workingHours = {} }) => {
    return (
        <Box>
            <Grid container spacing={1.5}>
                {DAYS.map((day) => {
                    const slots = Array.isArray(workingHours[day]) ? workingHours[day] : [];
                    const isEnabled = slots.length > 0;

                    return (
                        <Grid item xs={12} key={day}>
                            <Paper
                                variant="outlined"
                                sx={{
                                    p: 1.5,
                                    bgcolor: isEnabled ? 'background.paper' : 'action.disabledBackground',
                                }}
                            >
                                <Box display="flex" alignItems="center" gap={2}>
                                    <Typography
                                        fontWeight={isEnabled ? 'bold' : 'normal'}
                                        color={isEnabled ? 'text.primary' : 'text.disabled'}
                                        sx={{ width: 100, flexShrink: 0 }}
                                    >
                                        {day}
                                    </Typography>
                                    <Box display="flex" flexWrap="wrap" gap={1}>
                                        {isEnabled ? (
                                            slots.map((slot, index) => (
                                                <Chip
                                                    key={index}
                                                    size="small"
                                                    color="success"
                                                    variant="outlined"
                                                    label={`${slot.start} – ${slot.end}`}
                                                />
                                            ))
                                        ) : (
                                            <Typography variant="body2" color="text.disabled">
                                                Unavailable
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            </Paper>
                        </Grid>
                    );
                })}
            </Grid>
        </Box>
    );
};

export default WeeklyScheduleReadOnly;
