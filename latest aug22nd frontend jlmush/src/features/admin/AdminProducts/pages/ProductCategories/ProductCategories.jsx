/**
 * ProductCategories — full-page admin manager for the product-category table.
 *
 * Layout follows the catalog spec:
 *   S.No | Category (name · tag line · icon) | Products/Features | Subcategory | Status
 *
 * Everything here is persisted:
 *   - name / tag_line / icon / is_active  → product_category PUT
 *   - features (multi-pick)               → product_category PUT (`features`)
 *   - subcategories (+add / remove)       → product_category subcategory endpoints
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Typography, Button, Paper, Table, TableContainer, TableHead, TableRow,
    TableCell, TableBody, IconButton, Stack, TextField, Chip, Select, MenuItem,
    OutlinedInput, Checkbox, ListItemText, Snackbar, Alert, CircularProgress,
    Tooltip, Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import {
    useGetProductCategoriesQuery,
    useCreateProductCategoryMutation,
    useUpdateProductCategoryMutation,
    useAddProductSubcategoryMutation,
    useDeleteProductSubcategoryMutation,
} from '../../../api/marketplaceEndpoints';

// The fixed "Products / Features" the admin picks from per category.
const FEATURE_OPTIONS = [
    'Video',
    'Audio',
    'Chat',
    'In-person consultation',
    'Home visit',
    'Camp consultation',
    'Marketplace',
    'Services',
    'Group services',
];

// The category classification the admin picks from per category. A category
// may be both (e.g. a plan that also offers consultations).
const CATEGORY_TYPE_OPTIONS = [
    'Consultant type',
    'Plan based type',
];

const CATALOG_ROUTE = '/dashboard/admin/products';

const ProductCategories = () => {
    const navigate = useNavigate();
    const { data: categories = [], isLoading } = useGetProductCategoriesQuery();
    const [createProductCategory, { isLoading: creating }] = useCreateProductCategoryMutation();
    const [updateProductCategory] = useUpdateProductCategoryMutation();
    const [addProductSubcategory] = useAddProductSubcategoryMutation();
    const [deleteProductSubcategory] = useDeleteProductSubcategoryMutation();

    // New-category draft (name + optional tag line / icon).
    const [draft, setDraft] = useState({ name: '', tag_line: '', icon: '' });
    const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

    // Inline edit of a row's name / tag line / icon.
    const [editId, setEditId] = useState(null);
    const [editRow, setEditRow] = useState({ name: '', tag_line: '', icon: '' });

    // Per-row subcategory input draft.
    const [subcatDraft, setSubcatDraft] = useState({}); // { [catId]: string }

    // Multi-select edits accumulate locally while a picker is open and are
    // persisted ONCE when it closes — one PUT per editing session rather
    // than one per clicked option. Keyed `${catId}:${field}`.
    const [pendingSel, setPendingSel] = useState({});
    const pendKey = (cat, field) => `${cat.id}:${field}`;
    const currentSel = (cat, field, saved) => pendingSel[pendKey(cat, field)] ?? saved;
    const stageSel = (cat, field) => (e) =>
        setPendingSel((s) => ({ ...s, [pendKey(cat, field)]: e.target.value }));
    const commitSel = (cat, field, saved, save) => () => {
        const key = pendKey(cat, field);
        const vals = pendingSel[key];
        setPendingSel((s) => { const n = { ...s }; delete n[key]; return n; });
        if (!vals) return;                                   // nothing staged
        if (JSON.stringify(vals) === JSON.stringify(saved)) return;  // no change
        save(cat, vals);
    };

    const notify = (message, severity = 'info') => setSnackbar({ open: true, message, severity });

    const handleAddCategory = async () => {
        const name = draft.name.trim();
        if (!name) return;
        try {
            await createProductCategory({
                name,
                tag_line: draft.tag_line.trim() || null,
                icon: draft.icon.trim() || null,
            }).unwrap();
            setDraft({ name: '', tag_line: '', icon: '' });
            notify('Category added', 'success');
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not add category', 'error');
        }
    };

    const beginEdit = (cat) => {
        setEditId(cat.id);
        setEditRow({ name: cat.name || '', tag_line: cat.tag_line || '', icon: cat.icon || '' });
    };
    const cancelEdit = () => { setEditId(null); setEditRow({ name: '', tag_line: '', icon: '' }); };
    const saveEdit = async () => {
        const name = editRow.name.trim();
        if (!name) { notify('Name is required', 'warning'); return; }
        try {
            await updateProductCategory({
                categoryId: editId,
                name,
                tag_line: editRow.tag_line.trim() || null,
                icon: editRow.icon.trim() || null,
            }).unwrap();
            cancelEdit();
            notify('Category updated', 'success');
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not update category', 'error');
        }
    };

    const toggleActive = async (cat) => {
        try {
            await updateProductCategory({ categoryId: cat.id, is_active: !cat.is_active }).unwrap();
            notify(cat.is_active ? `"${cat.name}" deactivated` : `"${cat.name}" activated`, 'success');
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not update', 'error');
        }
    };

    const saveFeatures = async (cat, vals) => {
        try {
            await updateProductCategory({ categoryId: cat.id, features: vals }).unwrap();
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not save features', 'error');
        }
    };

    const saveCategoryTypes = async (cat, vals) => {
        try {
            await updateProductCategory({ categoryId: cat.id, category_types: vals }).unwrap();
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not save type', 'error');
        }
    };

    const addSubcat = async (cat) => {
        const name = (subcatDraft[cat.id] || '').trim();
        if (!name) return;
        try {
            await addProductSubcategory({ categoryId: cat.id, name }).unwrap();
            setSubcatDraft((m) => ({ ...m, [cat.id]: '' }));
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not add subcategory', 'error');
        }
    };
    const removeSubcat = async (cat, sub) => {
        try {
            await deleteProductSubcategory({ categoryId: cat.id, subcategoryId: sub.id }).unwrap();
        } catch (err) {
            notify(err?.data?.error || err?.data?.message || 'Could not remove subcategory', 'error');
        }
    };

    return (
        <Box sx={{ p: 3 }}>
            <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                <IconButton onClick={() => navigate(CATALOG_ROUTE)} size="small">
                    <ArrowBackIcon />
                </IconButton>
                <Typography variant="h5" fontWeight="bold">Product Categories</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Group products under a category with a tag line and icon, pick the features it
                covers, and add subcategories.
            </Typography>

            {/* Add a new category */}
            <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
                    <TextField
                        size="small" label="Category name" value={draft.name} sx={{ flex: 1 }}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                    />
                    <TextField
                        size="small" label="Tag line" value={draft.tag_line} sx={{ flex: 1 }}
                        onChange={(e) => setDraft((d) => ({ ...d, tag_line: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                    />
                    <TextField
                        size="small" label="Icon" value={draft.icon} sx={{ width: 120 }}
                        helperText="emoji / key"
                        onChange={(e) => setDraft((d) => ({ ...d, icon: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCategory(); }}
                    />
                    <Button
                        variant="contained" startIcon={<AddIcon />} sx={{ mt: 0.25 }}
                        onClick={handleAddCategory} disabled={!draft.name.trim() || creating}
                    >
                        Add
                    </Button>
                </Stack>
            </Paper>

            {isLoading && (
                <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>
            )}

            {!isLoading && (
                <TableContainer component={Paper}>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700, width: 60 }}>S.No</TableCell>
                                <TableCell sx={{ fontWeight: 700, width: 70 }} align="center">Icon</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Category name</TableCell>
                                <TableCell sx={{ fontWeight: 700 }}>Tag line</TableCell>
                                <TableCell sx={{ fontWeight: 700, minWidth: 240 }}>Products / Features</TableCell>
                                <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Type</TableCell>
                                <TableCell sx={{ fontWeight: 700, minWidth: 240 }}>Subcategory name</TableCell>
                                <TableCell sx={{ fontWeight: 700, width: 110 }} align="center">Status</TableCell>
                                <TableCell sx={{ fontWeight: 700, width: 110 }} align="center">Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {categories.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={9} align="center" sx={{ color: 'text.secondary' }}>
                                        No categories yet. Add one above.
                                    </TableCell>
                                </TableRow>
                            )}
                            {categories.map((cat, idx) => {
                                const isEditing = editId === cat.id;
                                const features = cat.features || [];
                                const categoryTypes = cat.category_types || [];
                                const subcats = cat.subcategories || [];
                                return (
                                    <TableRow key={cat.id} hover>
                                        <TableCell>{idx + 1}</TableCell>

                                        {/* Icon */}
                                        <TableCell align="center">
                                            {isEditing ? (
                                                <TextField
                                                    size="small" value={editRow.icon} sx={{ width: 64 }}
                                                    onChange={(e) => setEditRow((r) => ({ ...r, icon: e.target.value }))}
                                                />
                                            ) : (
                                                <span style={{ fontSize: '1.25rem' }}>{cat.icon || '—'}</span>
                                            )}
                                        </TableCell>

                                        {/* Category name */}
                                        <TableCell>
                                            {isEditing ? (
                                                <TextField
                                                    size="small" value={editRow.name} autoFocus fullWidth
                                                    onChange={(e) => setEditRow((r) => ({ ...r, name: e.target.value }))}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); }}
                                                />
                                            ) : cat.name}
                                        </TableCell>

                                        {/* Tag line */}
                                        <TableCell sx={{ color: 'text.secondary' }}>
                                            {isEditing ? (
                                                <TextField
                                                    size="small" value={editRow.tag_line} fullWidth
                                                    onChange={(e) => setEditRow((r) => ({ ...r, tag_line: e.target.value }))}
                                                />
                                            ) : (cat.tag_line || '—')}
                                        </TableCell>

                                        {/* Products / Features — clicks accumulate locally; ONE
                                            save fires when the picker closes */}
                                        <TableCell>
                                            <Select
                                                multiple size="small" fullWidth displayEmpty
                                                value={currentSel(cat, 'features', features)}
                                                onChange={stageSel(cat, 'features')}
                                                onClose={commitSel(cat, 'features', features, saveFeatures)}
                                                input={<OutlinedInput />}
                                                renderValue={(sel) => sel.length
                                                    ? (
                                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                                            {sel.map((s) => <Chip key={s} size="small" label={s} />)}
                                                        </Stack>
                                                    )
                                                    : <Typography variant="body2" color="text.secondary">Pick…</Typography>}
                                            >
                                                {FEATURE_OPTIONS.map((opt) => (
                                                    <MenuItem key={opt} value={opt}>
                                                        <Checkbox checked={currentSel(cat, 'features', features).indexOf(opt) > -1} size="small" />
                                                        <ListItemText primary={opt} />
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </TableCell>

                                        {/* Type — Consultant / Plan based; clicks accumulate
                                            locally, ONE save fires when the picker closes */}
                                        <TableCell>
                                            <Select
                                                multiple size="small" fullWidth displayEmpty
                                                value={currentSel(cat, 'types', categoryTypes)}
                                                onChange={stageSel(cat, 'types')}
                                                onClose={commitSel(cat, 'types', categoryTypes, saveCategoryTypes)}
                                                input={<OutlinedInput />}
                                                renderValue={(sel) => sel.length
                                                    ? (
                                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                                            {sel.map((s) => <Chip key={s} size="small" label={s} />)}
                                                        </Stack>
                                                    )
                                                    : <Typography variant="body2" color="text.secondary">Pick…</Typography>}
                                            >
                                                {CATEGORY_TYPE_OPTIONS.map((opt) => (
                                                    <MenuItem key={opt} value={opt}>
                                                        <Checkbox checked={currentSel(cat, 'types', categoryTypes).indexOf(opt) > -1} size="small" />
                                                        <ListItemText primary={opt} />
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </TableCell>

                                        {/* Subcategory (+Add) */}
                                        <TableCell>
                                            <Stack spacing={1}>
                                                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                                    {subcats.map((s) => (
                                                        <Chip key={s.id} size="small" label={s.name}
                                                            onDelete={() => removeSubcat(cat, s)} />
                                                    ))}
                                                </Stack>
                                                <Stack direction="row" spacing={0.5}>
                                                    <TextField
                                                        size="small" placeholder="Subcategory" sx={{ flex: 1 }}
                                                        value={subcatDraft[cat.id] || ''}
                                                        onChange={(e) => setSubcatDraft((m) => ({ ...m, [cat.id]: e.target.value }))}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') addSubcat(cat); }}
                                                    />
                                                    <Button size="small" startIcon={<AddIcon />} onClick={() => addSubcat(cat)}>
                                                        Add
                                                    </Button>
                                                </Stack>
                                            </Stack>
                                        </TableCell>

                                        {/* Status toggle */}
                                        <TableCell align="center">
                                            <Stack alignItems="center" spacing={0.5}>
                                                <Chip
                                                    size="small"
                                                    label={cat.is_active ? 'Active' : 'Inactive'}
                                                    color={cat.is_active ? 'success' : 'default'}
                                                />
                                                <Switch
                                                    size="small" checked={!!cat.is_active}
                                                    disabled={isEditing}
                                                    onChange={() => toggleActive(cat)}
                                                />
                                            </Stack>
                                        </TableCell>

                                        {/* Actions */}
                                        <TableCell align="center">
                                            {isEditing ? (
                                                <>
                                                    <Tooltip title="Save"><IconButton size="small" color="primary" onClick={saveEdit}><SaveIcon fontSize="small" /></IconButton></Tooltip>
                                                    <Tooltip title="Cancel"><IconButton size="small" onClick={cancelEdit}><CloseIcon fontSize="small" /></IconButton></Tooltip>
                                                </>
                                            ) : (
                                                <Tooltip title="Edit"><IconButton size="small" onClick={() => beginEdit(cat)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            <Snackbar
                open={snackbar.open} autoHideDuration={4000}
                onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snackbar.severity}>{snackbar.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default ProductCategories;
