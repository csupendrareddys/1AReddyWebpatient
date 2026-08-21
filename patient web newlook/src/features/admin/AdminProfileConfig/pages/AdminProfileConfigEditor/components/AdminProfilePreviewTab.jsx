/**
 * AdminProfilePreviewTab — Shows a live preview of the admin profile page
 * using the current draft config, rendered inside the AdminProfileSetting component.
 */
import { Box, Paper, Typography, Alert } from '@mui/material';
import AdminProfileSetting from '../../../../AdminProfileSetting/pages/AdminProfileSetting/AdminProfileSetting';

const AdminProfilePreviewTab = ({ localDraft, localFieldConfigs }) => {
    if (!localDraft) {
        return (
            <Alert severity="info">
                No draft configuration available for preview. Save a draft first.
            </Alert>
        );
    }

    // Build a config override object matching the shape the page config hook expects
    const configOverride = {
        page_config: {
            ...localDraft,
            fields: localDraft.fields || { sections: [] },
        },
        field_configs: localFieldConfigs || [],
    };

    return (
        <Box>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                This preview shows how the Sub-Admin Profile Settings page will appear with the current draft configuration.
            </Typography>
            <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2, maxHeight: '80vh', overflowY: 'auto' }}>
                <AdminProfileSetting
                    configOverride={configOverride}
                    previewMode={true}
                />
            </Paper>
        </Box>
    );
};

export default AdminProfilePreviewTab;
