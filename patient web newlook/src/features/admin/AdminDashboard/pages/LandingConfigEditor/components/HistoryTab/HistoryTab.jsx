/**
 * Landing History tab — lists snapshots created at each publish and offers
 * a whole-tree Restore. Module-level and feature-level history tabs read the
 * same snapshot table and extract their subtree; this tab is the authoritative
 * view.
 */
import {
    Box, Paper, Typography, List, ListItem, ListItemText, Chip, Button, Alert,
    Tooltip,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';

// Map a row's status → status-chip color so platform rows can paint
// draft / preview / live / archived badges. Tenant snapshots don't
// carry a status (every snapshot was a published LIVE at the time);
// they fall through to the "LATEST" badge below.
const STATUS_CHIP_COLOR = {
    draft: 'primary',
    preview: 'warning',
    live: 'success',
    archived: 'default',
};

const HistoryTab = ({ history, onRestore, canEdit, isSaving }) => {
    if (!history?.length) {
        return <Alert severity="info">No published snapshots yet.</Alert>;
    }
    return (
        <Paper>
            <List disablePadding>
                {history.map((snap, idx) => {
                    // Tenant snapshots: ``snap.id`` is the snapshot id.
                    // Platform history rows: the row's ``id`` is the
                    // config id; the matching snapshot id (if any) is
                    // exposed as ``snap.snapshot_id``. Restore wants
                    // the snapshot id, so prefer that.
                    const restoreId = snap.snapshot_id || snap.id;
                    const canRestore = canEdit && !isSaving && !!restoreId;
                    return (
                        <ListItem
                            key={snap.id}
                            divider={idx < history.length - 1}
                            secondaryAction={
                                <Tooltip title={
                                    restoreId
                                        ? 'Restore this snapshot into the current draft'
                                        : 'This row was never published — no snapshot to restore.'
                                }>
                                    <span>
                                        <Button
                                            variant="outlined" size="small"
                                            startIcon={<RestoreIcon />}
                                            disabled={!canRestore}
                                            onClick={() => onRestore(restoreId)}
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
                                            v{snap.version}
                                        </Typography>
                                        {snap.status && (
                                            <Chip
                                                size="small"
                                                color={STATUS_CHIP_COLOR[snap.status] || 'default'}
                                                label={snap.status}
                                            />
                                        )}
                                        {idx === 0 && !snap.status && (
                                            <Chip size="small" color="success" label="LATEST" />
                                        )}
                                    </Box>
                                }
                                secondary={
                                    <>
                                        <Typography variant="caption" color="text.secondary">
                                            {snap.created_at
                                                ? new Date(snap.created_at).toLocaleString()
                                                : ''}
                                        </Typography>
                                        {snap.note && (
                                            <Typography variant="caption" display="block">
                                                {snap.note}
                                            </Typography>
                                        )}
                                    </>
                                }
                            />
                        </ListItem>
                    );
                })}
            </List>
        </Paper>
    );
};

export default HistoryTab;
