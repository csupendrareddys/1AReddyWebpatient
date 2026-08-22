/**
 * LinkedFamilySection — the reciprocal-adult side of Family.
 *
 * Two lists, driven by GET /patient-family/scopes:
 *   • "Family who can act for me"  — linked adults I have granted a role. I pick
 *     which role each holds (assign-role select). This is owner-only authoring:
 *     only the data-owner decides what someone may do to them.
 *   • "Accounts I can open"        — patients who granted ME a role. "Open"
 *     switches me into their scope (role-bounded), same family:<memberId>
 *     plumbing the minors use.
 *
 * The distinction is directional: a member row where I am the OWNER lets me
 * assign; a scope where I am the GRANTEE lets me open. The backend returns the
 * grantee side (`linked`); the owner side we read from the member list the
 * assign endpoint operates on, surfaced here from the same scopes payload.
 */
import { useNavigate } from 'react-router-dom';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
    List, ListItem, ListItemText, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import GroupsIcon from '@mui/icons-material/Groups';
import LoginIcon from '@mui/icons-material/Login';

import {
    useGetFamilyScopesQuery, useGetFamilyRolesQuery, useAssignMemberRoleMutation,
} from '../api/familyEndpoints';

export default function LinkedFamilySection() {
    const navigate = useNavigate();
    const { data: scopes = { linked: [], granted: [] }, isLoading } = useGetFamilyScopesQuery();
    const { data: roles = [] } = useGetFamilyRolesQuery();
    const [assign, { isLoading: assigning }] = useAssignMemberRoleMutation();

    // `linked` = accounts I can open (someone granted ME a role).
    const canOpen = scopes.linked || [];
    // `granted` = members I have linked and can assign a role to (owner side).
    const myMembers = scopes.granted || [];

    const onAssign = (memberId) => (e) =>
        assign({ memberId, roleId: e.target.value || null });

    return (
        <Card sx={{ mb: 3 }}>
            <CardContent>
                <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
                    <GroupsIcon color="primary" sx={{ mr: 1 }} />
                    <Typography variant="subtitle1" fontWeight={600}>Linked family</Typography>
                </Stack>

                {isLoading ? <CircularProgress size={22} /> : (
                    <>
                        {/* Owner side — assign each linked adult a role */}
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Family who can act for me
                        </Typography>
                        {myMembers.length === 0 ? (
                            <Typography color="text.secondary" sx={{ mb: 2 }}>
                                No linked adults yet. Link a family member from your house group,
                                then grant them a role here.
                            </Typography>
                        ) : (
                            <List dense sx={{ mb: 1 }}>
                                {myMembers.map((m) => (
                                    <ListItem key={m.member_id} divider sx={{ pr: 28 }}
                                        secondaryAction={
                                            <TextField select size="small" sx={{ minWidth: 200 }}
                                                label="Role" value={m.role_id || ''}
                                                onChange={onAssign(m.member_id)} disabled={assigning}>
                                                <MenuItem value=""><em>No access</em></MenuItem>
                                                {roles.map((r) => (
                                                    <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>
                                                ))}
                                            </TextField>
                                        }>
                                        <ListItemText primary={m.name}
                                            secondary={`${m.relation || 'Family member'}`} />
                                    </ListItem>
                                ))}
                            </List>
                        )}

                        <Divider sx={{ my: 2 }} />

                        {/* Grantee side — accounts I may open */}
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                            Accounts I can open
                        </Typography>
                        {canOpen.length === 0 ? (
                            <Typography color="text.secondary">
                                No one has given you access to their account yet.
                            </Typography>
                        ) : (
                            <List dense>
                                {canOpen.map((s) => (
                                    <ListItem key={s.member_id} divider sx={{ pr: 20 }}
                                        secondaryAction={
                                            <Stack direction="row" alignItems="center" spacing={1}>
                                                {s.role && <Chip size="small" color="primary" variant="outlined" label={s.role} />}
                                                <Button size="small" variant="outlined" startIcon={<LoginIcon />}
                                                    onClick={() => navigate(`/dashboard/patient/family/${s.member_id}`)}>
                                                    Open
                                                </Button>
                                            </Stack>
                                        }>
                                        <ListItemText primary={s.name}
                                            secondary={s.relation || 'Family member'} />
                                    </ListItem>
                                ))}
                            </List>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
