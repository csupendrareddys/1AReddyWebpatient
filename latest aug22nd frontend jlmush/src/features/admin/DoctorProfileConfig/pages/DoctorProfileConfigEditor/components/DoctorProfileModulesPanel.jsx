/**
 * DoctorProfileModulesPanel — per-module DRAFT/PREVIEW/LIVE controls.
 *
 * Round 9, Phase 4: instead of one page-wide publish lifecycle for
 * the entire doctor_profile page, each "Control" (module) gets its
 * own. This panel lists every module that
 * ``Backend/app/api/doctor_profile_config/modules.py`` declares and
 * lets the operator promote / publish them independently.
 *
 * It sits above the existing section accordions in the Editor tab —
 * the legacy page-wide ConfigEditorHeader at the top of the editor
 * still works during the back-compat window.
 */
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material';

import ModuleLifecyclePanel from '../../../../../../common/components/ModuleLifecyclePanel/ModuleLifecyclePanel';
import {
    useListDoctorProfileModulesQuery,
    usePromoteDoctorProfileModuleToPreviewMutation,
    usePublishDoctorProfileModuleMutation,
    useRestoreDoctorProfileModuleVersionMutation,
    useGetDoctorProfileModuleHistoryQuery,
} from '../../../../api/doctorProfileConfigEndpoints';


// Friendly labels for each module identifier — mirrors the editor
// sidebar copy operators already see. Falls back to the raw key when
// a module isn't in the map (eg. a future module added before this
// file is updated).
const MODULE_LABELS = {
    personal_professional: 'Personal & Professional',
    addresses: 'Addresses',
    signatures_verification: 'Signatures & Verification',
    about_me: 'About Me',
    education: 'Education',
    bank_details: 'Bank Details',
    declaration_documents: 'Declaration Documents',
    scheduling: 'Scheduling',
    analytics: 'Analytics',
    treatable_symptoms: 'Treatable Symptoms',
};


function ModuleRow({ moduleKey, states, canEdit }) {
    const [promote, { isLoading: isPromoting }] =
        usePromoteDoctorProfileModuleToPreviewMutation();
    const [publish, { isLoading: isPublishing }] =
        usePublishDoctorProfileModuleMutation();
    const [restore, { isLoading: isRestoring }] =
        useRestoreDoctorProfileModuleVersionMutation();
    const { data: history = [] } =
        useGetDoctorProfileModuleHistoryQuery(moduleKey);

    const handlePromote = async () => {
        try {
            await promote(moduleKey).unwrap();
        } catch (err) {
            console.error('promote failed', err);
        }
    };
    const handlePublish = async (note) => {
        try {
            await publish({ moduleKey, note }).unwrap();
        } catch (err) {
            console.error('publish failed', err);
        }
    };
    const handleRestore = async (versionId) => {
        try {
            await restore({ moduleKey, versionId }).unwrap();
        } catch (err) {
            console.error('restore failed', err);
        }
    };

    return (
        <ModuleLifecyclePanel
            moduleKey={moduleKey}
            moduleLabel={MODULE_LABELS[moduleKey] || moduleKey}
            draft={states?.draft || null}
            preview={states?.preview || null}
            live={states?.live || null}
            canEdit={canEdit}
            isBusy={isPromoting || isPublishing || isRestoring}
            onPromoteToPreview={handlePromote}
            onPublish={handlePublish}
            onRestore={handleRestore}
            history={history}
        />
    );
}


const DoctorProfileModulesPanel = ({ canEdit = true }) => {
    const { data: modules, isLoading, isError, error } =
        useListDoctorProfileModulesQuery();

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={20} />
            </Box>
        );
    }

    if (isError) {
        return (
            <Alert severity="error" sx={{ mb: 2 }}>
                Could not load per-module status:{' '}
                {error?.data?.message || error?.message || 'unknown error'}
            </Alert>
        );
    }

    if (!modules?.length) {
        return null;
    }

    return (
        <Paper elevation={1} sx={{ p: 2, mb: 3, bgcolor: '#fafafa' }}>
            <Box sx={{ mb: 2 }}>
                <Typography variant="h6" fontWeight="bold">
                    Module Publish Controls
                </Typography>
                <Typography variant="body2" color="text.secondary">
                    Each module below carries its own DRAFT → PREVIEW → LIVE
                    cycle. Publishing one does not affect the others. The
                    page-wide controls at the top of this page still work
                    during the migration window — both surfaces edit the
                    same underlying field rows.
                </Typography>
            </Box>
            {modules.map(({ module: moduleKey, states }) => (
                <ModuleRow
                    key={moduleKey}
                    moduleKey={moduleKey}
                    states={states}
                    canEdit={canEdit}
                />
            ))}
        </Paper>
    );
};


export default DoctorProfileModulesPanel;
