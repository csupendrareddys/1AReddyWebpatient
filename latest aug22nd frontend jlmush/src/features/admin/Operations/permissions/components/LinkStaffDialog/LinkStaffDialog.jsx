/**
 * LinkStaffDialog — attach a staff member to a practice.
 *
 * A staff row belongs to exactly one doctor, clinic or hospital, and until now
 * the only way to set that was to create the row from inside the practice's own
 * detail screen. Two things were therefore impossible: moving a receptionist
 * from one clinic to another, and adding staff from the vertical-wide roster
 * beside the permission matrix, where no practice is selected. This dialog does
 * both, and says which one it is doing.
 *
 *   MOVE    re-anchors an existing member. Opened from a row's link action with
 *           that member fixed, or from the roster with a picker over the
 *           vertical's staff.
 *   CREATE  makes a new member directly under the chosen practice — the same
 *           fields ``ProviderStaffPanel`` collects, plus the practice.
 *
 * The mode switch is hidden when a member was handed in: that member IS the
 * request, and offering "create a different person instead" there would only
 * invite a misread.
 *
 * Roles are defined per vertical, so a move across verticals drops the ones the
 * member holds. That is stated before the button, with the role names, and has
 * to be acknowledged — finding out from the success toast is finding out too
 * late to have chosen otherwise.
 *
 * Mount this only while it is open; the draft lives in local state and unmount
 * is what clears it.
 */
import { useEffect, useMemo, useState } from 'react';
import {
    Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog,
    DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem,
    Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';

import { useGetOpsMembersQuery } from '../../../api/operationsEndpoints';
import { ENTITY_LABEL, LIVE_ENTITIES } from '../../constants/permissionTree';
import {
    useCreateProviderStaffMutation,
    useGetProviderRolesQuery,
    useGetProviderStaffQuery,
    useLinkProviderStaffMutation,
} from '../../api/providerRbacEndpoints';

const EMPTY_FORM = {
    first_name: '', last_name: '', email: '', phone_number: '',
    designation: '', employee_code: '', notes: '', password: '', role_ids: [],
};

// A facility's name rides in ``first_name`` with ``last_name`` empty — the ops
// member list serves people and organisations from one shape.
const practiceName = (m) =>
    `${m?.first_name || ''} ${m?.last_name || ''}`.trim() || m?.email || `#${m?.id}`;

/**
 * The member list is queried per keystroke elsewhere in Operations, but a
 * search box there is typed into once; an Autocomplete is typed into while
 * reading its results, which is a request per character down the wire.
 */
function useDebounced(value, delay = 300) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return settled;
}

