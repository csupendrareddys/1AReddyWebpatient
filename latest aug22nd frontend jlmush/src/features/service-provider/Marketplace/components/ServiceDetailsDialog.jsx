/**
 * ServiceDetailsDialog — shows the full admin-configured details of a catalog
 * service / group plan (allowed modes with durations + consultation counts,
 * overall consultation range, working hours, tax). Reads the fields already on
 * the product payload (DoctorProduct.to_dict).
 */
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Stack,
    Chip, Button, Table, TableHead, TableBody, TableRow, TableCell, Divider, List,
    ListItem, ListItemText,
} from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useGetProductFeaturesQuery } from '../../api/doctorEndpoints';

const WEEK = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];

// One linked landing feature (benefits / what-is / how-it-works / included).
const FeatureBlock = ({ f }) => (
    <Box sx={{ mb: 1.5 }}>
        <Typography variant="subtitle2" fontWeight={700}>{f.title}</Typography>
        {f.what_is && <Typography variant="body2" color="text.secondary">{f.what_is}</Typography>}
        {(f.benefits || []).length > 0 && (
            <List dense disablePadding>
                {f.benefits.map((b, i) => (
                    <ListItem key={i} disableGutters sx={{ py: 0 }}>
                        <CheckCircleOutlineIcon fontSize="small" color="success" sx={{ mr: 1 }} />
                        <ListItemText primaryTypographyProps={{ variant: 'body2' }} primary={b} />
                    </ListItem>
                ))}
            </List>
        )}
        {(f.whats_included || []).length > 0 && (
            <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>What's included</Typography>
                {f.whats_included.map((w, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">• {w.title}{w.desc ? ` — ${w.desc}` : ''}</Typography>
                ))}
            </Box>
        )}
        {(f.how_it_works || []).length > 0 && (
            <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>How it works</Typography>
                {f.how_it_works.map((w, i) => (
                    <Typography key={i} variant="body2" color="text.secondary">{i + 1}. {w.title}{w.desc ? ` — ${w.desc}` : ''}</Typography>
                ))}
            </Box>
        )}
    </Box>
);

export default function ServiceDetailsDialog({ open, onClose, product: p }) {
    const { data: features = [] } = useGetProductFeaturesQuery(p?.id, { skip: !open || !p?.id });
    if (!p) return null;
    const rows = [];
    if (p.video_enabled) {
        rows.push(['Video', `${p.video_min_duration ?? '—'}–${p.video_max_duration ?? '—'} min`,
            `${p.video_min_consultations ?? '—'}–${p.video_max_consultations ?? '—'} consults`]);
    }
    if (p.voice_enabled) {
        rows.push(['Voice / Audio', `${p.voice_min_duration ?? '—'}–${p.voice_max_duration ?? '—'} min`,
            `${p.audio_min_consultations ?? '—'}–${p.audio_max_consultations ?? '—'} consults`]);
    }
    if (p.chat_enabled) rows.push(['Chat', '—', '—']);

    const wh = p.working_hours || {};
    const hasWH = wh && Object.keys(wh).length > 0;
    const taxLabel = p.tax_mode && p.tax_mode !== 'none'
        ? `${String(p.tax_mode).replace('_', '-')} · CGST ${p.cgst_rate || 0}% / SGST ${p.sgst_rate || 0}%`
        : 'No GST';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{p.name}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={2}>
                    {p.description && (
                        <Typography variant="body2" color="text.secondary">{p.description}</Typography>
                    )}
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Chip label={`Price ₹${p.min_price} – ₹${p.max_price}`} color="primary" variant="outlined" />
                        <Chip label={`Consultations ${p.min_consultations ?? '—'}–${p.max_consultations ?? '—'}`} variant="outlined" />
                        <Chip label={taxLabel} variant="outlined" />
                        {p.is_group_service && <Chip label="Group service" color="secondary" variant="outlined" />}
                        {p.eligible === false && <Chip label="Not eligible" color="error" variant="outlined" />}
                    </Stack>

                    <Box>
                        <Typography variant="subtitle2" gutterBottom>Consultation modes</Typography>
                        {rows.length > 0 ? (
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell><b>Mode</b></TableCell><TableCell><b>Duration</b></TableCell><TableCell><b>Consultations</b></TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {rows.map(([m, dur, cons]) => (
                                        <TableRow key={m}><TableCell>{m}</TableCell><TableCell>{dur}</TableCell><TableCell>{cons}</TableCell></TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        ) : (
                            <Typography variant="caption" color="text.secondary">No consultation modes configured.</Typography>
                        )}
                    </Box>

                    {p.ineligible_reason && (
                        <Typography variant="caption" color="error">{p.ineligible_reason}</Typography>
                    )}

                    {features.length > 0 && (
                        <Box>
                            <Divider sx={{ mb: 1 }} />
                            <Typography variant="subtitle2" gutterBottom>Features</Typography>
                            {features.map((f) => <FeatureBlock key={f.slug || f.title} f={f} />)}
                        </Box>
                    )}

                    {hasWH && (
                        <Box>
                            <Divider sx={{ mb: 1 }} />
                            <Typography variant="subtitle2" gutterBottom>Working hours</Typography>
                            <Stack spacing={0.25}>
                                {WEEK.map(([k, lbl]) => {
                                    const d = wh[k];
                                    return (
                                        <Typography key={k} variant="body2" color="text.secondary">
                                            {lbl}: {!d || d.closed ? 'Closed' : `${d.open || '—'} – ${d.close || '—'}`}
                                        </Typography>
                                    );
                                })}
                            </Stack>
                        </Box>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
        </Dialog>
    );
}
