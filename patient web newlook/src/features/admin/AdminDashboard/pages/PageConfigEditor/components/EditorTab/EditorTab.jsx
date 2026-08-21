import { useState } from 'react';
import {
    Box, Typography, TextField, Button, Switch, Alert, Card, CardContent, Chip,
    Dialog, DialogTitle, DialogContent, DialogActions, IconButton, CircularProgress,
    Checkbox, FormControlLabel, FormGroup, Divider,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import VisibilityIcon from '@mui/icons-material/Visibility';
import RefreshIcon from '@mui/icons-material/Refresh';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import mammoth from 'mammoth';
import axiosInstance from '../../../../../../../api/axiosConfig';
import { TranslationsEditor, SUPPORTED_LANGUAGES } from '../../../../../../../common/i18n';

const LANGUAGES = SUPPORTED_LANGUAGES.map((l) => ({ code: l.code, label: l.label }));

// Text fields that can be translated
const TRANSLATABLE_FIELDS = [
    { key: 'page_title', label: 'Page Title' },
    { key: 'page_subtitle', label: 'Page Subtitle' },
    { key: 'primary_button_text', label: 'Primary Button Text' },
    { key: 'identifier_label', label: 'Identifier Label' },
    { key: 'username_placeholder', label: 'Username Placeholder' },
    { key: 'password_placeholder', label: 'Password Placeholder' },
    { key: 'otp_section_text', label: 'OTP Section Text' },
    { key: 'otp_button_text', label: 'OTP Button Text' },
    { key: 'forgot_password_text', label: 'Forgot Password Text' },
    { key: 'register_text', label: 'Register Text' },
    { key: 'register_link_text', label: 'Register Link Text' },
    { key: 'remember_me_text', label: 'Remember Me Text' },
    { key: 'terms_checkbox_text', label: 'Terms Checkbox Text' },
    { key: 'terms_link_text', label: 'Terms Link Text' },
    { key: 'privacy_link_text', label: 'Privacy Link Text' },
    { key: 'footer_text', label: 'Footer Text' },
    { key: 'logo_alt_text', label: 'Logo Alt Text' },
];

const getEmbedUrl = (url) => {
    if (!url) return null;
    const lower = url.split('?')[0].toLowerCase();
    if (lower.endsWith('.doc') || lower.endsWith('.docx')) {
        return `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
    }
    return url + (url.includes('#') ? '&toolbar=0' : '#toolbar=0');
};

const quillModules = {
    toolbar: [
        [{ header: [1, 2, 3, 4, 5, 6, false] }],
        [{ size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [] }, { background: [] }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ indent: '-1' }, { indent: '+1' }],
        [{ align: [] }],
        ['link'],
        ['clean'],
    ],
};

// Mammoth style map to preserve Word formatting → HTML elements
const mammothOptions = {
    styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Heading 4'] => h4:fresh",
        "p[style-name='Heading 5'] => h5:fresh",
        "p[style-name='Heading 6'] => h6:fresh",
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "r[style-name='Strong'] => strong",
        "r[style-name='Emphasis'] => em",
    ],
};

const EditorTab = ({ draft, handleDraftChange, handleAssetUpload, selectedPageType }) => {
    // Document preview modal state
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewTitle, setPreviewTitle] = useState('');
    const [previewUrl, setPreviewUrl] = useState('');

    // Document editor modal state
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorTitle, setEditorTitle] = useState('');
    const [editorContent, setEditorContent] = useState('');
    const [editorLoading, setEditorLoading] = useState(false);
    const [editorSaving, setEditorSaving] = useState(false);
    const [editorDocType, setEditorDocType] = useState(''); // 'terms_document' or 'privacy_document'

    const handlePreviewDoc = (title, url) => {
        setPreviewTitle(title);
        setPreviewUrl(getEmbedUrl(url));
        setPreviewOpen(true);
    };

    const handleEditDoc = async (title, assetId, docType) => {
        setEditorTitle(title);
        setEditorDocType(docType);
        setEditorLoading(true);
        setEditorOpen(true);
        setEditorContent('');

        try {
            // Fetch through backend proxy to avoid CORS issues with S3
            const response = await axiosInstance.get(
                `/api/page-config/admin/assets/${assetId}/download`,
                { responseType: 'arraybuffer' }
            );
            const result = await mammoth.convertToHtml(
                { arrayBuffer: response.data },
                mammothOptions
            );
            setEditorContent(result.value);
        } catch (err) {
            console.error('Failed to load document for editing:', err);
            setEditorContent('<p>Failed to load document. You can start typing fresh content.</p>');
        } finally {
            setEditorLoading(false);
        }
    };

    const handleSaveDoc = async () => {
        setEditorSaving(true);
        try {
            // Send HTML to backend — Python converts to real .docx, uploads to S3
            const response = await axiosInstance.post('/api/page-config/admin/assets/save-html-as-docx', {
                html_content: editorContent,
                asset_type: editorDocType,
                name: editorTitle,
            });

            // Update draft with the new asset ID and URL
            const asset = response.data?.data;
            if (asset) {
                const idField = editorDocType === 'terms_document' ? 'terms_asset_id' : 'privacy_asset_id';
                const urlField = editorDocType === 'terms_document' ? 'terms_url' : 'privacy_url';
                handleDraftChange(idField, asset.id);
                if (asset.url) {
                    handleDraftChange(urlField, asset.url);
                }
            }
            setEditorOpen(false);
        } catch (err) {
            console.error('Failed to save document:', err);
        } finally {
            setEditorSaving(false);
        }
    };

    if (!draft) return null;

    // Helper to get configuration fields based on page type
    const getPageTypeFields = () => {
        const commonBranding = [
            { key: 'primary_color', label: 'Primary Color', type: 'color', default: '#1976d2', visibilityKey: null, requiredKey: null },
            { key: 'secondary_color', label: 'Secondary Color', type: 'color', default: '#dc004e', visibilityKey: null, requiredKey: null },
            { key: 'background_color', label: 'Background Color', type: 'color', default: '#ffffff', visibilityKey: null, requiredKey: null },
            { key: 'card_background_color', label: 'Card Background Color', type: 'color', default: '#ffffff', visibilityKey: null, requiredKey: null },
            { key: 'logo_alt_text', label: 'Logo Alt Text', type: 'text', default: '', visibilityKey: 'logo_is_present', requiredKey: null },
            { key: 'logo_upload', label: 'Logo Image', type: 'logo', default: '', visibilityKey: 'logo_is_present', requiredKey: null },
            { key: 'page_title', label: 'Page Title', type: 'text', default: '', visibilityKey: null, requiredKey: null },
            { key: 'page_subtitle', label: 'Page Subtitle', type: 'text', default: '', visibilityKey: null, requiredKey: null },
            { key: 'primary_button_text', label: 'Primary Button Text', type: 'text', default: '', visibilityKey: null, requiredKey: null },
        ];

        const commonFooter = [
            { key: 'footer_text', label: 'Footer Text', type: 'textarea', default: '', visibilityKey: 'footer_is_present', requiredKey: null },
        ];

        // Document upload fields shared by login and signup pages
        const documentFields = [
            { key: 'terms_doc_upload', label: 'Terms & Conditions Document', type: 'terms_document', default: '', visibilityKey: 'terms_is_present', requiredKey: null },
            { key: 'privacy_doc_upload', label: 'Privacy Policy Document', type: 'privacy_document', default: '', visibilityKey: 'privacy_is_present', requiredKey: null },
        ];

        if (selectedPageType.includes('login')) {
            return [
                ...commonBranding,
                { key: 'identifier_label', label: 'Identifier Label', type: 'text', default: 'Email / Phone / Aadhaar', visibilityKey: null, requiredKey: null },
                { key: 'username_placeholder', label: 'Username Placeholder', type: 'text', default: '', visibilityKey: null, requiredKey: null },
                { key: 'password_placeholder', label: 'Password Placeholder', type: 'text', default: '', visibilityKey: null, requiredKey: null },
                { key: 'forgot_password_text', label: 'Forgot Password Text', type: 'text', default: '', visibilityKey: 'forgot_password_is_present', requiredKey: null },
                { key: 'remember_me_text', label: 'Remember Me Text', type: 'text', default: '', visibilityKey: 'remember_me_is_present', requiredKey: null },
                { key: 'register_text', label: 'Register Text', type: 'text', default: '', visibilityKey: 'register_is_present', requiredKey: null },
                { key: 'register_link_text', label: 'Register Link Text', type: 'text', default: '', visibilityKey: 'register_is_present', requiredKey: null },
                { key: 'otp_section_text', label: 'OTP Section Text', type: 'text', default: '', visibilityKey: 'otp_is_present', requiredKey: null },
                { key: 'otp_button_text', label: 'OTP Button Text', type: 'text', default: '', visibilityKey: 'otp_is_present', requiredKey: null },
                // Issue 2 — Terms & Conditions controls for login pages
                { key: 'terms_checkbox_text', label: 'Terms Checkbox Text', type: 'text', default: '', visibilityKey: 'terms_is_present', requiredKey: 'terms_required' },
                { key: 'terms_link_text', label: 'Terms Link Text', type: 'text', default: '', visibilityKey: 'terms_is_present', requiredKey: null },
                { key: 'privacy_link_text', label: 'Privacy Link Text', type: 'text', default: '', visibilityKey: 'privacy_is_present', requiredKey: null },
                // Issue 3 — Document uploads for login pages
                ...documentFields,
                ...commonFooter,
            ];
        }

        if (selectedPageType === 'patient_signup') {
            return [
                ...commonBranding,
                { key: 'terms_checkbox_text', label: 'Terms Checkbox Text', type: 'text', default: '', visibilityKey: 'terms_is_present', requiredKey: 'terms_required' },
                { key: 'terms_link_text', label: 'Terms Link Text', type: 'text', default: '', visibilityKey: 'terms_is_present', requiredKey: null },
                { key: 'privacy_link_text', label: 'Privacy Link Text', type: 'text', default: '', visibilityKey: 'privacy_is_present', requiredKey: null },
                { key: 'login_link_text', label: 'Already have account? Text', type: 'text', default: '', visibilityKey: null, requiredKey: null },
                // Issue 3 — Document uploads for signup pages
                ...documentFields,
                ...commonFooter,
            ];
        }

        // doctor_signup, pharmacy_signup, diagnosis_signup — add document uploads
        if (selectedPageType.includes('signup')) {
            return [
                ...commonBranding,
                { key: 'terms_checkbox_text', label: 'Terms Checkbox Text', type: 'text', default: '', visibilityKey: 'terms_is_present', requiredKey: 'terms_required' },
                { key: 'terms_link_text', label: 'Terms Link Text', type: 'text', default: '', visibilityKey: 'terms_is_present', requiredKey: null },
                { key: 'privacy_link_text', label: 'Privacy Link Text', type: 'text', default: '', visibilityKey: 'privacy_is_present', requiredKey: null },
                ...documentFields,
                ...commonFooter,
            ];
        }

        // Add other cases as needed or fallback to common
        return commonBranding;
    };

    // Returns the stored URL for a document asset type ('terms_document' or 'privacy_document')
    const getDocumentUrl = (assetType) => {
        if (assetType === 'terms_document') return draft.terms_url || null;
        if (assetType === 'privacy_document') return draft.privacy_url || null;
        return null;
    };

    return (
        <Card>
            <CardContent>
                <Typography variant="h6" gutterBottom>Page Configuration</Typography>
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                    Configure all fields for this page to match your requirements.
                </Typography>

                {/* Horizontal scroll on small screens — fixed columns sum
                    past a phone viewport, so keep header + rows on one
                    min-width track and let it scroll rather than overflow. */}
                <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 780 }}>
                {/* Header Row */}
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: '50px 200px 1fr 150px 150px',
                    gap: 1,
                    alignItems: 'center',
                    bgcolor: 'primary.main',
                    color: 'white',
                    p: 1.5,
                    borderRadius: '4px 4px 0 0',
                }}>
                    <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">S.No</Typography>
                    <Typography fontWeight="bold" fontSize="0.85rem">Field Name</Typography>
                    <Typography fontWeight="bold" fontSize="0.85rem">Value</Typography>
                    <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Display</Typography>
                    <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Mandatory</Typography>
                </Box>

                {getPageTypeFields().map((field, index) => (
                    <Box
                        key={field.key}
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: '50px 200px 1fr 150px 150px',
                            gap: 1,
                            alignItems: 'center',
                            p: 1,
                            borderBottom: '1px solid',
                            borderLeft: '1px solid',
                            borderRight: '1px solid',
                            borderColor: 'divider',
                            bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                            '&:hover': { bgcolor: '#e3f2fd' }
                        }}
                    >
                        <Typography textAlign="center" fontWeight="500">{String(index + 1).padStart(2, '0')}</Typography>

                        <Typography fontWeight="500">{field.label}</Typography>

                        {/* Value Column */}
                        <Box>
                            {field.type === 'color' && (
                                <TextField
                                    type="color"
                                    size="small"
                                    value={draft[field.key] || field.default}
                                    onChange={(e) => handleDraftChange(field.key, e.target.value)}
                                    sx={{ width: 100 }}
                                />
                            )}
                            {field.type === 'text' && (
                                <Box>
                                    <TextField
                                        size="small"
                                        fullWidth
                                        defaultValue={draft[field.key] || ''}
                                        onBlur={(e) => handleDraftChange(field.key, e.target.value)}
                                    />
                                    {TRANSLATABLE_FIELDS.some(t => t.key === field.key) && (
                                        <TranslationsEditor
                                            translations={draft.translations || {}}
                                            translatableKeys={[field.key]}
                                            defaults={{ [field.key]: draft[field.key] || '' }}
                                            onChange={(updated) => handleDraftChange('translations', { ...(draft.translations || {}), ...updated })}
                                        />
                                    )}
                                </Box>
                            )}
                            {field.type === 'textarea' && (
                                <Box>
                                    <TextField
                                        size="small"
                                        fullWidth
                                        multiline
                                        rows={2}
                                        defaultValue={draft[field.key] || ''}
                                        onBlur={(e) => handleDraftChange(field.key, e.target.value)}
                                    />
                                    {TRANSLATABLE_FIELDS.some(t => t.key === field.key) && (
                                        <TranslationsEditor
                                            translations={draft.translations || {}}
                                            translatableKeys={[field.key]}
                                            defaults={{ [field.key]: draft[field.key] || '' }}
                                            onChange={(updated) => handleDraftChange('translations', { ...(draft.translations || {}), ...updated })}
                                        />
                                    )}
                                </Box>
                            )}
                            {field.type === 'logo' && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Button
                                        variant="outlined"
                                        component="label"
                                        size="small"
                                        startIcon={<CloudUploadIcon />}
                                    >
                                        Upload
                                        <input
                                            type="file"
                                            hidden
                                            accept="image/*"
                                            onChange={(e) => handleAssetUpload(e, 'logo')}
                                        />
                                    </Button>
                                    {draft.logo_url && (
                                        <Box sx={{ p: 0.5, border: '1px dashed grey', borderRadius: 1 }}>
                                            <img src={draft.logo_url} alt="Logo" style={{ maxHeight: 40 }} />
                                        </Box>
                                    )}
                                </Box>
                            )}
                            {/* Document upload (terms_document / privacy_document) */}
                            {(field.type === 'terms_document' || field.type === 'privacy_document') && (() => {
                                const docUrl = getDocumentUrl(field.type);
                                return (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                                        {docUrl ? (() => {
                                            const isWordDoc = docUrl.split('?')[0].toLowerCase().match(/\.(doc|docx)$/);
                                            return (
                                            <>
                                                <Chip
                                                    icon={<InsertDriveFileIcon />}
                                                    label="Uploaded"
                                                    color="success"
                                                    size="small"
                                                    variant="outlined"
                                                />
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    startIcon={<VisibilityIcon />}
                                                    onClick={() => handlePreviewDoc(field.label, docUrl)}
                                                >
                                                    Preview
                                                </Button>
                                                {isWordDoc && (() => {
                                                    const assetId = field.type === 'terms_document' ? draft.terms_asset_id : draft.privacy_asset_id;
                                                    return assetId ? (
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            color="info"
                                                            startIcon={<EditIcon />}
                                                            onClick={() => handleEditDoc(field.label, assetId, field.type)}
                                                        >
                                                            Edit
                                                        </Button>
                                                    ) : null;
                                                })()}
                                                <Button
                                                    variant="outlined"
                                                    component="label"
                                                    size="small"
                                                    color="warning"
                                                    startIcon={<RefreshIcon />}
                                                >
                                                    Re-upload
                                                    <input
                                                        type="file"
                                                        hidden
                                                        accept=".pdf,.doc,.docx,application/pdf,application/msword"
                                                        onChange={(e) => handleAssetUpload(e, field.type)}
                                                    />
                                                </Button>
                                            </>
                                            );
                                        })() : (
                                            <>
                                                <Button
                                                    variant="outlined"
                                                    component="label"
                                                    size="small"
                                                    startIcon={<CloudUploadIcon />}
                                                >
                                                    Upload PDF
                                                    <input
                                                        type="file"
                                                        hidden
                                                        accept=".pdf,.doc,.docx,application/pdf,application/msword"
                                                        onChange={(e) => handleAssetUpload(e, field.type)}
                                                    />
                                                </Button>
                                                <Typography variant="caption" color="text.disabled">No document uploaded</Typography>
                                            </>
                                        )}
                                    </Box>
                                );
                            })()}
                        </Box>

                        {/* Display Toggle */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            {field.visibilityKey ? (
                                <>
                                    <Typography variant="caption" color={!draft[field.visibilityKey] ? 'error.main' : 'text.disabled'}>Hide</Typography>
                                    <Switch
                                        size="small"
                                        checked={draft[field.visibilityKey] ?? true}
                                        onChange={(e) => handleDraftChange(field.visibilityKey, e.target.checked)}
                                        color="success"
                                    />
                                    <Typography variant="caption" color={draft[field.visibilityKey] ? 'success.main' : 'text.disabled'}>Show</Typography>
                                </>
                            ) : (
                                <Typography variant="caption" color="text.disabled">Always Visible</Typography>
                            )}
                        </Box>

                        {/* Mandatory Toggle */}
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                            {field.requiredKey ? (
                                <>
                                    <Typography variant="caption" color={!draft[field.requiredKey] ? 'text.primary' : 'text.disabled'}>Optional</Typography>
                                    <Switch
                                        size="small"
                                        checked={draft[field.requiredKey] ?? false}
                                        onChange={(e) => handleDraftChange(field.requiredKey, e.target.checked)}
                                        color="success"
                                    />
                                    <Typography variant="caption" color={draft[field.requiredKey] ? 'success.main' : 'text.disabled'}>Required</Typography>
                                </>
                            ) : (
                                <Typography variant="caption" color="text.disabled">N/A</Typography>
                            )}
                        </Box>
                    </Box>
                ))}
                </Box>
                </Box>
            </CardContent>

            {/* ============== PUBLISHED LANGUAGES SECTION ============== */}
            <CardContent>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="h6" gutterBottom>Published Languages</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Control which languages are available to users on the live page.
                    English is always published. Only publish a language once its translations are complete.
                </Typography>

                <FormGroup row>
                    {LANGUAGES.map((lang) => {
                        const published = draft.published_languages || ['en'];
                        const isEnglish = lang.code === 'en';
                        const isChecked = published.includes(lang.code);

                        // Count how many fields have translations for this language
                        const translations = draft.translations || {};
                        const translatedCount = isEnglish
                            ? TRANSLATABLE_FIELDS.length
                            : TRANSLATABLE_FIELDS.filter((f) => translations[f.key]?.[lang.code]).length;

                        return (
                            <FormControlLabel
                                key={lang.code}
                                control={
                                    <Checkbox
                                        checked={isChecked}
                                        disabled={isEnglish}
                                        onChange={(e) => {
                                            let updated;
                                            if (e.target.checked) {
                                                updated = [...published, lang.code];
                                            } else {
                                                updated = published.filter((l) => l !== lang.code);
                                            }
                                            handleDraftChange('published_languages', updated);
                                        }}
                                    />
                                }
                                label={
                                    <Box>
                                        <Typography variant="body2">{lang.label}</Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {translatedCount}/{TRANSLATABLE_FIELDS.length} fields translated
                                        </Typography>
                                    </Box>
                                }
                            />
                        );
                    })}
                </FormGroup>
            </CardContent>

            {/* Document Preview Modal */}
            <Dialog
                open={previewOpen}
                onClose={() => setPreviewOpen(false)}
                maxWidth="md"
                fullWidth
                PaperProps={{ sx: { height: '85vh' } }}
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5 }}>
                    <Typography variant="h6" component="span">{previewTitle}</Typography>
                    <IconButton onClick={() => setPreviewOpen(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0, overflow: 'hidden' }}>
                    {previewUrl && (
                        <iframe
                            src={previewUrl}
                            title={previewTitle}
                            style={{ width: '100%', height: '100%', border: 'none' }}
                        />
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 2, py: 1 }}>
                    <Button onClick={() => setPreviewOpen(false)} variant="contained" size="small">
                        Close
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Document Editor Modal */}
            <Dialog
                open={editorOpen}
                onClose={() => setEditorOpen(false)}
                maxWidth="lg"
                fullWidth
                PaperProps={{ sx: { height: '90vh' } }}
            >
                <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5 }}>
                    <Typography variant="h6" component="span">Edit: {editorTitle}</Typography>
                    <IconButton onClick={() => setEditorOpen(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {editorLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                            <CircularProgress />
                            <Typography sx={{ ml: 2 }}>Loading document...</Typography>
                        </Box>
                    ) : (
                        <ReactQuill
                            theme="snow"
                            value={editorContent}
                            onChange={setEditorContent}
                            modules={quillModules}
                            style={{ height: 'calc(100% - 42px)', overflow: 'auto' }}
                        />
                    )}
                </DialogContent>
                <DialogActions sx={{ px: 2, py: 1 }}>
                    <Button onClick={() => setEditorOpen(false)} variant="outlined" size="small">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSaveDoc}
                        variant="contained"
                        size="small"
                        startIcon={editorSaving ? <CircularProgress size={16} color="inherit" /> : <SaveIcon />}
                        disabled={editorSaving || editorLoading}
                    >
                        {editorSaving ? 'Saving...' : 'Save & Upload'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
};

export default EditorTab;