/**
 * Landing Preview tab — iframe renders the real public LandingPage with
 * ``?mode=draft|preview`` so the admin sees exactly what the public will get.
 *
 * The public endpoints gate draft/preview behind ``@jwt_required(optional=True)``;
 * the iframe is same-origin so the admin's auth cookie flows and the backend
 * resolves the correct tenant context.
 *
 * Mode choice: if a PREVIEW row exists we show it (that's what "Promoted to
 * Preview" means); otherwise fall back to DRAFT so the admin can still see
 * their in-flight edits.
 */
import { useState } from 'react';
import { Box, Paper, Typography, ToggleButton, ToggleButtonGroup, Tooltip, Alert } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import { LanguageSelector, useLanguage } from '../../../../../../../common/i18n';

const PreviewTab = ({
    draft, preview, live, hasChanges, mode: editorMode = 'tenant', scope = 'marketing',
}) => {
    const isPlatform = editorMode === 'platform';
    const { lang, setLang } = useLanguage();
    // Lifecycle toggle is shared by both modes now that platform also has
    // a real DRAFT → PREVIEW → LIVE flow.
    const initialLifecycle = draft ? 'draft' : (preview ? 'preview' : 'live');
    const [lifecycle, setLifecycle] = useState(initialLifecycle);
    // Nonce lets us hard-reload the iframe after the admin saves so edits
    // show up without leaving the tab.
    const [nonce, setNonce] = useState(0);

    const availableLangs = (preview || draft || live)?.published_languages || ['en'];
    // Tenant: hit the public landing with ?mode=draft|preview|live so the
    // backend serves the right lifecycle row.
    // Platform: hit the public landing with ?_platform_scope=<scope> AND
    // ?_platform_mode=<lifecycle> so PublicLandingLayout pulls the right
    // row from the platform-landing summary endpoint. Matches the tenant
    // toggle so the editor's three "Draft / Preview / Live" buttons mean
    // the same thing in both editors.
    const iframeSrc = isPlatform
        ? `/?_platform_scope=${encodeURIComponent(scope)}&_platform_mode=${encodeURIComponent(lifecycle)}&lang=${encodeURIComponent(lang)}&_=${nonce}`
        : `/?mode=${encodeURIComponent(lifecycle)}&lang=${encodeURIComponent(lang)}&_=${nonce}`;

    return (
        <Paper sx={{ overflow: 'hidden', width: '100%' }}>
            {/* Tell the admin why their just-clicked changes might not show
                yet — the iframe pulls from the persisted draft, not from the
                local heroPatch buffer. Without this hint, "I picked Sunset
                but preview is still blue" is genuinely confusing. */}
            {hasChanges && lifecycle === 'draft' && (
                <Alert severity="info" sx={{ borderRadius: 0 }}>
                    You have unsaved changes. Click <strong>Save Draft</strong> in
                    the header, then hit Reload below to see them in this preview.
                </Alert>
            )}
            {lifecycle === 'draft' && draft && (draft.modules?.length || 0) === 0 && (
                <Alert severity="warning" sx={{ borderRadius: 0 }}>
                    The current draft has no modules. The navbar and services grid will look
                    empty here. Switch to <strong>Live</strong> mode below to preview the
                    last published version, or add modules in the Editor tab.
                </Alert>
            )}
            <Box
                sx={{
                    p: 1.5, display: 'flex', alignItems: 'center', gap: 1,
                    flexWrap: 'wrap',
                    justifyContent: 'space-between', bgcolor: 'grey.50',
                    borderBottom: '1px solid', borderColor: 'divider',
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                        {isPlatform
                            ? `Previewing the platform landing (${scope === 'default_template' ? 'new-tenant template' : 'apex marketing'}) with`
                            : 'Previewing the real public landing page with'}
                    </Typography>
                    <ToggleButtonGroup
                        size="small" exclusive
                        value={lifecycle}
                        onChange={(_, v) => v && setLifecycle(v)}
                    >
                        <ToggleButton value="draft" disabled={!draft}>Draft</ToggleButton>
                        <ToggleButton value="preview" disabled={!preview}>Preview</ToggleButton>
                        <ToggleButton value="live" disabled={!live}>Live</ToggleButton>
                    </ToggleButtonGroup>
                    <Typography variant="caption" color="text.secondary">data.</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <LanguageSelector
                        value={lang} onChange={setLang} availableLanguages={availableLangs}
                    />
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
                    key={`${isPlatform ? `platform-${scope}` : lifecycle}-${lang}-${nonce}`}
                    title="Landing preview"
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
