/**
 * MasterDataManager — CRUD UI for the admin-managed master data tables.
 *
 * Tabs:
 *   - Colleges          — per-qualification-level (UG / PG / SS).
 *   - Specializations   — per-qualification-level.
 *   - Degrees           — per-qualification-level (e.g. MBBS = UG, MD = PG).
 *   - Symptoms          — no level concept (unchanged from the legacy UI).
 *
 * Each level-aware tab has:
 *   - A "Filter by level" dropdown (All / UG / PG / Super-Speciality).
 *   - A "Bulk import" button that opens a dialog and POSTs newline-separated
 *     names to the matching ``/admin/master/<type>/bulk`` endpoint so a
 *     tenant can seed a whole UG-college list in one shot.
 *   - A "Add" button that opens a single-row create dialog.
 *
 * The level-scoped endpoints live in ``doctorSignupConfigEndpoints.js``
 * (the signup module mounts the master-data routes); the Symptoms
 * endpoints are still on the older doctor-profile-config module.
 */
import { useState, useMemo } from 'react';
import {
    Box, Typography, TextField, Button, IconButton, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, Paper, Tabs, Tab,
    Dialog, DialogTitle, DialogContent, DialogActions, Chip, CircularProgress,
    MenuItem, Select, FormControl, InputLabel, Stack, Alert, Snackbar,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
    useGetSymptomsMasterQuery,
    useCreateSymptomMasterMutation,
    useUpdateSymptomMasterMutation,
    useDeleteSymptomMasterMutation,
} from '../../../../api/doctorProfileConfigEndpoints';
import {
    useGetMasterCollegesByLevelQuery,
    useCreateMasterCollegeByLevelMutation,
    useUpdateMasterCollegeByLevelMutation,
    useDeleteMasterCollegeByLevelMutation,
    useBulkCreateMasterCollegesMutation,

    useGetMasterSpecializationsByLevelQuery,
    useCreateMasterSpecializationByLevelMutation,
    useUpdateMasterSpecializationByLevelMutation,
    useDeleteMasterSpecializationByLevelMutation,
    useBulkCreateMasterSpecializationsMutation,

    useGetMasterDegreesByLevelQuery,
    useCreateMasterDegreeByLevelMutation,
    useUpdateMasterDegreeByLevelMutation,
    useDeleteMasterDegreeByLevelMutation,
    useBulkCreateMasterDegreesMutation,
} from '../../../../api/doctorSignupConfigEndpoints';


const LEVEL_OPTIONS = [
    { value: '', label: 'All levels' },
    { value: 'ug', label: 'Graduation (UG)' },
    { value: 'pg', label: 'Post Graduation (PG)' },
    { value: 'super_speciality', label: 'Super Speciality' },
];

const LEVEL_LABEL = {
    ug: 'UG',
    pg: 'PG',
    super_speciality: 'SS',
};


// Translates the (entity, tabIndex) into the right pile of RTK Query
// hooks. Pulled out of the component body so each tab gets a clean,
// uniform interface — `useEntity()` always returns the same shape.
const TAB_INDEX = {
    COLLEGES: 0,
    SPECIALIZATIONS: 1,
    DEGREES: 2,
    SYMPTOMS: 3,
};


