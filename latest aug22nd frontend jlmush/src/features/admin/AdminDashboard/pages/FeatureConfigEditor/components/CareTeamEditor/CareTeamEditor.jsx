/**
 * Care-team editor — "Meet your care team" on a feature page.
 *
 * Admin picks doctors from this tenant, then flips one switch per field to
 * choose what the public page reveals about each of them. Nothing is copied:
 * the backend stores only the toggles + a hand-written blurb and resolves the
 * doctor's live data at render time, so a profile edit shows up everywhere
 * that doctor appears.
 *
 * Value shape (matches ``FeatureDoctor.to_dict()``):
 *   [{ doctor_id, photo, experience, languages, location,
 *      work_qualification, description, display_order, doctor: {…} }]
 *
 * The nested ``doctor`` block on saved rows is toggle-filtered by the server,
 * so previews here read from the *unfiltered* candidates list instead.
 */
import { useMemo, useState } from 'react';
import {
    Box, Paper, Typography, TextField, Switch, Button, IconButton, Avatar,
    Dialog, DialogTitle, DialogContent, DialogActions, List, ListItemButton,
    ListItemAvatar, ListItemText, Stack, Tooltip, CircularProgress, Alert,
    InputAdornment, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import SearchIcon from '@mui/icons-material/Search';
import { useGetCareTeamCandidatesQuery } from '../../../../../api/landingPageConfigEndpoints';
import { useGetFeatureProductProvidersQuery } from '../../../../../api/marketplaceEndpoints';
import { useGetPlatformCareTeamCandidatesQuery } from '../../../../../api/platformLandingEndpoints';

// One switch per revealable field. ``valueKey`` names the matching key on a
// candidate record so we can preview what turning the switch on would show.
const TOGGLE_FIELDS = [
    { key: 'photo', label: 'Photo', valueKey: 'photo' },
    { key: 'experience', label: 'Experience', valueKey: 'experience_years' },
    { key: 'languages', label: 'Languages', valueKey: 'languages' },
    { key: 'location', label: 'Location', valueKey: 'location' },
    { key: 'work_qualification', label: 'Work qualification', valueKey: 'work_qualification' },
];

const initial = (name) => (name || '?').charAt(0).toUpperCase();

/** Human-readable preview of a candidate's value for one toggle. */
const previewValue = (candidate, field) => {
    if (!candidate) return null;
    const raw = candidate[field.valueKey];
    if (raw === null || raw === undefined || raw === '') return null;
    if (field.key === 'photo') return 'Uploaded';
    if (field.key === 'experience') return `${raw} yrs`;
    if (Array.isArray(raw)) return raw.length ? raw.join(', ') : null;
    return String(raw);
};

// ---------------------------------------------------------------------------
// Doctor picker
// ---------------------------------------------------------------------------

const DoctorPickerDialog = ({ open, onClose, candidates, isLoading, chosenIds, onPick, teamMode = false }) => {
    const [search, setSearch] = useState('');

    // Filtered client-side: a tenant's doctor list is small enough that a
    // request per keystroke would be pure overhead.
    const available = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (candidates || []).filter((c) => (
            !chosenIds.has(String(c.id))
            && (!q || (c.name || '').toLowerCase().includes(q))
        ));
    }, [candidates, chosenIds, search]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{teamMode ? 'Add a team to the care team' : 'Add a doctor to the care team'}</DialogTitle>
            <DialogContent dividers>
                <TextField
                    size="small" fullWidth autoFocus placeholder="Search by name"
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    sx={{ mb: 2 }}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon fontSize="small" />
                            </InputAdornment>
                        ),
                    }}
                />
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                        <CircularProgress size={24} />
                    </Box>
                ) : available.length === 0 ? (
                    <Alert severity="info">
                        {search.trim()
                            ? `No ${teamMode ? 'teams' : 'doctors'} match that search.`
                            : (teamMode
                                ? 'Every team for this product is already on the care team.'
                                : 'Every doctor in this tenant is already on the care team.')}
                    </Alert>
                ) : (
                    <List dense disablePadding>
                        {available.map((c) => {
                            // Team candidates preview their members; doctor
                            // candidates preview their revealable profile fields.
                            const secondary = c.isTeam
                                ? ((c.members || []).length
                                    ? `Team · ${c.members.join(', ')}`
                                    : 'Team · no members yet')
                                : (TOGGLE_FIELDS.map((f) => previewValue(c, f)).filter(Boolean).join(' · ')
                                    || 'No profile details filled in yet');
                            return (
                                <ListItemButton key={c.id} onClick={() => onPick(c)}>
                                    <ListItemAvatar>
                                        <Avatar src={c.photo || undefined}>{initial(c.name)}</Avatar>
                                    </ListItemAvatar>
                                    <ListItemText
                                        primary={c.name || (c.isTeam ? 'Unnamed team' : 'Unnamed doctor')}
                                        secondary={secondary}
                                    />
                                </ListItemButton>
                            );
                        })}
                    </List>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Done</Button>
            </DialogActions>
        </Dialog>
    );
};

