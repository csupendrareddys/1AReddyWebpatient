/**
 * TranslationsEditor — shared multi-language translations editor.
 *
 * Lifted from the Patient/Doctor profile editors (which had duplicate copies)
 * and reshaped to consume the centralized :mod:`SUPPORTED_LANGUAGES` list.
 *
 * Props
 *  - translations: current translations dict (shape: ``{field: {lang: value}}``)
 *  - translatableKeys: list of top-level field names that are editable
 *  - defaults: base (English) values, read-only when the English tab is active
 *  - onChange: fn(newTranslations) — called with the whole translations dict
 *  - publishedLanguages: string[] of codes that are 'live' for this config;
 *    others render as unpublished/draft but are still editable
 */
import { useRef, useState } from 'react';
import {
    Box, Typography, TextField, Tabs, Tab, IconButton, Collapse,
    Button, Dialog, DialogTitle, DialogContent, DialogActions,
    MenuItem, Select, FormControl, InputLabel, Tooltip, Chip,
} from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
    SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE, getLanguageLabel,
} from './languages';

const TranslationsEditor = ({
    translations, translatableKeys, defaults,
    onChange, publishedLanguages,
}) => {
    const [expanded, setExpanded] = useState(false);
    const [langTab, setLangTab] = useState(0);
    const [addOpen, setAddOpen] = useState(false);
    const [addLangCode, setAddLangCode] = useState('');

    // LOCAL working copy of the translations dict. Parents (the landing /
    // page-config editors) commit edits silently into a draft ref without
    // re-rendering their tree, so a controlled read-back of the
    // ``translations`` prop would never repaint while typing. Each
    // keystroke re-renders only this component; ``onChange`` still emits
    // the whole updated dict upward on every edit (contract unchanged).
    const [working, setWorking] = useState(translations || {});
    const lastPropRef = useRef(translations);
    if (translations !== lastPropRef.current) {
        lastPropRef.current = translations;
        // Adopt genuinely-new outside content (server refetch, restore) but
        // ignore our own edits echoed back through the parent's draft.
        if (JSON.stringify(translations || {}) !== JSON.stringify(working)) {
            setWorking(translations || {});
        }
    }
    const emit = (updated) => {
        setWorking(updated);
        onChange(updated);
    };

    // Build language list: English is always present; every other language
    // that has at least one non-default key shows up as a tab. Admins add more
    // from the supported-languages picklist via the + button.
    const buildLangs = () => {
        const codes = new Set([DEFAULT_LANGUAGE]);
        if (working) {
            Object.values(working).forEach((langMap) => {
                if (langMap && typeof langMap === 'object') {
                    Object.keys(langMap).forEach((c) => codes.add(c));
                }
            });
        }
        (publishedLanguages || []).forEach((c) => codes.add(c));
        // Preserve SUPPORTED_LANGUAGES ordering, then any unrecognized codes alphabetically.
        const ordered = SUPPORTED_LANGUAGES
            .filter((l) => codes.has(l.code))
            .map((l) => ({ code: l.code, label: l.label, removable: l.code !== DEFAULT_LANGUAGE }));
        const extras = [...codes]
            .filter((c) => !SUPPORTED_LANGUAGES.some((l) => l.code === c))
            .sort()
            .map((c) => ({ code: c, label: c.toUpperCase(), removable: true }));
        return [...ordered, ...extras];
    };

    const languages = buildLangs();
    const currentLang = languages[langTab]?.code || DEFAULT_LANGUAGE;

    const handleChange = (key, value) => {
        const updated = { ...working };
        if (!updated[key]) updated[key] = {};
        updated[key] = { ...updated[key], [currentLang]: value };
        emit(updated);
    };

    const getValue = (key) => {
        if (currentLang === DEFAULT_LANGUAGE) return defaults?.[key] || '';
        return working?.[key]?.[currentLang] || '';
    };

    const handleAddLanguage = () => {
        const code = addLangCode.trim().toLowerCase();
        if (!code) return;
        const updated = { ...working };
        translatableKeys.forEach((key) => {
            const existing = updated[key] || {};
            if (existing[code] === undefined) {
                updated[key] = { ...existing, [code]: '' };
            }
        });
        emit(updated);
        setAddOpen(false);
        setAddLangCode('');
        const next = buildLangs();
        // Rebuild the list with the new code included so we can switch the tab.
        const withNew = next.some((l) => l.code === code)
            ? next
            : [...next, { code, label: code.toUpperCase(), removable: true }];
        const idx = withNew.findIndex((l) => l.code === code);
        if (idx >= 0) setLangTab(idx);
    };

    const handleRemoveLanguage = (code) => {
        if (code === DEFAULT_LANGUAGE) return;
        const updated = { ...working };
        translatableKeys.forEach((key) => {
            if (updated[key]) {
                const { [code]: _drop, ...rest } = updated[key];
                updated[key] = rest;
            }
        });
        emit(updated);
        if (languages[langTab]?.code === code) setLangTab(0);
    };

    // Options for the "add language" dialog: anything supported that isn't
    // already a tab.
    const addableLanguages = SUPPORTED_LANGUAGES.filter(
        (l) => !languages.some((tab) => tab.code === l.code),
    );

    return (
        <Box sx={{ mt: 1 }}>
            <Box
                sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 0.5 }}
                onClick={() => setExpanded(!expanded)}
            >
                <TranslateIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                    Translations ({languages.length} languages)
                </Typography>
                <IconButton size="small">
                    {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </IconButton>
            </Box>

            <Collapse in={expanded}>
                <Box sx={{ mt: 1, p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Tabs
                            value={langTab}
                            onChange={(_, v) => setLangTab(v)}
                            variant="scrollable"
                            scrollButtons="auto"
                            sx={{ minHeight: 32, mb: 1, flex: 1 }}
                        >
                            {languages.map((lang) => {
                                const isPublished = publishedLanguages?.includes(lang.code);
                                return (
                                    <Tab
                                        key={lang.code}
                                        label={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <span>{lang.label}</span>
                                                {isPublished && (
                                                    <Chip
                                                        label="LIVE"
                                                        size="small"
                                                        color="success"
                                                        sx={{ height: 16, fontSize: '0.6rem' }}
                                                    />
                                                )}
                                                {lang.removable && (
                                                    <IconButton
                                                        size="small"
                                                        sx={{ p: 0, ml: 0.5 }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleRemoveLanguage(lang.code);
                                                        }}
                                                    >
                                                        <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
                                                    </IconButton>
                                                )}
                                            </Box>
                                        }
                                        sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.75rem' }}
                                    />
                                );
                            })}
                        </Tabs>
                        <Tooltip title="Add Language">
                            <span>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    onClick={() => setAddOpen(true)}
                                    disabled={addableLanguages.length === 0}
                                    sx={{ mb: 1 }}
                                >
                                    <AddIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>

                    {translatableKeys.map((key) => (
                        <TextField
                            key={key}
                            size="small"
                            fullWidth
                            label={key}
                            value={getValue(key)}
                            onChange={(e) => handleChange(key, e.target.value)}
                            disabled={currentLang === DEFAULT_LANGUAGE}
                            helperText={currentLang === DEFAULT_LANGUAGE ? 'Edit in main field above' : ''}
                            sx={{ mb: 1 }}
                        />
                    ))}
                </Box>
            </Collapse>

            <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>Add Language</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Pick a language to add translations for. Only supported languages appear here.
                        New languages are added to the canonical list in code.
                    </Typography>
                    <FormControl size="small" fullWidth sx={{ mt: 1 }}>
                        <InputLabel>Language</InputLabel>
                        <Select
                            value={addLangCode}
                            label="Language"
                            onChange={(e) => setAddLangCode(e.target.value)}
                        >
                            {addableLanguages.map((l) => (
                                <MenuItem key={l.code} value={l.code}>
                                    {l.label} ({l.native})
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleAddLanguage} disabled={!addLangCode}>
                        Add
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default TranslationsEditor;