export default function LinkStaffDialog({
    open,
    onClose,
    member = null,
    defaultProviderType,
    onDone,
}) {
    const sourceType = member?.provider_type || defaultProviderType;

    const [mode, setMode] = useState(member ? 'move' : 'create');
    const [targetType, setTargetType] = useState(sourceType);
    const [practice, setPractice] = useState(null);
    const [practiceSearch, setPracticeSearch] = useState('');
    const [picked, setPicked] = useState(member);
    const [staffSearch, setStaffSearch] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);
    const [acknowledged, setAcknowledged] = useState(false);
    const [error, setError] = useState('');

    const debouncedPractice = useDebounced(practiceSearch);
    const debouncedStaff = useDebounced(staffSearch);

    const [linkStaff, { isLoading: linking }] = useLinkProviderStaffMutation();
    const [createStaff, { isLoading: creating }] = useCreateProviderStaffMutation();

    const {
        data: practiceData, isFetching: loadingPractices, isError: practicesFailed,
    } = useGetOpsMembersQuery(
        {
            memberType: targetType,
            search: debouncedPractice.trim() || undefined,
            page: 1,
            per_page: 25,
        },
        { skip: !open || !targetType },
    );
    const practices = practiceData?.members || [];

    // Only the roster picker needs this, and only when the caller didn't
    // already name the person being moved.
    const needsStaffPicker = mode === 'move' && !member;
    const {
        data: staffData, isFetching: loadingStaff, isError: staffFailed,
    } = useGetProviderStaffQuery(
        {
            providerType: sourceType,
            search: debouncedStaff.trim() || undefined,
            per_page: 25,
        },
        { skip: !open || !sourceType || !needsStaffPicker },
    );
    const staffOptions = staffData?.staff || [];

    const { data: roles = [], isFetching: loadingRoles } = useGetProviderRolesQuery(
        targetType, { skip: !open || !targetType || mode !== 'create' },
    );
    const assignableRoles = useMemo(() => roles.filter((r) => r.is_active), [roles]);

    // A practice id and a role id are both only meaningful inside one vertical,
    // so switching the vertical has to drop whatever was chosen under the old
    // one rather than send it somewhere it doesn't exist.
    useEffect(() => {
        setPractice(null);
        setPracticeSearch('');
        setForm((f) => ({ ...f, role_ids: [] }));
        setAcknowledged(false);
    }, [targetType]);

    const moving = member || picked;
    const movingFrom = moving?.provider_type || sourceType;
    const crossVertical = mode === 'move' && !!moving && targetType !== movingFrom;
    const heldRoles = moving?.roles || [];
    // Nothing is lost when they hold no roles, so don't make them tick a box to
    // confirm a consequence that won't happen.
    const needsAck = crossVertical && heldRoles.length > 0;
    const alreadyThere = mode === 'move' && !!moving && !!practice
        && !crossVertical && String(moving.provider_id) === String(practice.id);

    const busy = linking || creating;
    const targetLabel = ENTITY_LABEL[targetType] || targetType;
    const fromLabel = (ENTITY_LABEL[movingFrom] || movingFrom).toLowerCase();
    const sourceLabel = (ENTITY_LABEL[sourceType] || sourceType).toLowerCase();

    const field = (name) => ({
        value: form[name] ?? '',
        onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
    });

    const submit = async () => {
        setError('');
        if (!practice) {
            setError(`Choose the ${targetLabel.toLowerCase()} to link to`);
            return;
        }
        try {
            if (mode === 'move') {
                if (!moving) {
                    setError('Choose the staff member to move');
                    return;
                }
                const res = await linkStaff({
                    staffId: moving.id,
                    providerType: targetType,
                    providerId: practice.id,
                    fromProviderType: movingFrom,
                }).unwrap();
                // The server says whether it had to drop roles; its wording is
                // the authority on what actually happened, so it wins over ours.
                onDone?.(res?.message || (needsAck
                    ? `${moving.full_name} now works for ${practiceName(practice)}. `
                      + `Their ${fromLabel} roles were removed.`
                    : `${moving.full_name} now works for ${practiceName(practice)}`));
            } else {
                if (!form.first_name.trim()) {
                    setError('First name is required');
                    return;
                }
                const res = await createStaff({
                    providerType: targetType,
                    provider_id: practice.id,
                    ...form,
                    password: form.password.trim() || undefined,
                }).unwrap();
                onDone?.(res?.message
                    || `${form.first_name.trim()} added to ${practiceName(practice)}`);
            }
        } catch (err) {
            setError(
                err?.data?.message || err?.data?.error
                || 'Could not link this staff member',
            );
        }
    };

    const practicePicker = (
        <Autocomplete
            // Remounts when the vertical changes, which is what clears the text
            // still sitting in the box from the previous vertical's search.
            key={targetType}
            options={practices}
            getOptionLabel={practiceName}
            isOptionEqualToValue={(o, v) => o.id === v.id}
            value={practice}
            onChange={(_, v) => { setPractice(v); setError(''); }}
            // Only the typed text feeds the query; the displayed value is left
            // to MUI so that picking an option shows the practice's name rather
            // than whatever fragment was typed to find it.
            onInputChange={(_, v, reason) => { if (reason === 'input') setPracticeSearch(v); }}
            loading={loadingPractices}
            // The search already happened server-side; letting MUI filter the
            // returned page again would hide rows that legitimately matched on
            // a field the label doesn't show, like a phone number.
            filterOptions={(x) => x}
            noOptionsText={loadingPractices
                ? 'Searching…'
                : `No ${targetLabel.toLowerCase()} matched`}
            renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                    <Box>
                        <Typography variant="body2">{practiceName(option)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {option.email || option.phone_number || '—'}
                        </Typography>
                    </Box>
                </Box>
            )}
            renderInput={(params) => (
                <TextField
                    {...params} size="small" required
                    label={`${targetLabel} to link to`}
                    helperText={`Type to search ${targetLabel.toLowerCase()}s on this tenant.`}
                    InputProps={{
                        ...params.InputProps,
                        endAdornment: (
                            <>
                                {loadingPractices ? <CircularProgress size={16} /> : null}
                                {params.InputProps.endAdornment}
                            </>
                        ),
                    }}
                />
            )}
        />
    );

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                {member
                    ? `Link ${member.full_name || 'this staff member'} to a different practice`
                    : 'Link a staff member to a practice'}
                <Typography variant="body2" color="text.secondary">
                    {mode === 'move'
                        ? 'The person keeps their record; only the practice they work for changes.'
                        : 'Creates the person and attaches them to the practice in one step.'}
                </Typography>
            </DialogTitle>

            <DialogContent>
                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <Stack spacing={2} sx={{ mt: 1 }}>
                    {!member && (
                        <ToggleButtonGroup
                            exclusive size="small" fullWidth
                            value={mode}
                            onChange={(_, v) => {
                                if (!v) return;
                                setMode(v);
                                setError('');
                            }}
                        >
                            <ToggleButton value="create">
                                <PersonAddAltIcon fontSize="small" sx={{ mr: 1 }} />
                                New staff member
                            </ToggleButton>
                            <ToggleButton value="move">
                                <SwapHorizIcon fontSize="small" sx={{ mr: 1 }} />
                                Existing staff member
                            </ToggleButton>
                        </ToggleButtonGroup>
                    )}

                    {mode === 'move' && (member ? (
                        <Paper variant="outlined" sx={{ p: 1.5 }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <BadgeOutlinedIcon fontSize="small" color="action" />
                                <Box>
                                    <Typography variant="body2" fontWeight={600}>
                                        {member.full_name || '(no name)'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        Currently at {member.provider_name || 'an unnamed practice'}
                                        {' · '}{fromLabel}
                                    </Typography>
                                </Box>
                            </Stack>
                            {heldRoles.length > 0 && (
                                <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                                    {heldRoles.map((r) => (
                                        <Chip key={r.id} size="small" label={r.name} />
                                    ))}
                                </Stack>
                            )}
                        </Paper>
                    ) : (
                        <Autocomplete
                            options={staffOptions}
                            getOptionLabel={(o) => o.full_name || '(no name)'}
                            isOptionEqualToValue={(o, v) => o.id === v.id}
                            value={picked}
                            onChange={(_, v) => { setPicked(v); setAcknowledged(false); setError(''); }}
                            onInputChange={(_, v, reason) => { if (reason === 'input') setStaffSearch(v); }}
                            loading={loadingStaff}
                            filterOptions={(x) => x}
                            noOptionsText={loadingStaff ? 'Searching…' : 'No staff matched'}
                            renderOption={(props, option) => (
                                <Box component="li" {...props} key={option.id}>
                                    <Box>
                                        <Typography variant="body2">
                                            {option.full_name || '(no name)'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {option.provider_name || '—'}
                                            {option.designation ? ` · ${option.designation}` : ''}
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                            renderInput={(params) => (
                                <TextField
                                    {...params} size="small" required
                                    label="Staff member to move"
                                    helperText={`Searches ${sourceLabel} staff — the roster this screen is showing.`}
                                    InputProps={{
                                        ...params.InputProps,
                                        endAdornment: (
                                            <>
                                                {loadingStaff ? <CircularProgress size={16} /> : null}
                                                {params.InputProps.endAdornment}
                                            </>
                                        ),
                                    }}
                                />
                            )}
                        />
                    ))}

                    {needsStaffPicker && staffFailed && (
                        <Alert severity="error">
                            Could not load the {sourceLabel} staff list.
                        </Alert>
                    )}
                    {needsStaffPicker && !staffFailed && !loadingStaff
                        && !staffOptions.length && !debouncedStaff.trim() && (
                        <Alert severity="info">
                            No {sourceLabel} staff exist yet, so there is nobody to move — switch to
                            <b> New staff member</b> to create one.
                        </Alert>
                    )}

                    <TextField
                        select size="small" fullWidth label="Practice type"
                        value={targetType}
                        onChange={(e) => setTargetType(e.target.value)}
                    >
                        {LIVE_ENTITIES.map((v) => (
                            <MenuItem key={v} value={v}>{ENTITY_LABEL[v]}</MenuItem>
                        ))}
                    </TextField>

                    {practicePicker}

                    {practicesFailed && (
                        <Alert severity="error">
                            Could not load the {targetLabel.toLowerCase()} list. Close this dialog
                            and try again.
                        </Alert>
                    )}
                    {!practicesFailed && !loadingPractices && !practices.length
                        && !debouncedPractice.trim() && (
                        <Alert severity="info">
                            This tenant has no {targetLabel.toLowerCase()} on record, so there is
                            nothing to link to yet.
                        </Alert>
                    )}

                    {crossVertical && (
                        <Alert severity="warning">
                            <Typography variant="body2">
                                You are moving this person from a{' '}
                                <b>{(ENTITY_LABEL[movingFrom] || movingFrom).toLowerCase()}</b> to a{' '}
                                <b>{targetLabel.toLowerCase()}</b>. Roles are defined separately for
                                each provider type, so{' '}
                                {heldRoles.length
                                    ? 'the roles they hold today cannot follow them and will be removed:'
                                    : 'any role they held would not have followed them — they hold none, so nothing is lost.'}
                            </Typography>
                            {heldRoles.length > 0 && (
                                <>
                                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                                        {heldRoles.map((r) => (
                                            <Chip key={r.id} size="small" color="warning" label={r.name} />
                                        ))}
                                    </Stack>
                                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                                        You will need to give them {targetLabel.toLowerCase()} roles
                                        again afterwards.
                                    </Typography>
                                    <FormControlLabel
                                        sx={{ mt: 0.5 }}
                                        control={(
                                            <Checkbox
                                                size="small"
                                                checked={acknowledged}
                                                onChange={(e) => setAcknowledged(e.target.checked)}
                                            />
                                        )}
                                        label={(
                                            <Typography variant="body2">
                                                I understand these roles will be removed
                                            </Typography>
                                        )}
                                    />
                                </>
                            )}
                        </Alert>
                    )}

                    {alreadyThere && (
                        <Alert severity="info">
                            {moving.full_name} already works for {practiceName(practice)}. Pick a
                            different practice, or close this dialog.
                        </Alert>
                    )}

                    {mode === 'create' && (
                        <>
                            <Stack direction="row" spacing={2}>
                                <TextField label="First name" required fullWidth size="small"
                                    {...field('first_name')} />
                                <TextField label="Last name" fullWidth size="small"
                                    {...field('last_name')} />
                            </Stack>
                            <Stack direction="row" spacing={2}>
                                <TextField label="Email" fullWidth size="small" {...field('email')} />
                                <TextField label="Phone" fullWidth size="small"
                                    {...field('phone_number')} />
                            </Stack>
                            <Stack direction="row" spacing={2}>
                                <TextField label="Designation" fullWidth size="small"
                                    placeholder="Receptionist" {...field('designation')} />
                                <TextField label="Employee code" fullWidth size="small"
                                    {...field('employee_code')} />
                            </Stack>
                            <TextField
                                select SelectProps={{ multiple: true }} label="Roles"
                                fullWidth size="small"
                                value={form.role_ids}
                                onChange={(e) => setForm((f) => ({ ...f, role_ids: e.target.value }))}
                                disabled={loadingRoles || !assignableRoles.length}
                                helperText={loadingRoles
                                    ? 'Loading roles…'
                                    : (assignableRoles.length
                                        ? `${targetLabel} roles — what this person will be allowed to do.`
                                        : `No ${targetLabel.toLowerCase()} roles defined yet.`)}
                            >
                                {assignableRoles.map((r) => (
                                    <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                label="Password" type="password" fullWidth size="small"
                                {...field('password')}
                                helperText="Optional. An email and a password together give this person a sign-in; leave blank for a record-only staff member."
                            />
                            <TextField label="Notes" fullWidth size="small" multiline rows={2}
                                {...field('notes')} />
                        </>
                    )}
                </Stack>
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} disabled={busy}>Cancel</Button>
                <Button
                    variant="contained"
                    onClick={submit}
                    disabled={busy || !practice || alreadyThere || (needsAck && !acknowledged)
                        || (mode === 'move' && !moving)}
                    startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}
                >
                    {mode === 'move' ? 'Move staff member' : 'Create and link'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
