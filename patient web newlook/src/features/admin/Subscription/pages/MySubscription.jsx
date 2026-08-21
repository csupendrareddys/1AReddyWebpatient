/**
 * MySubscription — tenant-facing read-only view of the current plan.
 *
 * Presentational only. All data / normalisation lives in
 * ``../hooks/useMySubscription``.
 */
import {
    Alert, Box, Chip, CircularProgress, Container, Divider, Paper,
    Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';

import { useMySubscription } from '../hooks/useMySubscription';


const statusColor = {
    active: 'success',
    trial: 'info',
    over_limit: 'warning',
    past_due: 'warning',
    suspended: 'error',
    cancelled: 'default',
};


const MySubscription = () => {
    const {
        resolved, featureRows, seatRows, featureSources, activeAddons,
        isLoading, error, hasNoSubscription,
    } = useMySubscription({ debug: true });

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    if (error || !resolved) {
        return (
            <Container maxWidth="lg" sx={{ mt: 4 }}>
                <Alert severity="error">
                    Unable to load subscription details.
                    {hasNoSubscription
                        ? ' This tenant has no active subscription — contact the platform owner.'
                        : ''}
                </Alert>
            </Container>
        );
    }

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
            <Paper sx={{ p: 3, mb: 3 }}>
                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
                    <Typography variant="h5">{resolved.plan_code}</Typography>
                    <Chip
                        size="small"
                        label={resolved.subscription_status}
                        color={statusColor[resolved.subscription_status] || 'default'}
                    />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                    Billing is managed by the platform owner. Contact them to change
                    your plan or attach add-ons.
                </Typography>
            </Paper>

            <Paper sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>Seats</Typography>
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Role</TableCell>
                                <TableCell align="right">Used</TableCell>
                                <TableCell align="right">Limit</TableCell>
                                <TableCell>Source</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {seatRows.map((row) => (
                                <TableRow key={row.role}>
                                    <TableCell>{row.role}</TableCell>
                                    <TableCell align="right">{row.used ?? '—'}</TableCell>
                                    <TableCell align="right">{row.limit ?? '—'}</TableCell>
                                    <TableCell>{row.sources.join(' + ')}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            {activeAddons.length > 0 && (
                <Paper sx={{ p: 3, mb: 3 }}>
                    <Typography variant="h6" sx={{ mb: 2 }}>Active add-ons</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {activeAddons.map((a) => (
                            <Chip key={a.code} label={a.code} variant="outlined" />
                        ))}
                    </Stack>
                </Paper>
            )}

            <Paper sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>Features</Typography>
                <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Path</TableCell>
                                <TableCell>Enabled</TableCell>
                                <TableCell>Source</TableCell>
                                <TableCell>Notes</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {featureRows.map(({ path, enabled, meta }) => (
                                <TableRow key={path}>
                                    <TableCell>{path}</TableCell>
                                    <TableCell>
                                        <Chip
                                            size="small"
                                            label={enabled ? 'on' : 'off'}
                                            color={enabled ? 'success' : 'default'}
                                        />
                                    </TableCell>
                                    <TableCell>{featureSources[path] || 'plan'}</TableCell>
                                    <TableCell>
                                        {meta && Object.keys(meta).length
                                            ? Object.entries(meta)
                                                  .map(([k, v]) => `${k}=${v}`)
                                                  .join(', ')
                                            : ''}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Paper>

            <Divider sx={{ my: 3 }} />
            <Typography variant="caption" color="text.secondary">
                Super-admins see source attribution alongside each feature; sub-admins
                see only the binary on/off state.
            </Typography>
        </Container>
    );
};

export default MySubscription;
