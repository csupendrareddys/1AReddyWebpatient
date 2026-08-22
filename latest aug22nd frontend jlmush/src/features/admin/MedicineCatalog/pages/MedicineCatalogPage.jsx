/**
 * MedicineCatalogPage — Admin page with 3 tabs: Medicines, Banned List, Allergies
 *
 * All three lists are just generic names (single column).
 * Bulk upload: Excel (.xlsx/.csv with one column) OR paste text (line-by-line / comma-separated).
 */
import { useState, useRef } from 'react';
import {
    Box, Typography, Tabs, Tab, Paper, TextField, Button, IconButton, Table,
    TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
    Dialog, DialogTitle, DialogContent, DialogActions, Chip, Stack, Snackbar, Alert,
    CircularProgress, InputAdornment, Tooltip, Divider, Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import BlockIcon from '@mui/icons-material/Block';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import MedicationIcon from '@mui/icons-material/Medication';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import * as XLSX from 'xlsx';

import {
    useGetAdminMedicinesQuery,
    useCreateMedicineMutation,
    useUpdateMedicineMutation,
    useDeleteMedicineMutation,
    useBulkUploadMedicinesMutation,
    useGetBannedMedicinesQuery,
    useAddBannedMedicineMutation,
    useUpdateBannedMedicineMutation,
    useRemoveBannedMedicineMutation,
    useBulkUploadBannedMedicinesMutation,
    useGetAdminAllergiesQuery,
    useCreateAllergyMutation,
    useDeleteAllergyMutation,
    useBulkUploadAllergiesMutation,
} from '../../api/medicineCatalogEndpoints';

// ── Parse helpers ──
/** Parse a text blob into an array of trimmed, non-empty names. Supports line-break and comma separation. */
const parseNames = (text) =>
    text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

/** Parse an Excel/CSV file (first column only). Returns a Promise<string[]>. */
const parseExcelFile = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                // Convert sheet to array-of-arrays (each row is an array of cell values)
                const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
                const names = rows
                    .map((row) => String(row[0] ?? '').trim())   // first column
                    .filter(Boolean);
                // Remove header if it looks like one
                if (names.length && /^(name|generic.?name|medicine|allergy|s\.?no|sr|serial)/i.test(names[0])) {
                    names.shift();
                }
                resolve(names);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });

// ═══════════════════════════════════════════════════════════════════════
//  Reusable Bulk Upload Dialog
// ═══════════════════════════════════════════════════════════════════════
const BulkUploadDialog = ({ open, onClose, onUpload, title, placeholder, uploading }) => {
    const [pasteText, setPasteText] = useState('');
    const [fileName, setFileName] = useState('');
    const [parsedNames, setParsedNames] = useState([]);
    const fileRef = useRef(null);

    const reset = () => { setPasteText(''); setFileName(''); setParsedNames([]); };

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setFileName(file.name);
        try {
            const names = await parseExcelFile(file);
            setParsedNames(names);
            setPasteText(names.join('\n'));
        } catch {
            setPasteText('');
            setParsedNames([]);
        }
    };

    const handlePasteChange = (text) => {
        setPasteText(text);
        setParsedNames(parseNames(text));
    };

    const handleSubmit = () => {
        const names = parsedNames.length ? parsedNames : parseNames(pasteText);
        if (!names.length) return;
        onUpload(names);
        reset();
    };

    return (
        <Dialog open={open} onClose={() => { onClose(); reset(); }} maxWidth="sm" fullWidth>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                <Stack spacing={2} mt={1}>
                    {/* Option 1: File upload */}
                    <Box>
                        <Button
                            variant="outlined" startIcon={<UploadFileIcon />}
                            onClick={() => fileRef.current?.click()}
                        >
                            Upload Excel / CSV
                        </Button>
                        <input
                            ref={fileRef} type="file" hidden
                            accept=".csv,.xlsx,.xls,.txt"
                            onChange={handleFileChange}
                        />
                        {fileName && (
                            <Typography variant="caption" sx={{ ml: 1 }}>{fileName}</Typography>
                        )}
                    </Box>

                    <Divider>OR</Divider>

                    {/* Option 2: Paste text */}
                    <TextField
                        label={placeholder || 'Paste names (one per line, or comma-separated)'}
                        multiline rows={8} fullWidth
                        value={pasteText}
                        onChange={(e) => handlePasteChange(e.target.value)}
                        placeholder={"Paracetamol\nIbuprofen\nAmoxicillin\n\nor: Paracetamol, Ibuprofen, Amoxicillin"}
                    />

                    {parsedNames.length > 0 && (
                        <Alert severity="info" icon={false}>
                            <b>{parsedNames.length}</b> names detected.
                            {parsedNames.length <= 10
                                ? ` Preview: ${parsedNames.join(', ')}`
                                : ` Preview: ${parsedNames.slice(0, 8).join(', ')} ...and ${parsedNames.length - 8} more`}
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => { onClose(); reset(); }}>Cancel</Button>
                <Button
                    variant="contained" onClick={handleSubmit}
                    disabled={uploading || (!parsedNames.length && !pasteText.trim())}
                >
                    {uploading ? 'Uploading...' : `Upload ${parsedNames.length || ''} Names`}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// ═══════════════════════════════════════════════════════════════════════
//  Main Page
// ═══════════════════════════════════════════════════════════════════════
const MedicineCatalogPage = () => {
    const [tab, setTab] = useState(0);
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const [rowsPerPage, setRowsPerPage] = useState(25);
    const [snack, setSnack] = useState({ open: false, msg: '', sev: 'success' });

    // Single-add dialogs
    const [singleDialog, setSingleDialog] = useState(false);
    const [singleName, setSingleName] = useState('');

    // Bulk upload dialog
    const [bulkDialog, setBulkDialog] = useState(false);

    // Inline editing state: { id, name }
    const [editingRow, setEditingRow] = useState(null);
    const [editingName, setEditingName] = useState('');

    // ── API hooks ──
    const { data: medData, isLoading: medLoading } = useGetAdminMedicinesQuery(
        { search, page: page + 1, per_page: rowsPerPage, active_only: 'false' },
    );
    const [createMed] = useCreateMedicineMutation();
    const [updateMed] = useUpdateMedicineMutation();
    const [deleteMed] = useDeleteMedicineMutation();
    const [bulkMeds, { isLoading: bulkMedsLoading }] = useBulkUploadMedicinesMutation();

    const { data: bannedData = {}, isLoading: bannedLoading } = useGetBannedMedicinesQuery(
        { search, page: page + 1, per_page: rowsPerPage, active_only: 'false' },
    );
    const [addBanned] = useAddBannedMedicineMutation();
    const [updateBanned] = useUpdateBannedMedicineMutation();
    const [removeBanned] = useRemoveBannedMedicineMutation();
    const [bulkBanned, { isLoading: bulkBannedLoading }] = useBulkUploadBannedMedicinesMutation();

    const { data: allergyList = [], isLoading: allergyLoading } = useGetAdminAllergiesQuery({ search });
    const [createAllergy] = useCreateAllergyMutation();
    const [deleteAllergy] = useDeleteAllergyMutation();
    const [bulkAllergies, { isLoading: bulkAllergyLoading }] = useBulkUploadAllergiesMutation();

    const medicines = medData?.medicines || [];
    const bannedList = bannedData?.banned_medicines || [];
    const bannedPagination = bannedData?.pagination || {};
    const currentPagination = tab === 0 ? (medData?.pagination || {}) : tab === 1 ? bannedPagination : {};

    const tabLabels = ['Medicines', 'Banned Substances', 'Allergies'];

    // ── Single add ──
    const handleSingleAdd = async () => {
        const name = singleName.trim();
        if (!name) return;
        try {
            if (tab === 0) {
                await createMed({ generic_name: name, name }).unwrap();
            } else if (tab === 1) {
                await addBanned({ generic_name: name }).unwrap();
            } else {
                await createAllergy({ name }).unwrap();
            }
            setSnack({ open: true, msg: `Added "${name}"`, sev: 'success' });
            setSingleDialog(false);
            setSingleName('');
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    // ── Bulk upload ──
    const handleBulkUpload = async (names) => {
        try {
            let result;
            if (tab === 0) {
                result = await bulkMeds({ medicines: names.map((n) => ({ generic_name: n, name: n })) }).unwrap();
            } else if (tab === 1) {
                result = await bulkBanned({ banned_medicines: names.map((n) => ({ generic_name: n })) }).unwrap();
            } else {
                result = await bulkAllergies({ allergies: names.map((n) => ({ name: n })) }).unwrap();
            }
            const count = result?.data?.created ?? result?.created ?? names.length;
            setSnack({ open: true, msg: `${count} entries uploaded`, sev: 'success' });
            setBulkDialog(false);
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Upload failed', sev: 'error' });
        }
    };

    // ── Delete ──
    const handleDelete = async (id) => {
        try {
            if (tab === 0) await deleteMed(id).unwrap();
            else if (tab === 1) await removeBanned(id).unwrap();
            else await deleteAllergy(id).unwrap();
            setSnack({ open: true, msg: 'Removed', sev: 'success' });
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Failed', sev: 'error' });
        }
    };

    // ── Inline edit ──
    const startEditing = (item) => {
        const nameKey = tab === 2 ? 'name' : 'generic_name';
        setEditingRow(item.id);
        setEditingName(item[nameKey] || '');
    };

    const cancelEditing = () => {
        setEditingRow(null);
        setEditingName('');
    };

    const saveEditing = async (id) => {
        const trimmed = editingName.trim();
        if (!trimmed) return;
        try {
            if (tab === 0) {
                await updateMed({ id, generic_name: trimmed, name: trimmed }).unwrap();
            } else if (tab === 1) {
                await updateBanned({ id, generic_name: trimmed }).unwrap();
            }
            // TODO: allergy update endpoint if needed
            setSnack({ open: true, msg: 'Name updated', sev: 'success' });
            cancelEditing();
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Update failed', sev: 'error' });
        }
    };

    // ── Toggle active/inactive ──
    const handleToggleActive = async (item) => {
        const newActive = !item.is_active;
        try {
            if (tab === 0) {
                await updateMed({ id: item.id, is_active: newActive }).unwrap();
            } else if (tab === 1) {
                await updateBanned({ id: item.id, is_active: newActive }).unwrap();
            }
            setSnack({ open: true, msg: newActive ? 'Enabled' : 'Disabled (hidden)', sev: 'info' });
        } catch (err) {
            setSnack({ open: true, msg: err?.data?.message || 'Toggle failed', sev: 'error' });
        }
    };

    // ── Current list data ──
    const listData = tab === 0 ? medicines : tab === 1 ? bannedList : allergyList;
    const isLoading = tab === 0 ? medLoading : tab === 1 ? bannedLoading : allergyLoading;
    const nameKey = tab === 2 ? 'name' : 'generic_name';
    const headerBg = tab === 0 ? 'grey.100' : tab === 1 ? '#fce4ec' : '#fff3e0';

    return (
        <Box sx={{ p: 3 }}>
            <Box display="flex" alignItems="center" gap={1} mb={3}>
                <MedicationIcon fontSize="large" color="primary" />
                <Typography variant="h4" fontWeight="bold">Medicine Catalog</Typography>
            </Box>

            <Paper sx={{ mb: 3 }}>
                <Tabs value={tab} onChange={(_, v) => { setTab(v); setSearch(''); setPage(0); }}>
                    {tabLabels.map((l, i) => <Tab key={i} label={l} />)}
                </Tabs>
            </Paper>

            {/* Search + Add + Bulk */}
            <Box display="flex" gap={2} mb={2} alignItems="center" flexWrap="wrap">
                <TextField
                    size="small" placeholder="Search..." value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
                    sx={{ minWidth: 280 }}
                />
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setSingleName(''); setSingleDialog(true); }}>
                    Add One
                </Button>
                <Button variant="outlined" startIcon={<ContentPasteIcon />} onClick={() => setBulkDialog(true)}>
                    Bulk Upload
                </Button>
            </Box>

            {/* ════════ Table ════════ */}
            <TableContainer component={Paper}>
                {isLoading ? (
                    <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
                ) : (
                    <>
                        <Table size="small">
                            <TableHead>
                                <TableRow sx={{ bgcolor: headerBg }}>
                                    <TableCell sx={{ width: 60 }}><b>#</b></TableCell>
                                    <TableCell><b>{tab === 2 ? 'Allergy Name' : 'Generic Name'}</b></TableCell>
                                    {tab !== 2 && <TableCell align="center" sx={{ width: 100 }}><b>Active</b></TableCell>}
                                    <TableCell align="right" sx={{ width: 140 }}><b>Actions</b></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {listData.map((item, idx) => (
                                    <TableRow
                                        key={item.id} hover
                                        sx={{ opacity: item.is_active === false ? 0.5 : 1 }}
                                    >
                                        <TableCell>{page * rowsPerPage + idx + 1}</TableCell>
                                        <TableCell>
                                            {editingRow === item.id ? (
                                                <TextField
                                                    size="small" autoFocus fullWidth
                                                    value={editingName}
                                                    onChange={(e) => setEditingName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') saveEditing(item.id);
                                                        if (e.key === 'Escape') cancelEditing();
                                                    }}
                                                />
                                            ) : tab === 1 ? (
                                                <Chip label={item[nameKey]} icon={<BlockIcon />} color="error" variant="outlined" size="small" />
                                            ) : (
                                                <Typography variant="body2">
                                                    {item[nameKey]}
                                                    {item.is_active === false && (
                                                        <Chip label="Hidden" size="small" sx={{ ml: 1 }} color="default" variant="outlined" />
                                                    )}
                                                </Typography>
                                            )}
                                        </TableCell>
                                        {tab !== 2 && (
                                            <TableCell align="center">
                                                <Tooltip title={item.is_active ? 'Click to hide' : 'Click to enable'}>
                                                    <Switch
                                                        size="small"
                                                        checked={item.is_active !== false}
                                                        onChange={() => handleToggleActive(item)}
                                                        color={tab === 1 ? 'error' : 'primary'}
                                                    />
                                                </Tooltip>
                                            </TableCell>
                                        )}
                                        <TableCell align="right">
                                            {editingRow === item.id ? (
                                                <>
                                                    <Tooltip title="Save">
                                                        <IconButton size="small" color="success" onClick={() => saveEditing(item.id)}>
                                                            <CheckIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                    <Tooltip title="Cancel">
                                                        <IconButton size="small" onClick={cancelEditing}>
                                                            <CloseIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </>
                                            ) : (
                                                <>
                                                    {tab !== 2 && (
                                                        <Tooltip title="Edit name">
                                                            <IconButton size="small" color="primary" onClick={() => startEditing(item)}>
                                                                <EditIcon fontSize="small" />
                                                            </IconButton>
                                                        </Tooltip>
                                                    )}
                                                    <Tooltip title="Remove permanently">
                                                        <IconButton size="small" color="error" onClick={() => handleDelete(item.id)}>
                                                            <DeleteIcon fontSize="small" />
                                                        </IconButton>
                                                    </Tooltip>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {!listData.length && (
                                    <TableRow>
                                        <TableCell colSpan={tab !== 2 ? 4 : 3} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                                            No entries yet. Click "Add One" or "Bulk Upload" above.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        {(tab === 0 || tab === 1) && (
                            <TablePagination
                                component="div" count={currentPagination.total || 0}
                                page={page} onPageChange={(_, p) => setPage(p)}
                                rowsPerPage={rowsPerPage}
                                onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value)); setPage(0); }}
                            />
                        )}
                    </>
                )}
            </TableContainer>

            {/* ═══ Single Add Dialog ═══ */}
            <Dialog open={singleDialog} onClose={() => setSingleDialog(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Add {tabLabels[tab]?.replace(/s$/, '')}</DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus fullWidth sx={{ mt: 1 }}
                        label={tab === 2 ? 'Allergy Name' : 'Generic Name'}
                        value={singleName}
                        onChange={(e) => setSingleName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSingleAdd()}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSingleDialog(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleSingleAdd} disabled={!singleName.trim()}>Add</Button>
                </DialogActions>
            </Dialog>

            {/* ═══ Bulk Upload Dialog ═══ */}
            <BulkUploadDialog
                open={bulkDialog}
                onClose={() => setBulkDialog(false)}
                onUpload={handleBulkUpload}
                title={`Bulk Upload — ${tabLabels[tab]}`}
                placeholder={`Paste ${tab === 2 ? 'allergy' : 'generic'} names (one per line, or comma-separated)`}
                uploading={bulkMedsLoading || bulkBannedLoading || bulkAllergyLoading}
            />

            <Snackbar open={snack.open} autoHideDuration={4000} onClose={() => setSnack({ ...snack, open: false })}>
                <Alert severity={snack.sev} onClose={() => setSnack({ ...snack, open: false })}>{snack.msg}</Alert>
            </Snackbar>
        </Box>
    );
};

export default MedicineCatalogPage;
