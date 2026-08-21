/**
 * ProviderStaffPanel — the people who work for a doctor, clinic or hospital,
 * and which roles they hold.
 *
 * Mounted two ways, and the difference is one prop:
 *
 *   with ``providerId``    one practice's staff. Full CRUD — this is the
 *                          Staff tab on an Operations member-detail page, and
 *                          the provider's own My Link → Support Staff.
 *   without ``providerId`` every practice in the vertical, read-mostly. This
 *                          is the Staff tab beside the permission matrix,
 *                          where the question is "who holds this role", not
 *                          "who works here". Adding is hidden rather than
 *                          disabled, because there is no provider to add them
 *                          TO — a form that can't be submitted is worse than
 *                          an absent one.
 *
 * Role assignment is available in both, because that's the same act either
 * way: it names a role from the tenant's curated list.
 *
 * A staff member MAY now have a sign-in — an email and a password given here
 * create one, on the same login page the practice itself uses. What that login
 * gets them is still only what the door lets through: the role grants are real
 * rows, but nothing enforces them at sign-in yet, so the panel says so rather
 * than letting an operator assume the safer thing.
 */
import { useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, FormControlLabel, IconButton, MenuItem, Paper,
    Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import LinkOutlinedIcon from '@mui/icons-material/LinkOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';

const EMPTY_FORM = {
    first_name: '', last_name: '', email: '', phone_number: '',
    designation: '', employee_code: '', notes: '', role_ids: [], branch_ids: [],
    password: '', revoke_login: false,
};

const STATUS_COLOR = { active: 'success', suspended: 'warning' };

// Mirrors the floor the backend applies when it creates the login, so a too-
// short password is refused here rather than after a round trip.
const MIN_PASSWORD_LENGTH = 8;

export default function ProviderStaffPanel({
    providerType,
    providerId,
    providerLabel = 'provider',
    staff = [],
    roles = [],
    isLoading,
    onCreate,
    onUpdate,
    onDelete,
    onSetRoles,
    onLink,
    busy,
    // False when the viewer is themselves staff. They may keep the directory
    // up to date, but roles and sign-ins are how you would promote yourself, so
    // the server refuses those writes and the form must not offer them.
    canManageAccess = true,
    // Per-action grants, for the staff-facing mount. Default open so the admin
    // and provider callers that predate this are unaffected.
    canCreate = true,
    canEdit = true,
    canDelete = true,
    // Per-branch access (clinic providers only). When true and editing an
    // existing member, a Branches multi-select appears, saved via onSetBranches.
    branches = [],
    onSetBranches,
    showBranches = false,
}) {
    const scoped = !!providerId;
    const [form, setForm] = useState(null);      // null = dialog closed
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');

    const hasLogin = !!editing?.can_login;

    const openAdd = () => { setEditing(null); setForm({ ...EMPTY_FORM }); setError(''); };
    const openEdit = (member) => {
        setEditing(member);
        setForm({
            first_name: member.first_name || '',
            last_name: member.last_name || '',
            email: member.email || '',
            phone_number: member.phone_number || '',
            designation: member.designation || '',
            employee_code: member.employee_code || '',
            notes: member.notes || '',
            role_ids: (member.roles || []).map((r) => r.id),
            branch_ids: member.branch_ids || [],
            // Never carries a password in, not even a masked stand-in: the
            // stored one is a hash nobody can show, and a dotted field would
            // read as "here it is" and get saved back as literal dots.
            password: '', revoke_login: false,
        });
        setError('');
    };

    const field = (name) => ({
        value: form?.[name] ?? '',
        onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })),
    });

    // Credentials only travel when they were actually typed. A blank password
    // on an edit means "leave the current one alone", so sending the empty
    // string — which a server could read as "set it to nothing" — is exactly
    // the mistake to avoid.
    const payloadOf = ({ password, revoke_login: revoke, role_ids: roleIds, ...rest }) => ({
        ...rest,
        // Roles ride along only on create, and only for someone allowed to set
        // them; on edit they go through onSetRoles as their own audited call.
        ...(canManageAccess && !editing ? { role_ids: roleIds } : {}),
        ...(canManageAccess && password ? { password } : {}),
        ...(canManageAccess && revoke ? { revoke_login: true } : {}),
    });

    const submit = async () => {
        if (!form.first_name.trim()) {
            setError('First name is required');
            return;
        }
        if (canManageAccess && form.password && !form.email.trim()) {
            setError('A login email is required to set a password');
            return;
        }
        if (canManageAccess && form.password && form.password.length < MIN_PASSWORD_LENGTH) {
            setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
            return;
        }
        try {
            if (editing) {
                await onUpdate(editing, payloadOf(form));
                // Roles are a separate endpoint on purpose — assigning a role
                // is an access change and deserves its own audit line rather
                // than riding along inside a name edit.
                if (canManageAccess) await onSetRoles(editing, form.role_ids);
                // Branch access is its own audited call too, and only on edit —
                // a new staff member has no branches until the practice grants
                // them (create doesn't return an id to attach them to).
                if (showBranches && onSetBranches) await onSetBranches(editing, form.branch_ids);
            } else {
                await onCreate(payloadOf(form));
            }
            setForm(null);
        } catch (err) {
            setError(err?.data?.message || err?.data?.error || 'Could not save this staff member');
        }
    };

    return (
        <Box>
            <Alert severity="info" icon={<BadgeOutlinedIcon />} sx={{ mb: 2 }}>
                Staff are the people who work for {scoped ? `this ${providerLabel}` : `a ${providerLabel}`} —
                a receptionist, a practice manager, a billing clerk.
                {canManageAccess ? (
                    <>
                        {' '}Give someone a login email and password and they can sign in at the same
                        page the {providerLabel} uses; leave both blank and they stay a record with
                        no account. A role decides which screens they see when they do.
                    </>
                ) : (
                    <>
                        {' '}You can keep this list current. Sign-ins and roles stay with
                        the {providerLabel}.
                    </>
                )}
            </Alert>

            <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="subtitle1" fontWeight={600}>
                    {scoped ? 'Staff' : `All ${providerLabel} staff`}
                </Typography>
                <Chip size="small" variant="outlined" label={`${staff.length} member${staff.length === 1 ? '' : 's'}`} />
                <Box sx={{ flexGrow: 1 }} />
                {scoped && canCreate && (
                    <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openAdd}>
                        Add staff member
                    </Button>
                )}
            </Paper>

            <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
                <Table size="small">
                    <TableHead>
                        <TableRow>
                            <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                            {!scoped && <TableCell sx={{ fontWeight: 700 }}>Works for</TableCell>}
                            <TableCell sx={{ fontWeight: 700 }}>Contact</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Roles</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 700 }} align="right">Actions</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {isLoading && (
                            <TableRow>
                                <TableCell colSpan={scoped ? 5 : 6} align="center" sx={{ py: 5 }}>
                                    <CircularProgress size={26} />
                                </TableCell>
                            </TableRow>
                        )}
                        {!isLoading && staff.map((member) => (
                            <TableRow key={member.id} hover>
                                <TableCell>
                                    <Typography variant="body2" fontWeight={600}>
                                        {member.full_name || '(no name)'}
                                    </Typography>
                                    {member.designation && (
                                        <Typography variant="caption" color="text.secondary">
                                            {member.designation}
                                            {member.employee_code ? ` · ${member.employee_code}` : ''}
                                        </Typography>
                                    )}
                                </TableCell>
                                {!scoped && (
                                    <TableCell>
                                        <Typography variant="body2">
                                            {member.provider_name || '—'}
                                        </Typography>
                                    </TableCell>
                                )}
                                <TableCell>
                                    <Typography variant="caption" display="block">{member.email || '—'}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {member.phone_number || '—'}
                                    </Typography>
                                </TableCell>
                                <TableCell>
                                    {(member.roles || []).length
                                        ? (
                                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                                {member.roles.map((r) => (
                                                    <Chip key={r.id} size="small" label={r.name} />
                                                ))}
                                            </Stack>
                                        )
                                        : <Typography variant="caption" color="text.secondary">No role</Typography>}
                                </TableCell>
                                <TableCell>
                                    <Chip size="small" label={member.status}
                                        color={STATUS_COLOR[member.status] || 'default'} />
                                    {/* Stated per row, not just in the banner: a
                                        row that looks like a user account is
                                        exactly where the wrong assumption forms.
                                        Naming the address when there IS a login
                                        answers the next question too — which
                                        one of this person's emails signs in. */}
                                    {member.can_login ? (
                                        <Tooltip title="Signs in with this email">
                                            <Typography variant="caption" color="success.main"
                                                display="block" sx={{ wordBreak: 'break-all' }}>
                                                {member.login_email || member.email || 'has a login'}
                                            </Typography>
                                        </Tooltip>
                                    ) : (
                                        <Typography variant="caption" color="text.secondary"
                                            display="block">
                                            no login
                                        </Typography>
                                    )}
                                </TableCell>
                                <TableCell align="right">
                                    {canEdit && (
                                        <Tooltip title={scoped ? 'Edit' : 'Edit roles'}>
                                            <IconButton size="small" onClick={() => openEdit(member)}>
                                                <EditOutlinedIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    {/* Re-anchoring someone to another practice is
                                        the caller's screen to own — this panel
                                        only offers the affordance when one was
                                        handed in. */}
                                    {onLink && (
                                        <Tooltip title="Link to a different practice">
                                            <IconButton size="small" onClick={() => onLink(member)}>
                                                <LinkOutlinedIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                    {scoped && canDelete && (
                                        <Tooltip title="Remove">
                                            <IconButton size="small" color="error"
                                                onClick={() => onDelete(member)}>
                                                <DeleteOutlineIcon fontSize="small" />
                                            </IconButton>
                                        </Tooltip>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                        {!isLoading && !staff.length && (
                            <TableRow>
                                <TableCell colSpan={scoped ? 5 : 6} align="center"
                                    sx={{ py: 6, color: 'text.secondary' }}>
                                    {scoped
                                        ? 'No staff yet. Add the people who work here to give them roles.'
                                        : `No ${providerLabel} has added staff yet.`}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            <Dialog open={!!form} onClose={() => setForm(null)} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {editing ? `Edit ${editing.full_name || 'staff member'}` : 'Add staff member'}
                </DialogTitle>
                <DialogContent>
                    {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
                    <Stack spacing={2} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={2}>
                            <TextField label="First name" required fullWidth size="small" {...field('first_name')} />
                            <TextField label="Last name" fullWidth size="small" {...field('last_name')} />
                        </Stack>
                        <Stack direction="row" spacing={2}>
                            <TextField label="Phone" fullWidth size="small" {...field('phone_number')} />
                            <TextField label="Designation" fullWidth size="small"
                                placeholder="Receptionist" {...field('designation')} />
                        </Stack>
                        <TextField label="Employee code" fullWidth size="small" {...field('employee_code')} />

                        {/* Boxed off rather than sitting in the run of contact
                            fields: everything above describes a person, this
                            creates an account, and the two shouldn't look like
                            the same kind of edit. The email lives here because
                            it IS the sign-in identity — one address, not a
                            contact one and a login one that drift apart. */}
                        <Box sx={{
                            border: '1px solid', borderColor: 'divider',
                            borderRadius: 1, p: 2,
                            display: canManageAccess ? 'block' : 'none',
                        }}>
                            <Stack direction="row" alignItems="center" spacing={1}>
                                <LockOutlinedIcon fontSize="small" color="action" />
                                <Typography variant="subtitle2" fontWeight={600}>
                                    Sign-in access
                                </Typography>
                                {hasLogin && (
                                    <Chip size="small" color="success" variant="outlined"
                                        label="Has a login" />
                                )}
                            </Stack>
                            <Typography variant="caption" color="text.secondary" display="block"
                                sx={{ mt: 0.5, mb: 2 }}>
                                Fill in both and this person can sign in at the same login page
                                {' '}{scoped ? `this ${providerLabel}` : `the ${providerLabel}`} uses.
                                Leave them blank and they have no account — just a record of who
                                works here.
                            </Typography>
                            <Stack direction="row" spacing={2}>
                                <TextField
                                    label="Login email" type="email" fullWidth size="small"
                                    disabled={!!form?.revoke_login}
                                    helperText="Also used as their contact address."
                                    {...field('email')}
                                />
                                <TextField
                                    label={hasLogin ? 'Set a new password' : 'Password'}
                                    type="password" fullWidth size="small"
                                    // Browsers offer to fill a saved password into
                                    // anything called "password"; this field is for
                                    // someone else's account, never the operator's.
                                    autoComplete="new-password"
                                    disabled={!!form?.revoke_login}
                                    helperText={hasLogin
                                        ? 'Leave blank to keep the current one.'
                                        : `At least ${MIN_PASSWORD_LENGTH} characters.`}
                                    {...field('password')}
                                />
                            </Stack>
                            {hasLogin && (
                                <FormControlLabel
                                    sx={{ mt: 1 }}
                                    control={(
                                        <Checkbox
                                            size="small" checked={!!form?.revoke_login}
                                            onChange={(e) => setForm((f) => ({
                                                ...f, revoke_login: e.target.checked,
                                            }))}
                                        />
                                    )}
                                    label={(
                                        <Typography variant="caption">
                                            Revoke this login — they stay on the roster and keep
                                            their history, but can no longer sign in.
                                        </Typography>
                                    )}
                                />
                            )}
                        </Box>

                        {canManageAccess ? (
                            <TextField
                                select SelectProps={{ multiple: true }} label="Roles" fullWidth size="small"
                                value={form?.role_ids || []}
                                onChange={(e) => setForm((f) => ({ ...f, role_ids: e.target.value }))}
                                helperText={roles.length
                                    ? 'What this person is allowed to do. Enforced on the screens they can open.'
                                    : 'No roles defined for this provider type yet.'}
                            >
                                {roles.map((r) => (
                                    <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                                ))}
                            </TextField>
                        ) : (
                            <Alert severity="info" variant="outlined">
                                Roles and sign-ins are set by {`the ${providerLabel}`} itself — that
                                is what stops someone here granting themselves more than they were
                                given.
                            </Alert>
                        )}
                        {showBranches && editing && (
                            <TextField
                                select SelectProps={{ multiple: true }} label="Branch access" fullWidth size="small"
                                value={form?.branch_ids || []}
                                onChange={(e) => setForm((f) => ({ ...f, branch_ids: e.target.value }))}
                                helperText="Which branches this person may open. Their role decides what they can do there."
                            >
                                {branches.length === 0 && <MenuItem disabled>No branches yet</MenuItem>}
                                {branches.map((b) => (
                                    <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
                                ))}
                            </TextField>
                        )}
                        <TextField label="Notes" fullWidth size="small" multiline rows={2} {...field('notes')} />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setForm(null)}>Cancel</Button>
                    <Button variant="contained" onClick={submit} disabled={busy}
                        startIcon={busy ? <CircularProgress size={16} color="inherit" /> : null}>
                        {editing ? 'Save changes' : 'Add staff member'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}
