/**
 * Feature History tab — restores this specific feature from a landing
 * snapshot. The snapshot tree contains every feature under every module, so
 * we reuse the landing-level snapshot list and the per-feature restore
 * endpoint; backend errors gracefully if the feature wasn't in that snapshot.
 */
import {
    Box, Paper, Typography, List, ListItem, ListItemText, Chip, Button, Alert, Tooltip,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';

const HistoryTab = ({ history, onRestore, canEdit, isSaving }) => {
    if (!history?.length) {
        return <Alert severity="info">No published snapshots yet.</Alert>;
    }
    return (
        <Paper>
            <List disablePadding>
                {history.map((snap, idx) => (
                    <ListItem
                        key={snap.id} divider={idx < history.length - 1}
                        secondaryAction={
                            <Tooltip title="Restore this feature's state from the snapshot">
                                <span>
                                    <Button
                                        variant="outlined" size="small"
                                        startIcon={<RestoreIcon />}
                                        disabled={!canEdit || isSaving}
                                        onClick={() => onRestore(snap.id)}
                                    >
                                        Restore
                                    </Button>
                                </span>
                            </Tooltip>
                        }
                    >
                        <ListItemText
                            primary={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" fontWeight={600}>
                                        Landing v{snap.version}
                                    </Typography>
                                    {idx === 0 && <Chip size="small" color="success" label="LATEST" />}
                                </Box>
                            }
                            secondary={
                                snap.created_at ? new Date(snap.created_at).toLocaleString() : ''
                            }
                        />
                    </ListItem>
                ))}
            </List>
        </Paper>
    );
};

export default HistoryTab;
