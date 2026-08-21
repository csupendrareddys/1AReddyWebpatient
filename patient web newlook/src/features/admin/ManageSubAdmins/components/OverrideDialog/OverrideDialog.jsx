/**
 * OverrideDialog — Create/Edit permission override dialog
 * Pure UI component. When the selected module is instance-scoped (e.g.
 * ``landing_module``), an additional "specific instance" picker appears so
 * overrides can be scoped to exactly one resource (e.g. allow admin X to edit
 * module ``Startup`` but not ``MCA``). The picked instance id is sent as
 * ``resource_id`` with the override payload; leave blank for module-wide.
 */
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    TextField, Button, FormControlLabel, Checkbox,
    Select, MenuItem, FormControl, InputLabel, Box, Typography,
} from '@mui/material';
import { useListLandingModulesQuery } from '../../../api/landingPageConfigEndpoints';

// Modules that support per-instance ACL. The picklist is fetched from the
// relevant backend resource listing; extend ``INSTANCE_SCOPED_MODULES`` and
// add a corresponding fetch when new dynamic-instance modules are introduced.
const INSTANCE_SCOPED_MODULES = new Set(['landing_module']);

const OverrideDialog = ({
    open,
    mode,
    formData,
    modules,
    existingModules = [],
    onFormChange,
    onSubmit,
    onClose,
}) => {
    const isCreate = mode === 'create';

    // Only fetch landing modules when the dialog is actually open AND the
    // selected module is instance-scoped — avoids a spurious request when
    // the dialog is used for unrelated permission scopes.
    const isLandingModule = formData.module === 'landing_module';
    const { data: landingModules = [] } = useListLandingModulesQuery(undefined, {
        skip: !open || !isLandingModule,
    });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ fontWeight: 600 }}>
                {isCreate ? 'Create Override' : 'Edit Override'}
            </DialogTitle>
            <DialogContent>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    <FormControl fullWidth>
                        <InputLabel>Module</InputLabel>
                        <Select
                            name="module"
                            value={formData.module}
                            onChange={(e) => {
                                // Changing module must reset any previously-set
                                // resource_id so we don't accidentally write a
                                // landing_module instance id against a different
                                // module.
                                onFormChange(e);
                                onFormChange({
                                    target: { name: 'resource_id', value: '' },
                                });
                            }}
                            label="Module"
                            disabled={!isCreate}
                        >
                            {(modules || []).map((m) => {
                                const val = m.value || m;
                                const isDisabled = isCreate && existingModules.includes(val);
                                return (
                                    <MenuItem key={val} value={val} disabled={isDisabled}>
                                        {(m.label || m).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                                        {isDisabled && " (Already Overridden)"}
                                    </MenuItem>
                                );
                            })}
                        </Select>
                    </FormControl>

                    {INSTANCE_SCOPED_MODULES.has(formData.module) && (
                        <FormControl fullWidth>
                            <InputLabel>Specific instance (optional)</InputLabel>
                            <Select
                                name="resource_id"
                                value={formData.resource_id || ''}
                                onChange={onFormChange}
                                label="Specific instance (optional)"
                                disabled={!isCreate}
                            >
                                <MenuItem value="">
                                    <em>All modules (module-wide)</em>
                                </MenuItem>
                                {landingModules.map((mod) => (
                                    <MenuItem key={mod.id} value={mod.id}>
                                        {mod.name}  <Typography
                                            component="span"
                                            variant="caption"
                                            color="text.secondary"
                                            sx={{ ml: 1 }}
                                        >
                                            /{mod.slug}
                                        </Typography>
                                    </MenuItem>
                                ))}
                            </Select>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, ml: 1 }}>
                                Leave blank to apply across every landing module. Pick one to scope
                                the override to that single module.
                            </Typography>
                        </FormControl>
                    )}

                    <FormControl fullWidth>
                        <InputLabel>Override Type</InputLabel>
                        <Select
                            name="override_type"
                            value={formData.override_type}
                            onChange={onFormChange}
                            label="Override Type"
                        >
                            <MenuItem value="GRANT">Grant (Add Permissions)</MenuItem>
                            <MenuItem value="REVOKE">Revoke (Remove Permissions)</MenuItem>
                        </Select>
                    </FormControl>

                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                        <FormControlLabel
                            control={<Checkbox name="can_view" checked={formData.can_view} onChange={onFormChange} />}
                            label="View"
                        />
                        <FormControlLabel
                            control={<Checkbox name="can_create" checked={formData.can_create} onChange={onFormChange} />}
                            label="Create"
                        />
                        <FormControlLabel
                            control={<Checkbox name="can_edit" checked={formData.can_edit} onChange={onFormChange} />}
                            label="Edit"
                        />
                        <FormControlLabel
                            control={<Checkbox name="can_delete" checked={formData.can_delete} onChange={onFormChange} />}
                            label="Delete"
                        />
                    </Box>

                    <TextField
                        name="reason"
                        label="Reason"
                        value={formData.reason}
                        onChange={onFormChange}
                        multiline
                        rows={2}
                        fullWidth
                    />

                    <TextField
                        name="expires_at"
                        label="Expires At (optional)"
                        type="datetime-local"
                        value={formData.expires_at}
                        onChange={onFormChange}
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                    />
                </Box>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={onSubmit}
                    disabled={!formData.module}
                    sx={{
                        bgcolor: '#E8833A',
                        '&:hover': { bgcolor: '#D4702E' },
                        textTransform: 'none',
                        fontWeight: 600,
                    }}
                >
                    {isCreate ? 'Create' : 'Update'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default OverrideDialog;