// ---------------------------------------------------------------------------
// One picked doctor
// ---------------------------------------------------------------------------

const CareTeamRow = ({ row, candidate, index, total, disabled, onPatch, onMove, onRemove }) => {
    const isTeam = !!row.team_id;
    // Saved rows carry a toggle-filtered ``doctor`` block; the candidates list
    // is unfiltered, so prefer it and fall back for a doctor/team that has since
    // been removed.
    const name = isTeam
        ? (candidate?.name || row.team?.name || 'Team')
        : (candidate?.name || row.doctor?.name || 'Unknown doctor');
    const photo = candidate?.photo || row.doctor?.photo || undefined;
    const members = isTeam
        ? (candidate?.members || row.team?.members || row.team_members || [])
        : [];

    if (isTeam) {
        return (
            <Paper variant="outlined" sx={{ p: 1.5, mb: 1, borderRadius: 2, opacity: disabled ? 0.7 : 1 }}>
                <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                    <Avatar sx={{ width: 36, height: 36, bgcolor: 'warning.light' }}>{initial(name)}</Avatar>
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography fontWeight={600}>{name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            Team · {members.length} member{members.length === 1 ? '' : 's'}
                        </Typography>
                    </Box>
                    <IconButton size="small" disabled={disabled || index === 0} onClick={() => onMove(-1)}>
                        <ArrowUpwardIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton size="small" disabled={disabled || index === total - 1} onClick={() => onMove(1)}>
                        <ArrowDownwardIcon fontSize="inherit" />
                    </IconButton>
                    <IconButton size="small" color="error" disabled={disabled} onClick={onRemove}>
                        <DeleteIcon fontSize="inherit" />
                    </IconButton>
                </Stack>
                {!candidate && (
                    <Alert severity="warning" sx={{ mb: 1 }}>
                        This team no longer offers the linked product. Saving will drop it.
                    </Alert>
                )}
                {members.length > 0 && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                        {members.map((m, mi) => (
                            <Chip key={`${m}-${mi}`} size="small" label={m} variant="outlined" />
                        ))}
                    </Box>
                )}
                <TextField
                    size="small" fullWidth multiline rows={2}
                    label="Description" placeholder="What this team does for this service"
                    defaultValue={row.description || ''}
                    onBlur={(e) => onPatch({ description: e.target.value })}
                    disabled={disabled}
                />
            </Paper>
        );
    }

    return (
        <Paper
            variant="outlined"
            sx={{ p: 1.5, mb: 1, borderRadius: 2, opacity: disabled ? 0.7 : 1 }}
        >
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
                <Avatar src={photo} sx={{ width: 36, height: 36 }}>{initial(name)}</Avatar>
                <Typography fontWeight={600} sx={{ flexGrow: 1 }}>{name}</Typography>
                <IconButton size="small" disabled={disabled || index === 0}
                            onClick={() => onMove(-1)}>
                    <ArrowUpwardIcon fontSize="inherit" />
                </IconButton>
                <IconButton size="small" disabled={disabled || index === total - 1}
                            onClick={() => onMove(1)}>
                    <ArrowDownwardIcon fontSize="inherit" />
                </IconButton>
                <IconButton size="small" color="error" disabled={disabled} onClick={onRemove}>
                    <DeleteIcon fontSize="inherit" />
                </IconButton>
            </Stack>

            {!candidate && (
                <Alert severity="warning" sx={{ mb: 1 }}>
                    This doctor is no longer available in the tenant. Saving will drop them.
                </Alert>
            )}

            <TextField
                size="small" fullWidth multiline rows={2}
                label="Description" placeholder="What this doctor does for this service"
                // Uncontrolled + onBlur so typing doesn't re-patch the whole
                // feature on every keystroke (same idiom as the text rows).
                defaultValue={row.description || ''}
                onBlur={(e) => onPatch({ description: e.target.value })}
                disabled={disabled}
                sx={{ mb: 1 }}
            />

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                {TOGGLE_FIELDS.map((f) => {
                    const preview = previewValue(candidate, f);
                    const empty = candidate && !preview;
                    const control = (
                        <Box
                            sx={{
                                display: 'flex', alignItems: 'center', gap: 0.5,
                                px: 1, py: 0.25, borderRadius: 1,
                                border: '1px solid', borderColor: 'divider',
                                opacity: empty ? 0.55 : 1,
                            }}
                        >
                            <Switch
                                size="small" checked={!!row[f.key]}
                                onChange={(e) => onPatch({ [f.key]: e.target.checked })}
                                disabled={disabled}
                            />
                            <Box>
                                <Typography variant="caption" fontWeight={600} display="block">
                                    {f.label}
                                </Typography>
                                <Typography
                                    variant="caption"
                                    color={empty ? 'warning.main' : 'text.secondary'}
                                    sx={{
                                        display: 'block', maxWidth: 150,
                                        overflow: 'hidden', textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                    }}
                                >
                                    {preview || 'Not set'}
                                </Typography>
                            </Box>
                        </Box>
                    );
                    return empty ? (
                        <Tooltip
                            key={f.key}
                            title={`${name} has no ${f.label.toLowerCase()} on their profile — this stays blank until they fill it in.`}
                        >
                            <span>{control}</span>
                        </Tooltip>
                    ) : (
                        <Box key={f.key}>{control}</Box>
                    );
                })}
            </Box>
        </Paper>
    );
};

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const CareTeamEditor = ({ values = [], onChange, disabled, isPlatform = false, productId = null, offering = null }) => {
    const [pickerOpen, setPickerOpen] = useState(false);
    // Both stacks have a care team; they just read their candidate pool from
    // different endpoints. Skip the one that doesn't apply so the editor
    // doesn't fire a request it has no permission for.
    // When the feature is linked to a product (either stack), scope the pool to
    // who actually services it — consultation → doctors, service → the listing's
    // doctors, group → the team's members — instead of every doctor. ``flat``
    // expands a group's teams to their member doctors, since the care-team is a
    // doctor list. Same providers endpoint the Feature-Product Linking page uses.
    const scoped = !!productId;
    // A group offering is delivered by a TEAM, so its picker lists teams as
    // units (``flat`` off). Service / consultation stay individual doctors.
    const teamMode = scoped && offering === 'group';
    const tenantQ = useGetCareTeamCandidatesQuery({}, { skip: isPlatform || scoped });
    const platformQ = useGetPlatformCareTeamCandidatesQuery({}, { skip: !isPlatform || scoped });
    const scopedQ = useGetFeatureProductProvidersQuery(
        { offering, productId, flat: !teamMode }, { skip: !scoped },
    );
    // Product scope wins on both surfaces; fall back to the per-stack full list.
    const { data: rawCandidates = [], isLoading, isError } = scoped
        ? scopedQ : (isPlatform ? platformQ : tenantQ);
    // /providers returns {id, name, is_team?, members?}; normalise to the
    // candidate shape (teams carry their member names for the preview).
    const candidates = scoped
        ? rawCandidates.map((p) => ({
            id: p.id, name: p.name, photo: null,
            isTeam: !!p.is_team, members: p.members || [],
        }))
        : rawCandidates;

    const rows = values || [];
    // A row is keyed by whichever it pins — team or doctor.
    const chosenIds = useMemo(
        () => new Set(rows.map((r) => String(r.team_id || r.doctor_id))),
        [rows],
    );
    const candidateById = useMemo(() => {
        const map = new Map();
        (candidates || []).forEach((c) => map.set(String(c.id), c));
        return map;
    }, [candidates]);

    // display_order is always rewritten from array position — the up/down
    // arrows are the only ordering UI, so the two can never disagree.
    const commit = (next) => onChange(next.map((r, i) => ({ ...r, display_order: i })));

    const add = (candidate) => {
        // A team is pinned as a unit (its members render live); a doctor keeps
        // the per-field reveal toggles.
        const base = candidate.isTeam
            ? { team_id: String(candidate.id), team_members: candidate.members || [] }
            : { doctor_id: String(candidate.id) };
        commit([...rows, {
            ...base,
            photo: false,
            experience: false,
            languages: false,
            location: false,
            work_qualification: false,
            description: '',
        }]);
    };

    const patchRow = (index, updates) => {
        commit(rows.map((r, i) => (i === index ? { ...r, ...updates } : r)));
    };

    const move = (index, dir) => {
        const target = index + dir;
        if (target < 0 || target >= rows.length) return;
        const next = [...rows];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        commit(next);
    };

    return (
        <Box>
            {isError && (
                <Alert severity="error" sx={{ mb: 1 }}>
                    Couldn't load the doctor list. Existing selections are still editable.
                </Alert>
            )}

            {rows.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    No doctors on this service's care team yet.
                </Typography>
            ) : (
                rows.map((row, i) => (
                    <CareTeamRow
                        key={row.team_id || row.doctor_id || i}
                        row={row}
                        candidate={candidateById.get(String(row.team_id || row.doctor_id))}
                        index={i}
                        total={rows.length}
                        disabled={disabled}
                        onPatch={(updates) => patchRow(i, updates)}
                        onMove={(dir) => move(i, dir)}
                        onRemove={() => commit(rows.filter((_, idx) => idx !== i))}
                    />
                ))
            )}

            <Button
                size="small" variant="outlined" startIcon={<AddIcon />}
                onClick={() => setPickerOpen(true)} disabled={disabled}
            >
                {teamMode ? 'Add team' : 'Add doctor'}
            </Button>

            <DoctorPickerDialog
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                candidates={candidates}
                isLoading={isLoading}
                chosenIds={chosenIds}
                onPick={add}
                teamMode={teamMode}
            />
        </Box>
    );
};

export default CareTeamEditor;
