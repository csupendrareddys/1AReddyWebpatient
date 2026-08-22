/**
 * SecondOpinionBookingsTable — the completed-bookings + final-prescription
 * table with the second-opinion chat / voice / video actions (max 5 messages,
 * 5-minute calls). Shared by BOTH sides of the family-doctor relationship:
 *
 *   • the doctor's "Panel Patients → View" dialog, and
 *   • the patient's "Family Doctor → Second Opinion" section,
 *
 * so the two views never drift apart. The parent supplies the bookings and an
 * ``onSecondOpinion(prescriptionId, mode)`` handler (the doctor opens it on
 * their patient; the patient opens it with their family doctor).
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogContent,
    DialogTitle, IconButton, Link, List, ListItem, ListItemText, Stack, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ChatIcon from '@mui/icons-material/Chat';
import CallIcon from '@mui/icons-material/Call';
import VideocamIcon from '@mui/icons-material/Videocam';

import SecondOpinionChatDialog from './SecondOpinionChatDialog';

const prettify = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '—');

export default function SecondOpinionBookingsTable({
    bookings = [], onSecondOpinion, starting = false,
    isLoading = false, isError = false,
    emptyMessage = 'No completed bookings yet. Details appear only after a booking is completed.',
}) {
    const [viewRx, setViewRx] = useState(null);
    // The channel to open in the inline chat popup (set once the parent's
    // start-second-opinion call returns a channel id).
    const [openChannelId, setOpenChannelId] = useState(null);

    const handleSecondOpinion = async (prescriptionId, mode) => {
        const res = await onSecondOpinion(prescriptionId, mode);
        if (res?.channel_id) setOpenChannelId(res.channel_id);
    };

    if (isLoading) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>;
    }
    if (isError) {
        return <Alert severity="error">Could not load bookings.</Alert>;
    }
    if (!bookings.length) {
        return <Alert severity="info">{emptyMessage}</Alert>;
    }

    return (
        <>
            <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Type</TableCell>
                            <TableCell>Provider</TableCell>
                            <TableCell>Booked</TableCell>
                            <TableCell>Completed</TableCell>
                            <TableCell>Prescription</TableCell>
                            <TableCell align="center">Second opinion</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {bookings.map((b) => (
                            <TableRow key={b.booking_id} hover>
                                <TableCell>{prettify(b.type)}</TableCell>
                                <TableCell>{b.provider_name || '—'}</TableCell>
                                <TableCell>{fmtDate(b.booked_date)}</TableCell>
                                <TableCell>{fmtDate(b.completed_date)}</TableCell>
                                <TableCell>
                                    {b.prescription ? (
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Chip size="small" variant="outlined" label={prettify(b.prescription.status)} />
                                            <Button size="small" onClick={() => setViewRx(b.prescription)}>View</Button>
                                            {b.prescription.pdf_link && (
                                                <Link href={b.prescription.pdf_link} target="_blank" rel="noopener" variant="body2">PDF</Link>
                                            )}
                                        </Stack>
                                    ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                                </TableCell>
                                <TableCell align="center">
                                    {b.prescription ? (
                                        <Stack direction="row" spacing={0.5} justifyContent="center">
                                            <Tooltip title="Chat (max 5 messages)"><span>
                                                <IconButton size="small" color="primary" disabled={starting}
                                                    onClick={() => handleSecondOpinion(b.prescription.id, 'chat')}><ChatIcon fontSize="small" /></IconButton>
                                            </span></Tooltip>
                                            <Tooltip title="Voice call (max 5 min)"><span>
                                                <IconButton size="small" color="primary" disabled={starting}
                                                    onClick={() => handleSecondOpinion(b.prescription.id, 'audio')}><CallIcon fontSize="small" /></IconButton>
                                            </span></Tooltip>
                                            <Tooltip title="Video call (max 5 min)"><span>
                                                <IconButton size="small" color="primary" disabled={starting}
                                                    onClick={() => handleSecondOpinion(b.prescription.id, 'video')}><VideocamIcon fontSize="small" /></IconButton>
                                            </span></Tooltip>
                                        </Stack>
                                    ) : <Typography variant="caption" color="text.disabled">No prescription</Typography>}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Final prescription viewer (read-only, for the second opinion). */}
            <Dialog open={!!viewRx} onClose={() => setViewRx(null)} fullWidth maxWidth="sm">
                <DialogTitle sx={{ display: 'flex', alignItems: 'center' }}>
                    <Box sx={{ flexGrow: 1 }}>
                        Prescription
                        {viewRx?.status && (
                            <Chip size="small" sx={{ ml: 1 }} label={prettify(viewRx.status)} />
                        )}
                    </Box>
                    <IconButton onClick={() => setViewRx(null)} size="small"><CloseIcon /></IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {viewRx && (
                        <Stack spacing={1.5}>
                            {viewRx.doctor_name && (
                                <Typography variant="body2" color="text.secondary">
                                    By {viewRx.doctor_name}
                                    {viewRx.issue_date ? ` · ${fmtDate(viewRx.issue_date)}` : ''}
                                </Typography>
                            )}
                            {viewRx.diagnosis && (
                                <Box><Typography variant="subtitle2">Diagnosis</Typography>
                                    <Typography variant="body2">{viewRx.diagnosis}</Typography></Box>
                            )}
                            {(viewRx.medicines || []).length > 0 && (
                                <Box>
                                    <Typography variant="subtitle2">Medicines</Typography>
                                    <List dense>
                                        {viewRx.medicines.map((m, i) => (
                                            <ListItem key={i} disableGutters>
                                                <ListItemText
                                                    primary={m.name || m.medicine_name || m.brand_name || 'Medicine'}
                                                    secondary={[m.dosage, m.frequency, m.duration].filter(Boolean).join(' · ')} />
                                            </ListItem>
                                        ))}
                                    </List>
                                </Box>
                            )}
                            {viewRx.notes && (
                                <Box><Typography variant="subtitle2">Notes</Typography>
                                    <Typography variant="body2">{viewRx.notes}</Typography></Box>
                            )}
                            {viewRx.doctors_advice && (
                                <Box><Typography variant="subtitle2">Advice</Typography>
                                    <Typography variant="body2">{viewRx.doctors_advice}</Typography></Box>
                            )}
                            {viewRx.pdf_link && (
                                <Link href={viewRx.pdf_link} target="_blank" rel="noopener">Open PDF</Link>
                            )}
                            {!viewRx.diagnosis && !(viewRx.medicines || []).length && !viewRx.notes && (
                                <Alert severity="info">No detailed content on this prescription.</Alert>
                            )}
                        </Stack>
                    )}
                </DialogContent>
            </Dialog>

            {/* Inline second-opinion chat/call popup — opens in place instead of
                navigating away to My Services. */}
            <SecondOpinionChatDialog
                channelId={openChannelId}
                open={!!openChannelId}
                onClose={() => setOpenChannelId(null)}
            />
        </>
    );
}