// ``symptomsOnly`` collapses this manager down to just the Symptoms tab.
// The Colleges / Specializations / Degrees lists are a *redundant* admin
// surface — those catalogs are already managed from the Doctor Profile
// Config field editor (the field Options block writes straight to master
// data), so the Doctor Profile → Master Data accordion mounts this with
// ``symptomsOnly`` to drop the duplicate CRUD. The backend endpoints and
// tables are intentionally left intact (still used by the field editor,
// Admin Products, and Service-Group approvals); only this UI is trimmed.
// The Admin Profile Config editor still mounts it with the full tab set.
const MasterDataManager = ({ symptomsOnly = false }) => {
    const [tabIndex, setTabIndex] = useState(
        symptomsOnly ? TAB_INDEX.SYMPTOMS : TAB_INDEX.COLLEGES,
    );
    const [levelFilter, setLevelFilter] = useState('');  // '' = all
    const [dialogOpen, setDialogOpen] = useState(false);
    const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
    const [editItem, setEditItem] = useState(null);
    const [formData, setFormData] = useState({
        name: '', description: '', category: '', qualification_level: 'ug',
    });
    const [bulkForm, setBulkForm] = useState({
        qualification_level: 'ug', names: '',
    });
    const [bulkResult, setBulkResult] = useState(null);
    // User-visible feedback for save / update / delete. Previously the
    // catch blocks just did ``console.error`` and the dialog closed —
    // so a 409 "already exists" or a 4xx "qualification_level required"
    // looked exactly like a successful save. That was the entire reason
    // counts "reset to 0 after publish": rows were never persisted, but
    // nothing in the UI said so.
    const [snack, setSnack] = useState({
        open: false,
        severity: 'success',
        message: '',
    });
    const notify = (severity, message) =>
        setSnack({ open: true, severity, message });
    // Extract the most informative string from an RTK Query / axios
    // rejection. Backend responses use a few different envelope shapes
    // (``{error, status_code}`` vs ``{message}`` vs raw axios message),
    // so we try each in turn before falling back to a generic string.
    const errMsg = (err, fallback) =>
        err?.data?.error
        || err?.data?.message
        || err?.error
        || err?.message
        || fallback;

    // ---- Per-tab data wiring ----
    //
    // Each "tab" is just a different lookup against the same backend
    // pattern. The level-aware tabs all use the new level-scoped
    // endpoints from doctorSignupConfigEndpoints; the legacy Symptoms
    // tab still uses the older doctorProfileConfigEndpoints (no level
    // concept there).

    // Colleges
    const collegesQ = useGetMasterCollegesByLevelQuery(
        { level: levelFilter || undefined, activeOnly: false },
        { skip: tabIndex !== TAB_INDEX.COLLEGES },
    );
    const [createCollege] = useCreateMasterCollegeByLevelMutation();
    const [updateCollege] = useUpdateMasterCollegeByLevelMutation();
    const [deleteCollege] = useDeleteMasterCollegeByLevelMutation();
    const [bulkCreateColleges] = useBulkCreateMasterCollegesMutation();

    // Specializations
    const specsQ = useGetMasterSpecializationsByLevelQuery(
        { level: levelFilter || undefined, activeOnly: false },
        { skip: tabIndex !== TAB_INDEX.SPECIALIZATIONS },
    );
    const [createSpecialization] = useCreateMasterSpecializationByLevelMutation();
    const [updateSpecialization] = useUpdateMasterSpecializationByLevelMutation();
    const [deleteSpecialization] = useDeleteMasterSpecializationByLevelMutation();
    const [bulkCreateSpecs] = useBulkCreateMasterSpecializationsMutation();

    // Degrees
    const degreesQ = useGetMasterDegreesByLevelQuery(
        { level: levelFilter || undefined, activeOnly: false },
        { skip: tabIndex !== TAB_INDEX.DEGREES },
    );
    const [createDegree] = useCreateMasterDegreeByLevelMutation();
    const [updateDegree] = useUpdateMasterDegreeByLevelMutation();
    const [deleteDegree] = useDeleteMasterDegreeByLevelMutation();
    const [bulkCreateDegrees] = useBulkCreateMasterDegreesMutation();

    // Symptoms (legacy, no level)
    const { data: symptomsRes, isLoading: isLoadingSymptoms } = useGetSymptomsMasterQuery(
        false, { skip: tabIndex !== TAB_INDEX.SYMPTOMS },
    );
    const [createSymptom] = useCreateSymptomMasterMutation();
    const [updateSymptom] = useUpdateSymptomMasterMutation();
    const [deleteSymptom] = useDeleteSymptomMasterMutation();

    const isCollege = tabIndex === TAB_INDEX.COLLEGES;
    const isSpec = tabIndex === TAB_INDEX.SPECIALIZATIONS;
    const isDegree = tabIndex === TAB_INDEX.DEGREES;
    const isSymptom = tabIndex === TAB_INDEX.SYMPTOMS;
    const isLevelAware = isCollege || isSpec || isDegree;

    const entityLabel = isCollege ? 'College' : isSpec ? 'Specialization' : isDegree ? 'Degree' : 'Symptom';
    const bulkEndpoint = isCollege ? bulkCreateColleges
        : isSpec ? bulkCreateSpecs
        : isDegree ? bulkCreateDegrees
        : null;

    const items = useMemo(() => {
        if (isCollege) return collegesQ.data || [];
        if (isSpec) return specsQ.data || [];
        if (isDegree) return degreesQ.data || [];
        return symptomsRes?.symptoms || [];
    }, [isCollege, isSpec, isDegree, collegesQ.data, specsQ.data, degreesQ.data, symptomsRes]);

    const isLoading = isCollege ? collegesQ.isFetching
        : isSpec ? specsQ.isFetching
        : isDegree ? degreesQ.isFetching
        : isLoadingSymptoms;

    const symptomCategories = symptomsRes?.categories || [];

    // ---- Dialog handlers ----

    const openCreateDialog = () => {
        setEditItem(null);
        setFormData({
            name: '', description: '', category: '',
            // Pre-seed the qualification level from the current filter so
            // a "Bulk by level then add one more" workflow is one click.
            qualification_level: levelFilter || 'ug',
        });
        setDialogOpen(true);
    };

    const openEditDialog = (item) => {
        setEditItem(item);
        setFormData({
            name: item.name,
            description: item.description || '',
            category: item.category || '',
            qualification_level: item.qualification_level || 'ug',
        });
        setDialogOpen(true);
    };

    const openBulkDialog = () => {
        setBulkForm({ qualification_level: levelFilter || 'ug', names: '' });
        setBulkResult(null);
        setBulkDialogOpen(true);
    };

    const handleSave = async () => {
        const name = (formData.name || '').trim();
        if (!name) return;

        try {
            if (editItem) {
                if (isCollege) {
                    await updateCollege({
                        id: editItem.id,
                        name,
                        qualification_level: formData.qualification_level || null,
                        is_active: editItem.is_active,
                    }).unwrap();
                } else if (isSpec) {
                    await updateSpecialization({
                        id: editItem.id,
                        name,
                        description: formData.description,
                        qualification_level: formData.qualification_level || null,
                        is_active: editItem.is_active,
                    }).unwrap();
                } else if (isDegree) {
                    await updateDegree({
                        id: editItem.id,
                        name,
                        description: formData.description,
                        qualification_level: formData.qualification_level || null,
                        is_active: editItem.is_active,
                    }).unwrap();
                } else {
                    await updateSymptom({ id: editItem.id, data: formData }).unwrap();
                }
            } else {
                if (isCollege) {
                    await createCollege({
                        name,
                        qualification_level: formData.qualification_level,
                    }).unwrap();
                } else if (isSpec) {
                    await createSpecialization({
                        name,
                        description: formData.description,
                        qualification_level: formData.qualification_level,
                    }).unwrap();
                } else if (isDegree) {
                    await createDegree({
                        name,
                        description: formData.description,
                        qualification_level: formData.qualification_level,
                    }).unwrap();
                } else {
                    await createSymptom(formData).unwrap();
                }
            }
            setDialogOpen(false);
            notify(
                'success',
                editItem
                    ? `Updated "${name}".`
                    : `Added "${name}" to ${isCollege ? 'colleges'
                        : isSpec ? 'specializations'
                        : isDegree ? 'degrees' : 'symptoms'}.`,
            );
            // Defence-in-depth — RTK Query's tag invalidation should
            // already refetch the active list query, but an explicit
            // refetch eliminates any race with stale cache reads.
            if (isCollege) collegesQ.refetch?.();
            else if (isSpec) specsQ.refetch?.();
            else if (isDegree) degreesQ.refetch?.();
        } catch (err) {
            // Surface the actual backend error so the user can see
            // duplicates (409), missing-level (4xx), unauthorised
            // (401), etc. instead of silently failing.
            notify('error', errMsg(err, 'Save failed.'));
        }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`Deactivate "${item.name}"?`)) return;
        try {
            if (isCollege) await deleteCollege(item.id).unwrap();
            else if (isSpec) await deleteSpecialization(item.id).unwrap();
            else if (isDegree) await deleteDegree(item.id).unwrap();
            else await deleteSymptom(item.id).unwrap();
            notify('success', `Deactivated "${item.name}".`);
        } catch (err) {
            notify('error', errMsg(err, 'Delete failed.'));
        }
    };

    const handleBulkImport = async () => {
        if (!bulkEndpoint) return;
        const names = bulkForm.names
            .split('\n').map((s) => s.trim()).filter(Boolean);
        if (names.length === 0) {
            setBulkResult({ error: 'Paste at least one name (one per line).' });
            return;
        }
        try {
            const res = await bulkEndpoint({
                qualification_level: bulkForm.qualification_level,
                names,
            }).unwrap();
            // The bulk endpoint envelope is { success, data: {created, skipped, qualification_level}, message }.
            setBulkResult({
                created: res?.data?.created || res?.created || [],
                skipped: res?.data?.skipped || res?.skipped || [],
            });
            // Clear the textarea so a follow-up paste starts clean.
            setBulkForm((prev) => ({ ...prev, names: '' }));
            const createdN = (res?.data?.created || res?.created || []).length;
            const skippedN = (res?.data?.skipped || res?.skipped || []).length;
            notify(
                'success',
                `Bulk import: ${createdN} added, ${skippedN} skipped (duplicates).`,
            );
            if (isCollege) collegesQ.refetch?.();
            else if (isSpec) specsQ.refetch?.();
            else if (isDegree) degreesQ.refetch?.();
        } catch (err) {
            const msg = errMsg(err, 'Bulk import failed.');
            setBulkResult({ error: msg });
            notify('error', msg);
        }
    };

    const handleTabChange = (_, v) => {
        setTabIndex(v);
        setLevelFilter('');  // reset filter when switching tabs
    };

    // Counts shown in tab labels. For level-aware tabs the count reflects
    // the *current* filter; for symptoms it's just the total.
    const collegeCount = collegesQ.data?.length ?? 0;
    const specCount = specsQ.data?.length ?? 0;
    const degreeCount = degreesQ.data?.length ?? 0;
    const symptomCount = symptomsRes?.symptoms?.length ?? 0;

    return (
        <Box>
            {!symptomsOnly && (
                <Tabs value={tabIndex} onChange={handleTabChange} sx={{ mb: 2 }}>
                    <Tab label={`Colleges (${collegeCount})`} sx={{ textTransform: 'none' }} />
                    <Tab label={`Specializations (${specCount})`} sx={{ textTransform: 'none' }} />
                    <Tab label={`Degrees (${degreeCount})`} sx={{ textTransform: 'none' }} />
                    <Tab label={`Symptoms (${symptomCount})`} sx={{ textTransform: 'none' }} />
                </Tabs>
            )}

            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
                sx={{ mb: 2 }}
            >
                <Typography variant="subtitle1" fontWeight="bold">
                    {isCollege ? 'Colleges / Universities'
                        : isSpec ? 'Specializations'
                        : isDegree ? 'Degrees'
                        : 'Treatable Symptoms'}
                </Typography>

                <Stack direction="row" spacing={1} alignItems="center">
                    {isLevelAware && (
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                            <InputLabel id="level-filter-label">Filter by level</InputLabel>
                            <Select
                                labelId="level-filter-label"
                                value={levelFilter}
                                label="Filter by level"
                                onChange={(e) => setLevelFilter(e.target.value)}
                            >
                                {LEVEL_OPTIONS.map((opt) => (
                                    <MenuItem key={opt.value || 'all'} value={opt.value}>
                                        {opt.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    {isLevelAware && (
                        <Button
                            variant="outlined"
                            size="small"
                            startIcon={<UploadFileIcon />}
                            onClick={openBulkDialog}
                        >
                            Bulk import
                        </Button>
                    )}
                    <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={openCreateDialog}
                    >
                        Add {entityLabel}
                    </Button>
                </Stack>
            </Stack>

            {isLoading ? (
                <Box sx={{ textAlign: 'center', py: 3 }}>
                    <CircularProgress size={24} />
                </Box>
            ) : (
                <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                        <TableHead>
                            <TableRow sx={{ bgcolor: '#f5f5f5' }}>
                                <TableCell sx={{ fontWeight: 'bold' }}>#</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                                {(isSpec || isDegree || isSymptom) && (
                                    <TableCell sx={{ fontWeight: 'bold' }}>Description</TableCell>
                                )}
                                {isSymptom && (
                                    <TableCell sx={{ fontWeight: 'bold' }}>Category</TableCell>
                                )}
                                {isLevelAware && (
                                    <TableCell sx={{ fontWeight: 'bold' }} align="center">Level</TableCell>
                                )}
                                <TableCell sx={{ fontWeight: 'bold' }} align="center">Status</TableCell>
                                <TableCell sx={{ fontWeight: 'bold' }} align="center">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {items.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={
                                            (isSymptom ? 4 : isLevelAware ? 4 : 3) +
                                            (isSpec || isDegree || isSymptom ? 1 : 0)
                                        }
                                        align="center"
                                    >
                                        <Typography color="text.secondary" sx={{ py: 2 }}>
                                            No {entityLabel.toLowerCase()}s found
                                            {isLevelAware && levelFilter
                                                ? ` for ${LEVEL_LABEL[levelFilter]}.`
                                                : '.'}
                                        </Typography>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                items.map((item, idx) => (
                                    <TableRow key={item.id} hover>
                                        <TableCell>{idx + 1}</TableCell>
                                        <TableCell>{item.name}</TableCell>
                                        {(isSpec || isDegree || isSymptom) && (
                                            <TableCell>{item.description || '—'}</TableCell>
                                        )}
                                        {isSymptom && (
                                            <TableCell>
                                                <Chip label={item.category || 'General'} size="small" variant="outlined" />
                                            </TableCell>
                                        )}
                                        {isLevelAware && (
                                            <TableCell align="center">
                                                {item.qualification_level ? (
                                                    <Chip
                                                        label={LEVEL_LABEL[item.qualification_level] || item.qualification_level}
                                                        size="small"
                                                        color="primary"
                                                        variant="outlined"
                                                    />
                                                ) : (
                                                    <Chip
                                                        label="Any"
                                                        size="small"
                                                        variant="outlined"
                                                    />
                                                )}
                                            </TableCell>
                                        )}
                                        <TableCell align="center">
                                            <Chip
                                                label={item.is_active ? 'Active' : 'Inactive'}
                                                size="small"
                                                color={item.is_active ? 'success' : 'default'}
                                                variant="outlined"
                                            />
                                        </TableCell>
                                        <TableCell align="center">
                                            <IconButton size="small" onClick={() => openEditDialog(item)}>
                                                <EditIcon fontSize="small" />
                                            </IconButton>
                                            {item.is_active && (
                                                <IconButton size="small" color="error" onClick={() => handleDelete(item)}>
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Create/Edit Dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {editItem ? 'Edit' : 'Add'} {entityLabel}
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        label="Name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        sx={{ mt: 1 }}
                    />
                    {(isSpec || isDegree || isSymptom) && (
                        <TextField
                            fullWidth
                            label="Description"
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            sx={{ mt: 2 }}
                            multiline
                            rows={2}
                        />
                    )}
                    {isLevelAware && (
                        <FormControl fullWidth sx={{ mt: 2 }}>
                            <InputLabel id="level-input-label">Qualification Level</InputLabel>
                            <Select
                                labelId="level-input-label"
                                value={formData.qualification_level || 'ug'}
                                label="Qualification Level"
                                onChange={(e) =>
                                    setFormData({ ...formData, qualification_level: e.target.value })
                                }
                            >
                                {LEVEL_OPTIONS.filter((o) => o.value).map((opt) => (
                                    <MenuItem key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    {isSymptom && (
                        <FormControl fullWidth sx={{ mt: 2 }}>
                            <InputLabel>Category</InputLabel>
                            <Select
                                value={formData.category}
                                label="Category"
                                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            >
                                {symptomCategories.map((cat) => (
                                    <MenuItem key={cat} value={cat}>{cat}</MenuItem>
                                ))}
                                <MenuItem value="">
                                    <em>Type new category below</em>
                                </MenuItem>
                            </Select>
                        </FormControl>
                    )}
                    {isSymptom && (
                        <TextField
                            fullWidth
                            label="Or enter new category"
                            value={formData.category}
                            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                            sx={{ mt: 1 }}
                            size="small"
                            placeholder="e.g., Respiratory, Dermatology..."
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleSave} variant="contained" disabled={!(formData.name || '').trim()}>
                        {editItem ? 'Update' : 'Create'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Bulk import dialog (level-aware entities only) */}
            <Dialog
                open={bulkDialogOpen}
                onClose={() => setBulkDialogOpen(false)}
                maxWidth="sm" fullWidth
            >
                <DialogTitle>Bulk import {entityLabel}s</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Paste one name per line. Duplicates already in this tenant are
                        skipped automatically.
                    </Typography>
                    <FormControl fullWidth sx={{ mb: 2 }}>
                        <InputLabel id="bulk-level-label">Qualification Level</InputLabel>
                        <Select
                            labelId="bulk-level-label"
                            value={bulkForm.qualification_level}
                            label="Qualification Level"
                            onChange={(e) =>
                                setBulkForm({ ...bulkForm, qualification_level: e.target.value })
                            }
                        >
                            {LEVEL_OPTIONS.filter((o) => o.value).map((opt) => (
                                <MenuItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField
                        fullWidth
                        label="Names (one per line)"
                        value={bulkForm.names}
                        onChange={(e) =>
                            setBulkForm({ ...bulkForm, names: e.target.value })
                        }
                        multiline
                        rows={10}
                        placeholder={'AIIMS Delhi\nJIPMER\nCMC Vellore\n…'}
                    />
                    {bulkResult?.error && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {bulkResult.error}
                        </Alert>
                    )}
                    {bulkResult && !bulkResult.error && (
                        <Alert severity="success" sx={{ mt: 2 }}>
                            Created {bulkResult.created?.length || 0}; skipped{' '}
                            {bulkResult.skipped?.length || 0} duplicate(s).
                            {bulkResult.skipped?.length > 0 && (
                                <Typography variant="caption" component="div" sx={{ mt: 1 }}>
                                    Skipped: {bulkResult.skipped.join(', ')}
                                </Typography>
                            )}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setBulkDialogOpen(false)}>Close</Button>
                    <Button
                        onClick={handleBulkImport}
                        variant="contained"
                        disabled={!(bulkForm.names || '').trim()}
                    >
                        Import
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Global feedback for every CRUD attempt. Replaces the
                pre-existing silent ``console.error`` catch blocks that
                made backend rejections (409 duplicates, 4xx missing
                fields, 401 expired tokens) invisible to the user. */}
            <Snackbar
                open={snack.open}
                autoHideDuration={snack.severity === 'error' ? 8000 : 4000}
                onClose={() => setSnack((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert
                    severity={snack.severity}
                    onClose={() => setSnack((s) => ({ ...s, open: false }))}
                    sx={{ width: '100%' }}
                >
                    {snack.message}
                </Alert>
            </Snackbar>
        </Box>
    );
};

export default MasterDataManager;
