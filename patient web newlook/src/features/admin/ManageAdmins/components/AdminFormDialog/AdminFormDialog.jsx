/**
 * AdminFormDialog — Create/Edit admin dialog with form fields and permission checkboxes
 */
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    TextField,
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Alert,
    CircularProgress,
    IconButton,
    InputAdornment,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

const AdminFormDialog = ({
    open,
    mode, // 'create' | 'edit'
    formData,
    permissions,
    selectedAdmin,
    showPassword,
    isLoading,
    error,
    onInputChange,
    onPermissionChange,
    onTogglePassword,
    onSubmit,
    onClose,
}) => {
    const isCreate = mode === 'create';
    const title = isCreate ? 'Create New Admin' : 'Edit Admin';
    const submitLabel = isCreate ? 'Create' : 'Save';

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
                    <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField
                            name="first_name"
                            label="First Name"
                            value={formData.first_name}
                            onChange={onInputChange}
                            fullWidth
                            required
                        />
                        <TextField
                            name="last_name"
                            label="Last Name"
                            value={formData.last_name}
                            onChange={onInputChange}
                            fullWidth
                            required
                        />
                    </Box>

                    {isCreate && (
                        <>
                            <TextField
                                name="email"
                                label="Email"
                                type="email"
                                value={formData.email}
                                onChange={onInputChange}
                                fullWidth
                            />
                            <TextField
                                name="phone_number"
                                label="Phone Number"
                                value={formData.phone_number}
                                onChange={onInputChange}
                                fullWidth
                                required
                                placeholder="9876543210"
                            />
                            <TextField
                                name="password"
                                label="Password"
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={onInputChange}
                                fullWidth
                                required
                                InputProps={{
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton onClick={onTogglePassword} edge="end">
                                                {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                }}
                            />
                            <FormControl fullWidth>
                                <InputLabel>Role</InputLabel>
                                <Select
                                    name="role"
                                    value={formData.role}
                                    onChange={onInputChange}
                                    label="Role"
                                >
                                    <MenuItem value="sub_admin">Sub Admin</MenuItem>
                                    <MenuItem value="super_admin">Super Admin</MenuItem>
                                </Select>
                            </FormControl>
                        </>
                    )}


                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={onSubmit} variant="contained" disabled={isLoading}>
                    {isLoading ? <CircularProgress size={24} /> : submitLabel}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default AdminFormDialog;
