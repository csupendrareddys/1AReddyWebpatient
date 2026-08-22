/**
 * DeleteConfirmDialog — Confirmation dialog for admin deletion
 */
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
} from '@mui/material';

const DeleteConfirmDialog = ({ open, adminName, onConfirm, onClose }) => (
    <Dialog open={open} onClose={onClose}>
        <DialogTitle>Delete Admin</DialogTitle>
        <DialogContent>
            <Typography>
                Are you sure you want to delete <strong>{adminName}</strong>?
                This action cannot be undone.
            </Typography>
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button onClick={onConfirm} color="error" variant="contained">
                Delete
            </Button>
        </DialogActions>
    </Dialog>
);

export default DeleteConfirmDialog;
