/**
 * LinkRelationshipPanel — what Partner, Associate and Employee each mean.
 *
 * The other RBAC on this screen answers "what may a practice let its own staff
 * do". This one answers "what may one organisation do to another" when a
 * doctor affiliates themselves with a clinic in My Link and calls the
 * relationship Employee. Both are provider permissions and both live here;
 * they are not the same mechanism and are not merged.
 *
 * **Sections, not endpoints — and that is the safety property, not a
 * simplification.** A cell picks how much of one section of the doctor's
 * practice a relationship opens. It cannot name a route, so the things that
 * must never be reachable — a doctor's bank accounts, their payouts, joining a
 * live consultation — stay unreachable under every possible configuration:
 * they belong to no section at all. An editor over routes would have been an
 * editor that could grant them.
 *
 * **What is NOT editable here: who holds a relationship.** A doctor writes
 * that when they connect, and no operator assigns it — which is the whole
 * reason the relationship can stand in for a permission grant. This screen
 * only decides what the word means.
 *
 * Cells that match the shipped default aren't stored, so the table stays a
 * list of deliberate exceptions and a later change to the defaults still
 * reaches every tenant that hadn't opted out. The UI shows which cells are
 * modified and offers a way back.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, MenuItem, Paper, Select,
    Snackbar, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
    TableRow, Tooltip, Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import {
    useGetLinkRelationshipPolicyQuery,
    useSaveLinkRelationshipPolicyMutation,
} from '../../api/providerRbacEndpoints';

/** Colour per access level — read as a ladder, weakest to strongest. */
const ACCESS_COLOR = { none: 'default', view: 'info', full: 'success' };

const LinkRelationshipPanel = ({ canEdit = true }) => {
    const { data, isLoading, isError } = useGetLinkRelationshipPolicyQuery();
    const [save, { isLoading: isSaving }] = useSaveLinkRelationshipPolicyMutation();

    // Local edits, keyed the same shape the PUT takes. Seeded from the server
    // and reseeded whenever it answers again, so a save lands the authoritative
    // matrix rather than leaving the screen showing what was typed.
    const [draft, setDraft] = useState(null);
    const [toast, setToast] = useState(null);

    const serverMatrix = useMemo(() => Object.fromEntries(
        (data?.relationships || []).map((r) => [r.key, { ...r.access }]),
    ), [data]);

    useEffect(() => {
        if (data) setDraft(Object.fromEntries(
            (data.relationships || []).map((r) => [r.key, { ...r.access }]),
        ));
    }, [data]);

    if (isLoading || !draft) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
    }
    if (isError) {
        return <Alert severity="error">Couldn&apos;t load the relationship tiers.</Alert>;
    }

    const sections = data.sections || [];
    const levels = data.access_levels || [];
    const relationships = data.relationships || [];

    const setCell = (tier, section, access) => setDraft((d) => ({
        ...d, [tier]: { ...d[tier], [section]: access },
    }));

    const dirty = relationships.some((r) => sections.some(
        (s) => draft[r.key]?.[s.key] !== serverMatrix[r.key]?.[s.key],
    ));

    const resetToDefaults = () => setDraft(Object.fromEntries(
        relationships.map((r) => [r.key, { ...r.defaults }]),
    ));

    const doSave = async () => {
        try {
            const res = await save(draft).unwrap();
            setToast({ severity: 'success', message: res?.message || 'Saved.' });
        } catch (err) {
            setToast({ severity: 'error', message: err?.data?.message || 'Save failed.' });
        }
    };

    return (
        <Box>
            <Alert severity="info" sx={{ mb: 2 }}>
                A doctor picks <b>Partner</b>, <b>Associate</b> or <b>Employee</b> when they
                affiliate themselves with a clinic or hospital in My Link, and that word is
                what decides how much of their practice the facility can run. This is where
                the words are defined. <b>One matrix for the whole tenant</b> — a
                relationship is between a doctor and a facility, so it reads the same on
                every vertical.
                <br />
                Bank details, payouts and joining a live consultation belong to no section
                and stay with the doctor whatever is set here.
            </Alert>

            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700, bgcolor: '#f5f5f5', minWidth: 210 }}>
                                Relationship
                            </TableCell>
                            {sections.map((s) => (
                                <TableCell key={s.key} sx={{ fontWeight: 700, bgcolor: '#f5f5f5', minWidth: 160 }}>
                                    <Tooltip title={`${s.endpoint_count} endpoints`}>
                                        <span>{s.label}</span>
                                    </Tooltip>
                                </TableCell>
                            ))}
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {relationships.map((r) => (
                            <TableRow key={r.key} hover>
                                <TableCell>
                                    <Typography variant="body2" fontWeight={700}>{r.label}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {r.summary}
                                    </Typography>
                                </TableCell>
                                {sections.map((s) => {
                                    const value = draft[r.key]?.[s.key] ?? 'none';
                                    // "Changed from what ships" is the useful
                                    // signal, not "changed since I opened the
                                    // page" — the latter is already visible in
                                    // the Save button being enabled.
                                    const modified = value !== r.defaults?.[s.key];
                                    return (
                                        <TableCell key={s.key}>
                                            <Select
                                                size="small"
                                                fullWidth
                                                value={value}
                                                disabled={!canEdit}
                                                onChange={(e) => setCell(r.key, s.key, e.target.value)}
                                                sx={{
                                                    '& .MuiSelect-select': { py: 0.6 },
                                                    ...(modified ? { bgcolor: '#fff8e1' } : {}),
                                                }}
                                            >
                                                {levels.map((l) => (
                                                    <MenuItem key={l.key} value={l.key}>
                                                        <Chip
                                                            size="small"
                                                            variant={l.key === 'none' ? 'outlined' : 'filled'}
                                                            color={ACCESS_COLOR[l.key]}
                                                            label={l.label}
                                                        />
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                            {modified && (
                                                <Typography variant="caption" color="text.secondary">
                                                    default: {r.defaults?.[s.key]}
                                                </Typography>
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </TableContainer>

            {canEdit && (
                <Stack direction="row" spacing={1} sx={{ mt: 2 }} justifyContent="flex-end">
                    <Button startIcon={<RestartAltIcon />} onClick={resetToDefaults}>
                        Reset to shipped defaults
                    </Button>
                    <Button
                        variant="contained" startIcon={<SaveIcon />}
                        onClick={doSave} disabled={!dirty || isSaving}
                    >
                        {isSaving ? 'Saving…' : 'Save'}
                    </Button>
                </Stack>
            )}

            <Snackbar
                open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={toast?.severity} variant="filled">{toast?.message}</Alert>
            </Snackbar>
        </Box>
    );
};

export default LinkRelationshipPanel;
