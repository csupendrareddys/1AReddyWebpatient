/**
 * AddonsAdmin — PLATFORM_OWNER catalog management for add-ons.
 *
 * Mirrors PlansAdmin's shape: list + create/edit dialog + archive.
 * The dialog uses the shared FeatureTreeEditor + SeatLimitsEditor
 * (with ``allowNegative`` for delta semantics) so the editing
 * surface for addons matches plans.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Container, Dialog,
    DialogActions, DialogContent, DialogTitle, Divider, FormControl,
    IconButton, InputLabel, MenuItem, Paper, Select, Stack, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip,
    Typography,
    Tab, Tabs,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';

import FeatureTreeEditor from '../components/FeatureTreeEditor';
import SeatLimitsEditor, { ALL_GRANT_KEYS } from '../components/SeatLimitsEditor';
import AddonTierEditor from '../components/AddonTierEditor';
import AddonTierGrid from '../components/AddonTierGrid';
import { usePricingAdmin } from '../hooks/usePricingAdmin';


const statusColor = {
    active: 'success', ACTIVE: 'success',
    draft: 'default', DRAFT: 'default',
    archived: 'error', ARCHIVED: 'error',
};


const AddonsAdmin = () => {
    const {
        addons, addonsLoading,
        addonDialogOpen, addonForm, setAddonForm,
        openAddonDialog, closeAddonDialog,
        editingAddonCode,
        handleSaveAddon, isCreatingAddon,
        handleUpdateAddon,
        handleArchiveAddon,
    } = usePricingAdmin();

    const [view, setView] = useState('pricing');
    const [savingGrid, setSavingGrid] = useState(false);

    // Bulk save from the grid: one PUT per changed add-on. Sequential so
    // a failure stops at the first bad row instead of half-applying a
    // dozen price changes.
    const saveGrid = async (changes) => {
        setSavingGrid(true);
        try {
            for (const { code, tiers } of changes) {
                await handleUpdateAddon(code, { tiers }, { quiet: true });
            }
        } finally {
            setSavingGrid(false);
        }
    };

    if (addonsLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
                <CircularProgress />
            </Box>
        );
    }

    const otherAddonCodes = addons
        .filter((a) => a.code !== addonForm.code)
        .map((a) => a.code);

    return (
        <Container maxWidth="lg" sx={{ mt: 4, mb: 8 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="h5">Add-ons</Typography>
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => openAddonDialog(null)}>
                    New add-on
                </Button>
            </Stack>

            <Tabs value={view} onChange={(e, v) => setView(v)}
                sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Tab value="pricing" label="Pricing grid" />
                <Tab value="catalogue" label="Catalogue" />
            </Tabs>

            {view === 'pricing' && (
                <AddonTierGrid
                    addons={addons}
                    onSave={saveGrid}
                    saving={savingGrid}
                />
            )}

            {view === 'catalogue' && (
            <TableContainer component={Paper}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell>Code</TableCell>
                            <TableCell>Name</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell align="right">Monthly ₹</TableCell>
                            <TableCell>Prerequisites</TableCell>
                            <TableCell align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {addons.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6}>
                                    <Typography variant="body2" color="text.secondary">
                                        No add-ons yet. Click <b>New add-on</b> to create one.
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        )}
                        {addons.map((a) => (
                            <TableRow key={a.id} hover>
                                <TableCell><code>{a.code}</code></TableCell>
                                <TableCell>{a.name}</TableCell>
                                <TableCell>
                                    {a.status === 'archived' ? (
                                        <Chip size="small" label={a.status} color={statusColor[a.status] || 'default'} />
                                    ) : (
                                        <Tooltip
                                            title={
                                                a.status === 'active'
                                                    ? 'Click to move back to draft'
                                                    : 'Click to activate this add-on'
                                            }
                                        >
                                            <Chip
                                                size="small"
                                                label={a.status}
                                                color={statusColor[a.status] || 'default'}
                                                onClick={() =>
                                                    handleUpdateAddon(a.code, {
                                                        status: a.status === 'active' ? 'draft' : 'active',
                                                    })
                                                }
                                                clickable
                                            />
                                        </Tooltip>
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    {a.price_inr_monthly != null ? a.price_inr_monthly : '—'}
                                </TableCell>
                                <TableCell>
                                    {(a.prerequisites || []).length === 0
                                        ? '—'
                                        : a.prerequisites.map((p) => (
                                              <Chip key={p} size="small" label={p} sx={{ mr: 0.5 }} />
                                          ))}
                                </TableCell>
                                <TableCell align="right">
                                    <Tooltip title="Edit">
                                        <IconButton size="small" onClick={() => openAddonDialog(a)}>
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    {a.status !== 'archived' && (
                                        <Tooltip title="Archive">
                                            <IconButton
                                                size="small"
                                                color="error"
                                                onClick={() => {
                                                    if (window.confirm(
                                                        `Archive add-on "${a.code}"? This is reversible by editing.`
                                                    )) handleArchiveAddon(a.code);
                                                }}
                                            >
                                                <ArchiveIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>
            )}

            <Dialog open={addonDialogOpen} onClose={closeAddonDialog} fullWidth maxWidth="md">
                <DialogTitle>
                    {editingAddonCode ? `Edit add-on: ${editingAddonCode}` : 'New add-on'}
                </DialogTitle>
                <DialogContent dividers>
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <TextField
                            label="Code"
                            value={addonForm.code}
                            onChange={(e) => setAddonForm({ ...addonForm, code: e.target.value })}
                            disabled={Boolean(editingAddonCode)}
                            helperText="Stable identifier, e.g. extra-providers-5"
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Name"
                            value={addonForm.name}
                            onChange={(e) => setAddonForm({ ...addonForm, name: e.target.value })}
                            size="small"
                            fullWidth
                        />
                        <TextField
                            label="Description"
                            value={addonForm.description}
                            onChange={(e) => setAddonForm({ ...addonForm, description: e.target.value })}
                            size="small"
                            fullWidth
                            multiline
                            minRows={2}
                        />
                        <Stack direction="row" spacing={1}>
                            <TextField
                                label="Monthly ₹"
                                type="number"
                                size="small"
                                value={addonForm.price_inr_monthly ?? ''}
                                onChange={(e) =>
                                    setAddonForm({
                                        ...addonForm,
                                        price_inr_monthly: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Annual ₹"
                                type="number"
                                size="small"
                                value={addonForm.price_inr_annual ?? ''}
                                onChange={(e) =>
                                    setAddonForm({
                                        ...addonForm,
                                        price_inr_annual: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                sx={{ flex: 1 }}
                            />
                            <TextField
                                label="Was ₹ (annual)"
                                type="number"
                                size="small"
                                value={addonForm.og_price_inr_annual ?? ''}
                                onChange={(e) =>
                                    setAddonForm({
                                        ...addonForm,
                                        og_price_inr_annual: e.target.value === '' ? null : Number(e.target.value),
                                    })
                                }
                                sx={{ flex: 1 }}
                            />
                            {editingAddonCode && (
                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                    <InputLabel>Status</InputLabel>
                                    <Select
                                        label="Status"
                                        value={addonForm.status || 'draft'}
                                        onChange={(e) =>
                                            setAddonForm({ ...addonForm, status: e.target.value })
                                        }
                                    >
                                        <MenuItem value="draft">Draft</MenuItem>
                                        <MenuItem value="active">Active</MenuItem>
                                        <MenuItem value="archived">Archived</MenuItem>
                                    </Select>
                                </FormControl>
                            )}
                        </Stack>

                        <Divider />

                        {/* Tiered terms supersede the legacy price pair
                            above once any tier is switched on. */}
                        <AddonTierEditor
                            value={addonForm.tiers}
                            onChange={(tiers) => setAddonForm({ ...addonForm, tiers })}
                        />

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                What one unit grants
                            </Typography>
                            <Typography variant="caption" color="text.secondary"
                                sx={{ display: 'block', mb: 1 }}>
                                Team seats, marketplace entities, or extra
                                child tenancies for a reseller. This is what
                                files the add-on under a heading in the
                                pricing grid.
                            </Typography>
                            <SeatLimitsEditor
                                keys={ALL_GRANT_KEYS}
                                value={addonForm.limits || {}}
                                onChange={(limits) => {
                                    // Strip empty/null values so backend's
                                    // null-vs-zero check stays clean.
                                    const cleaned = Object.fromEntries(
                                        Object.entries(limits).filter(
                                            ([, v]) => v !== null && v !== '' && v !== '-',
                                        ),
                                    );
                                    setAddonForm({
                                        ...addonForm,
                                        limits: Object.keys(cleaned).length ? cleaned : null,
                                    });
                                }}
                                allowNegative
                                showSumHint={false}
                            />
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Features
                            </Typography>
                            <FeatureTreeEditor
                                value={addonForm.features || {}}
                                onChange={(features) => setAddonForm({ ...addonForm, features })}
                            />
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                Prerequisites (other add-ons)
                            </Typography>
                            <Select
                                multiple
                                size="small"
                                fullWidth
                                value={addonForm.prerequisites || []}
                                onChange={(e) =>
                                    setAddonForm({ ...addonForm, prerequisites: e.target.value })
                                }
                                renderValue={(selected) => (
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                                        {selected.length === 0 && <em>None</em>}
                                        {selected.map((c) => (
                                            <Chip key={c} size="small" label={c} />
                                        ))}
                                    </Stack>
                                )}
                            >
                                {otherAddonCodes.length === 0 && (
                                    <MenuItem disabled>(no other add-ons exist)</MenuItem>
                                )}
                                {otherAddonCodes.map((c) => (
                                    <MenuItem key={c} value={c}>{c}</MenuItem>
                                ))}
                            </Select>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                If selected, all prereqs must already be active on the tenant before this
                                add-on can be attached.
                            </Typography>
                        </Box>

                        <Alert severity="info">
                            New add-ons start in <b>draft</b>. Edit the row after creation to flip to <b>active</b>
                            once the catalog entry is ready.
                        </Alert>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeAddonDialog}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={handleSaveAddon}
                        disabled={isCreatingAddon || !addonForm.code || !addonForm.name}
                    >
                        {editingAddonCode ? 'Save changes' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Container>
    );
};

export default AddonsAdmin;
