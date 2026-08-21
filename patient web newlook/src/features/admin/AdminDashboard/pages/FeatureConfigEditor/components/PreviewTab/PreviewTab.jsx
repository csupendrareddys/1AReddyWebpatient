/**
 * Feature Preview tab — iframes the real public ServiceDetailPage at
 * ``/service/:slug?mode=draft`` so admins see the published layout exactly
 * (including which sections are hidden by ``sections_enabled_json``).
 */
import { useState } from 'react';
import { Box, Paper, Typography, ToggleButton, Tooltip, Alert } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import { LanguageSelector, useLanguage } from '../../../../../../../common/i18n';

const PreviewTab = ({ feature }) => {
    const { lang, setLang } = useLanguage();
    const [nonce, setNonce] = useState(0);

    if (!feature?.slug) return <Alert severity="info">Nothing to preview.</Alert>;

    const iframeSrc = `/service/${encodeURIComponent(feature.slug)}?mode=draft&lang=${encodeURIComponent(lang)}&_=${nonce}`;

    return (
        <Paper sx={{ overflow: 'hidden' }}>
            <Box
                sx={{
                    p: 1.5, display: 'flex', alignItems: 'center', gap: 1,
                    justifyContent: 'space-between', bgcolor: 'grey.50',
                    borderBottom: '1px solid', borderColor: 'divider',
                }}
            >
                <Typography variant="caption" color="text.secondary">
                    Previewing the real feature page with DRAFT data. Hidden sections are omitted.
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LanguageSelector value={lang} onChange={setLang} />
                    <Tooltip title="Reload preview">
                        <ToggleButton
                            value="refresh" size="small"
                            onClick={() => setNonce((n) => n + 1)}
                            sx={{ border: 0 }}
                        >
                            <RefreshIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                    <Tooltip title="Open in new tab">
                        <ToggleButton
                            value="open" size="small"
                            onClick={() => window.open(iframeSrc, '_blank', 'noopener')}
                            sx={{ border: 0 }}
                        >
                            <OpenInNewIcon fontSize="small" />
                        </ToggleButton>
                    </Tooltip>
                </Box>
            </Box>

            <Box sx={{ bgcolor: 'grey.100' }}>
                <iframe
                    key={`${feature.slug}-${lang}-${nonce}`}
                    title="Feature preview"
                    src={iframeSrc}
                    style={{
                        width: '100%', height: '80vh', border: 0, display: 'block',
                        background: '#fff',
                    }}
                />
            </Box>
        </Paper>
    );
};

export default PreviewTab;
