/**
 * DeleteConfirmDialog — Confirmation before role deletion
 * Pure UI component
 */
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Typography,
} from '@mui/material';

const DeleteConfirmDialog = ({ open, roleName, onConfirm, onClose }) => {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
            <DialogTitle sx={{ fontWeight: 600, color: '#dc2626' }}>
                Delete Role
            </DialogTitle>
            <DialogContent>
                <Typography>
                    Are you sure you want to delete <strong>{roleName}</strong>?
                    This action cannot be undone.
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Roles with active sub-admin assignments cannot be deleted.
                </Typography>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" color="error" onClick={onConfirm}>
                    Delete
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DeleteConfirmDialog;
