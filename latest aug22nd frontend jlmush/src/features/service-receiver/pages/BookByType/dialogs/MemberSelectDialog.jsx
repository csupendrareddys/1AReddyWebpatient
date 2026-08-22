import React from 'react';
import {
    Box, Typography, Card, CardActionArea, CardContent, CircularProgress,
    Avatar, Chip, Grid, Dialog, DialogTitle, DialogContent, IconButton,
    Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PersonIcon from '@mui/icons-material/Person';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';

import { useGetHouseGroupQuery } from '../../../api/scopedBookingApi';
import usePermissions from '../../../../../common/hooks/usePermissions';

/**
 * "Who is this appointment for?" as a popup. Self is always available; family
 * members are listed only when the tenant plan includes `patient.family`
 * (the old route used a FeatureGuard — this keeps the same gating at the UI).
 */
const MemberSelectDialog = ({ open, onClose, currentBookingFor, onSelect, isCreating }) => {
    const { hasFeature } = usePermissions();
    const familyEnabled = hasFeature('patient.family');

    const { data: houseGroupResp, isLoading } = useGetHouseGroupQuery(undefined, {
        skip: !open || !familyEnabled,
    });

    const members = Array.isArray(houseGroupResp)
        ? houseGroupResp
        : (houseGroupResp?.data?.members || houseGroupResp?.members || []);
    const bookableMembers = members.filter((m) => {
        const perms = m.permissions || {};
        return perms.visible !== false && perms.appointments && perms.appointments !== 'none';
    });

    const isCurrent = (val) => val === currentBookingFor;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
            <DialogTitle component="div" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box flex={1}>
                    <Typography variant="h6" fontWeight="bold">Who is this appointment for?</Typography>
                </Box>
                <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {isCreating && (
                    <Box display="flex" alignItems="center" gap={1} mb={2}>
                        <CircularProgress size={18} />
                        <Typography variant="body2" color="text.secondary">Setting up…</Typography>
                    </Box>
                )}

                <Grid container spacing={2}>
                    {/* Book for Self */}
                    <Grid item xs={12}>
                        <Card variant="outlined" sx={{ borderColor: isCurrent('self') ? '#4caf50' : 'divider', borderWidth: 2 }}>
                            <CardActionArea onClick={() => onSelect('self', null)} disabled={isCreating} sx={{ p: 1 }}>
                                <CardContent>
                                    <Box display="flex" alignItems="center" justifyContent="space-between">
                                        <Box display="flex" alignItems="center" gap={2}>
                                            <Avatar sx={{ bgcolor: '#4caf5020', color: '#4caf50', width: 48, height: 48 }}>
                                                <PersonIcon />
                                            </Avatar>
                                            <Box>
                                                <Typography variant="subtitle1" fontWeight="bold">Book for Myself</Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    Use your own medical records
                                                </Typography>
                                            </Box>
                                        </Box>
                                        {isCurrent('self')
                                            ? <CheckCircleIcon sx={{ color: '#4caf50' }} />
                                            : <ArrowForwardIosIcon sx={{ color: 'action.active', fontSize: 18 }} />}
                                    </Box>
                                </CardContent>
                            </CardActionArea>
                        </Card>
                    </Grid>

                    {familyEnabled && isLoading && (
                        <Grid item xs={12}>
                            <Box display="flex" justifyContent="center" py={2}><CircularProgress size={24} /></Box>
                        </Grid>
                    )}

                    {familyEnabled && bookableMembers.length > 0 && (
                        <Grid item xs={12}>
                            <Box display="flex" alignItems="center" gap={1} mt={1}>
                                <FamilyRestroomIcon color="action" />
                                <Typography variant="subtitle2" color="text.secondary">Family Members</Typography>
                            </Box>
                        </Grid>
                    )}

                    {familyEnabled && bookableMembers.map((member) => (
                        <Grid item xs={12} sm={6} key={member.member_id}>
                            <Card variant="outlined" sx={{ borderColor: isCurrent(member.member_id) ? 'primary.main' : 'divider', borderWidth: isCurrent(member.member_id) ? 2 : 1 }}>
                                <CardActionArea onClick={() => onSelect(member.member_id, member)} disabled={isCreating} sx={{ p: 1 }}>
                                    <CardContent>
                                        <Box display="flex" alignItems="center" justifyContent="space-between">
                                            <Box display="flex" alignItems="center" gap={2}>
                                                <Avatar src={member.profile_image} sx={{ width: 48, height: 48, bgcolor: 'primary.light' }}>
                                                    {(member.first_name || '?')[0]}
                                                </Avatar>
                                                <Box>
                                                    <Typography variant="subtitle1" fontWeight="bold">
                                                        {member.first_name} {member.last_name || ''}
                                                    </Typography>
                                                    <Box display="flex" gap={1} alignItems="center">
                                                        <Chip label={member.relation || 'Family'} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                                                        {member.gender && (
                                                            <Typography variant="caption" color="text.secondary">{member.gender}</Typography>
                                                        )}
                                                    </Box>
                                                </Box>
                                            </Box>
                                            {isCurrent(member.member_id)
                                                ? <CheckCircleIcon color="primary" />
                                                : <ArrowForwardIosIcon sx={{ color: 'action.active', fontSize: 18 }} />}
                                        </Box>
                                    </CardContent>
                                </CardActionArea>
                            </Card>
                        </Grid>
                    ))}

                    {familyEnabled && !isLoading && bookableMembers.length === 0 && (
                        <Grid item xs={12}>
                            <Alert severity="info" variant="outlined">
                                No family members added yet. You can add them from your profile settings.
                            </Alert>
                        </Grid>
                    )}
                </Grid>
            </DialogContent>
        </Dialog>
    );
};

export default MemberSelectDialog;
