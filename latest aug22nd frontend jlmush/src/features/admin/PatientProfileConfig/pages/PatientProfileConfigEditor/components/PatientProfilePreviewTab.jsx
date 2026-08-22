/**
 * PatientProfilePreviewTab — Renders a live preview of the Patient Profile page
 * using the actual ProfileSetting component with configOverride + previewMode.
 *
 * initialSection tells the preview which tab to auto-select.
 * All tabs remain visible but only the target tab is active/clickable.
 */
import { useMemo } from 'react';
import { Card, CardContent, Typography, Box, Alert, Chip } from '@mui/material';
import PreviewIcon from '@mui/icons-material/Preview';
import ProfileSetting from '../../../../../service-receiver/ProfileSetting/pages/ProfileSetting/ProfileSetting';

const PatientProfilePreviewTab = ({ localDraft, localFieldConfigs, sectionFilter = null }) => {
    const configOverride = useMemo(() => {
        const draft = localDraft ? { ...localDraft } : null;
        const dataSources = localDraft?.data_sources || {};

        return {
            page_config: draft,
            field_configs: localFieldConfigs || [],
            data_sources: dataSources,
        };
    }, [localDraft, localFieldConfigs]);

    const effectiveSection = sectionFilter && sectionFilter !== 'page_settings' ? sectionFilter : null;

    return (
        <Card>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <PreviewIcon color="primary" />
                    <Typography variant="h6">Live Preview</Typography>
                    {effectiveSection && (
                        <Chip label={`Showing: ${effectiveSection}`} size="small" color="info" variant="outlined" />
                    )}
                </Box>
                <Typography color="text.secondary" sx={{ mb: 2 }}>
                    Fully interactive preview. Field visibility, labels, and colors update in real-time.
                </Typography>

                <Box
                    sx={{
                        border: '2px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        overflow: 'hidden',
                        bgcolor: localDraft?.background_color || '#ffffff',
                        maxHeight: '80vh',
                        overflowY: 'auto',
                    }}
                >
                    <ProfileSetting
                        configOverride={configOverride}
                        previewMode={true}
                        initialSection={effectiveSection}
                    />
                </Box>
            </CardContent>
        </Card>
    );
};

export default PatientProfilePreviewTab;
