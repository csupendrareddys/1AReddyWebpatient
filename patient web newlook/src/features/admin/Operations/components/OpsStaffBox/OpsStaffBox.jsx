/**
 * OpsStaffBox — one provider's staff, inside the Operations member detail.
 *
 * Adding is direct here, because the practice a staff row belongs to is already
 * chosen: the form has no practice question to ask. The vertical-wide roster
 * beside the permission matrix has to ask for one, which is what
 * ``LinkStaffDialog`` is for — and the same dialog is what moves someone OUT of
 * this practice, since re-anchoring is the one staff edit this screen cannot
 * express with a provider already fixed.
 *
 * Renders the same ``ProviderStaffPanel`` the provider sees on their own My
 * Link page, against the admin endpoints instead of the self-service ones —
 * so an operator adding a receptionist for a clinic is doing exactly what the
 * clinic would have done, with the same fields and the same validation.
 */
import { useState } from 'react';
import { Alert, Box, Snackbar } from '@mui/material';

import LinkStaffDialog from
    '../../permissions/components/LinkStaffDialog/LinkStaffDialog';
import ProviderStaffPanel from
    '../../permissions/components/ProviderStaffPanel/ProviderStaffPanel';
import {
    useGetProviderStaffQuery,
    useGetProviderRolesQuery,
    useCreateProviderStaffMutation,
    useUpdateProviderStaffMutation,
    useDeleteProviderStaffMutation,
    useSetProviderStaffRolesMutation,
} from '../../permissions/api/providerRbacEndpoints';

const LABEL = { doctor: 'doctor', clinic: 'clinic', hospital: 'hospital' };

export default function OpsStaffBox({ providerType, providerId }) {
    const { data, isFetching } = useGetProviderStaffQuery({
        providerType, provider_id: providerId, per_page: 100,
    });
    const { data: roles = [] } = useGetProviderRolesQuery(providerType);

    const [createStaff, { isLoading: creating }] = useCreateProviderStaffMutation();
    const [updateStaff, { isLoading: updating }] = useUpdateProviderStaffMutation();
    const [deleteStaff] = useDeleteProviderStaffMutation();
    const [setRoles] = useSetProviderStaffRolesMutation();

    const [snack, setSnack] = useState(null);
    // The staff row being re-anchored; null closed. An object per open so the
    // dialog remounts and drops its previous draft.
    const [linking, setLinking] = useState(null);

    const remove = async (member) => {
        try {
            await deleteStaff({ staffId: member.id, providerType }).unwrap();
            setSnack({ severity: 'success', message: `${member.full_name} removed` });
        } catch (err) {
            setSnack({
                severity: 'error',
                message: err?.data?.message || 'Could not remove this staff member',
            });
        }
    };

    return (
        <Box>
            <ProviderStaffPanel
                providerType={providerType}
                providerId={providerId}
                providerLabel={LABEL[providerType] || 'provider'}
                staff={data?.staff || []}
                roles={roles.filter((r) => r.is_active)}
                isLoading={isFetching}
                busy={creating || updating}
                onCreate={async (form) => {
                    await createStaff({
                        providerType, provider_id: providerId, ...form,
                    }).unwrap();
                    setSnack({ severity: 'success', message: 'Staff member added' });
                }}
                onUpdate={(member, form) => updateStaff({
                    staffId: member.id, providerType, ...form,
                }).unwrap()}
                onSetRoles={(member, roleIds) => setRoles({
                    staffId: member.id, providerType, roleIds,
                }).unwrap()}
                onDelete={remove}
                onLink={(member) => setLinking({ member })}
            />
            {linking && (
                <LinkStaffDialog
                    open
                    member={linking.member}
                    defaultProviderType={providerType}
                    onClose={() => setLinking(null)}
                    onDone={(message) => {
                        setLinking(null);
                        setSnack({ severity: 'success', message });
                    }}
                />
            )}
            <Snackbar
                open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
            >
                <Alert severity={snack?.severity} onClose={() => setSnack(null)}
                    sx={{ width: '100%' }}>
                    {snack?.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
