/**
 * RoleEditorDialog — Create/Edit role dialog
 * Pure UI — form data and handlers from props
 */
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, FormControlLabel, Switch,
    CircularProgress, Alert, Box,
} from '@mui/material';

const RoleEditorDialog = ({
    open,
    mode, // 'create' | 'edit'
    formData,
    isLoading,
    onFormChange,
    onSubmit,
    onClose,
}) => {
    const isCreate = mode === 'create';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>
                {isCreate ? 'Create New Role' : 'Edit Role'}
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    <TextField
                        name="name"
                        label="Role Name"
                        value={formData.name}
                        onChange={onFormChange}
                        required
                        fullWidth
                        autoFocus
                    />
                    <TextField
                        name="description"
                        label="Description"
                        value={formData.description}
                        onChange={onFormChange}
                        multiline
                        rows={3}
                        fullWidth
                    />
                    <TextField
                        name="level"
                        label="Level (1-5)"
                        type="number"
                        value={formData.level}
                        onChange={onFormChange}
                        fullWidth
                        inputProps={{ min: 1, max: 5 }}
                        helperText="Higher levels have more authority"
                    />
                    {!isCreate && (
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={formData.is_active}
                                    onChange={(e) =>
                                        onFormChange({
                                            target: { name: 'is_active', value: e.target.checked },
                                        })
                                    }
                                />
                            }
                            label="Active"
                        />
                    )}
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={onClose} disabled={isLoading}>
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    onClick={onSubmit}
                    disabled={!formData.name?.trim() || isLoading}
                    sx={{
                        bgcolor: '#E8833A',
                        '&:hover': { bgcolor: '#D4702E' },
                        textTransform: 'none',
                        fontWeight: 600,
                    }}
                >
                    {isLoading ? <CircularProgress size={20} /> : isCreate ? 'Create' : 'Save Changes'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RoleEditorDialog;
