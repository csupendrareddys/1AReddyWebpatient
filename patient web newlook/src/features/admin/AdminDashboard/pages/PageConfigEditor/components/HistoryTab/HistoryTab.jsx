import { Card, CardContent, Typography, Box, Chip, Tooltip, IconButton, Grid } from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';

const HistoryTab = ({ versionHistory = [], auditLogs = [], handleRestoreVersion, saving }) => {
    return (
        <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Version History</Typography>
                        {versionHistory.length === 0 ? (
                            <Typography color="text.secondary">No versions yet.</Typography>
                        ) : (
                            versionHistory.map((v) => (
                                <Box key={v.id} sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Box>
                                            <Typography variant="subtitle2">Version {v.version}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {v.page_title || 'Untitled'}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Chip
                                                label={v.status}
                                                size="small"
                                                color={v.status === 'live' ? 'success' : v.status === 'preview' ? 'warning' : 'default'}
                                            />
                                            <Tooltip title="Restore this version to draft">
                                                <span>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleRestoreVersion(v.id, v.version)}
                                                        disabled={saving || v.status === 'draft'}
                                                    >
                                                        <RestoreIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Box>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" display="block">
                                        {v.published_at ? `Published: ${new Date(v.published_at).toLocaleString()}` : `Created: ${new Date(v.created_at).toLocaleString()}`}
                                    </Typography>
                                </Box>
                            ))
                        )}
                    </CardContent>
                </Card>
            </Grid>
            <Grid item xs={12} md={6}>
                <Card>
                    <CardContent>
                        <Typography variant="h6" gutterBottom>Audit Log</Typography>
                        {!Array.isArray(auditLogs) || auditLogs.length === 0 ? (
                            <Typography color="text.secondary">No audit logs yet.</Typography>
                        ) : (
                            auditLogs.slice(0, 20).map((log) => (
                                <Box key={log.id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                                    <Typography variant="subtitle2">
                                        {log.action} by {log.user_name || 'System'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {new Date(log.timestamp).toLocaleString()}
                                    </Typography>
                                </Box>
                            ))
                        )}
                    </CardContent>
                </Card>
            </Grid>
        </Grid>
    );
};

export default HistoryTab;
