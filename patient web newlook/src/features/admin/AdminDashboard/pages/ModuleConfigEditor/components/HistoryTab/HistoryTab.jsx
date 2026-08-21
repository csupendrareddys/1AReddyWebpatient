/**
 * Module History tab — snapshots where this module was present, derived from
 * the landing-level snapshot list. Restore reaches into the snapshot's
 * ``tree_json`` and copies just this module (+ its features) back into the
 * current draft.
 */
import {
    Box, Paper, Typography, List, ListItem, ListItemText, Chip, Button, Alert, Tooltip,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';

const HistoryTab = ({ moduleId, history, onRestore, canEdit, isSaving }) => {
    // Keep only snapshots that actually contained this module.
    const relevant = (history || []).filter((snap) => {
        // History list returns metadata only; to filter precisely we would
        // have to request snap.tree_json. For now we show all published
        // snapshots and let restore error-out gracefully if the module isn't
        // present in that specific snapshot.
        return true;
    });

    if (!relevant.length) {
        return <Alert severity="info">No published snapshots yet.</Alert>;
    }
    return (
        <Paper>
            <List disablePadding>
                {relevant.map((snap, idx) => (
                    <ListItem
                        key={snap.id} divider={idx < relevant.length - 1}
                        secondaryAction={
                            <Tooltip title="Restore this module from the snapshot into the current draft">
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
                                snap.created_at
                                    ? new Date(snap.created_at).toLocaleString()
                                    : ''
                            }
                        />
                    </ListItem>
                ))}
            </List>
        </Paper>
    );
};

export default HistoryTab;
