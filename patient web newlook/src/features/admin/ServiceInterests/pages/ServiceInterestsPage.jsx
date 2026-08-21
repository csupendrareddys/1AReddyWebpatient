/**
 * ServiceInterestsPage — the admin's review list of doctors who registered
 * interest in a catalog service / group plan (doctors no longer create group
 * offerings themselves; they express interest and an admin assigns the plan).
 */
import {
    Box, Typography, Paper, Table, TableHead, TableBody, TableRow, TableCell,
    TableContainer, Chip, CircularProgress, Alert, Stack,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';

import { useGetServiceInterestsQuery } from '../../api/doctorsEndpoints';

const fmtDate = (s) => (s ? new Date(s).toLocaleString() : '—');

export default function ServiceInterestsPage() {
    const { data: interests = [], isLoading, error } = useGetServiceInterestsQuery();

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1000, mx: 'auto' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <GroupsIcon color="primary" />
                <Typography variant="h5" fontWeight={800}>Service Interests</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                Doctors who’ve expressed interest in a catalog service or group plan. Review and assign
                them to the relevant plan.
            </Typography>

            {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>}
            {error && <Alert severity="error">Couldn’t load service interests.</Alert>}
            {!isLoading && !error && interests.length === 0 && (
                <Alert severity="info">No doctors have expressed interest yet.</Alert>
            )}

            {interests.length > 0 && (
                <TableContainer component={Paper} className="admin-page-card">
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell><b>Doctor</b></TableCell>
                                <TableCell><b>Service / Plan</b></TableCell>
                                <TableCell><b>Note</b></TableCell>
                                <TableCell><b>When</b></TableCell>
                                <TableCell><b>Status</b></TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {interests.map((it) => (
                                <TableRow key={it.id} hover>
                                    <TableCell>{it.doctor_name || '—'}</TableCell>
                                    <TableCell>{it.product_name || '—'}</TableCell>
                                    <TableCell>{it.note || '—'}</TableCell>
                                    <TableCell>{fmtDate(it.created_at)}</TableCell>
                                    <TableCell>
                                        <Chip size="small" label={(it.status || 'new').toUpperCase()}
                                            color={it.status === 'reviewed' ? 'success' : 'warning'} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}
        </Box>
    );
}
