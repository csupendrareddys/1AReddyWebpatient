/**
 * Module Editor tab — table-style field list + FAQ + features sub-table.
 *
 * Module meta lives in the top Page Configuration table (mirrors the style
 * used by PageConfigEditor / LandingConfigEditor). FAQ editor and Features
 * CRUD sit underneath as separate cards.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Box, Card, CardContent, Typography, TextField, Switch, Button, Table,
    TableContainer, TableHead, TableRow, TableCell, TableBody, IconButton, Dialog, DialogTitle,
    DialogContent, DialogActions, Grid, Alert, Tooltip, Divider, List,
    ListItem, ListItemText, Autocomplete, Chip, Stack,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useLocation } from 'react-router-dom';
import {
    useListLandingFeaturesQuery,
    useCreateLandingFeatureMutation,
    useDeleteLandingFeatureMutation,
    useUpdateLandingFeatureMutation,
} from '../../../../../api/landingPageConfigEndpoints';
import {
    useListPlatformLandingFeaturesQuery,
    useCreatePlatformLandingFeatureMutation,
    useDeletePlatformLandingFeatureMutation,
    useUpdatePlatformLandingFeatureMutation,
} from '../../../../../api/platformLandingEndpoints';
import { TranslationsEditor } from '../../../../../../../common/i18n';
import LogoUploader from '../../../../components/LogoUploader/LogoUploader';
import { VideosEditor, ImagesEditor } from '../../../../../components/MediaListEditor/MediaListEditor';

// Top-level module fields. Slug is immutable post-create → readonly.
// ``is_visible`` is itself a visibility control, not a field with a hide/show
// toggle, so Display = "Always Visible".
const MODULE_FIELDS = [
    { key: 'name',          label: 'Name',           type: 'text',     translatable: true },
    { key: 'slug',          label: 'Slug',           type: 'text',     readonly: true, helperText: 'Slug is immutable after creation.' },
    { key: 'logo',          label: 'Logo',           type: 'logo' },
    { key: 'icon_key',      label: 'Icon Key',       type: 'text' },
    { key: 'description',   label: 'Description',    type: 'textarea', translatable: true },
    { key: 'display_order', label: 'Display Order',  type: 'number' },
    { key: 'is_visible',    label: 'Visible on Landing', type: 'switch' },
    { key: 'is_additional',  label: 'Additional Module to render in `more` tab', type:'switch' },
    { key: 'show_in_slider', label: 'Show in featured slider (third sliding bar)', type: 'switch' },
    { key: 'vid_json',      label: 'Video URLs',     type: 'media', itemsKey: 'videos' },
    { key: 'img_json',      label: 'Image URLs',     type: 'media', itemsKey: 'images' },
];

const GRID_COLS = '50px 220px 1fr 150px 130px';

// ---------------------------------------------------------------------------
// Categories — the middle level of the public nav (module → category →
// feature). A category is just a label an admin types on a feature; naming the
// same one on two features is what puts them in the same group. Order falls
// out of ``display_order``, so the list below reads in the order the nav will
// show it.
// ---------------------------------------------------------------------------

/** Distinct categories in nav order (first appearance wins), with counts. */
const categorySummary = (features) => {
    const seen = new Map();
    [...features]
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
        .forEach((f) => {
            const name = (f.category || '').trim();
            if (!name) return;
            seen.set(name, (seen.get(name) || 0) + 1);
        });
    return [...seen.entries()].map(([name, count]) => ({ name, count }));
};

/**
 * The Category cell — free text with the module's existing categories offered
 * as options, so the same group isn't spelled two ways and creating a new one
 * is still just typing it.
 *
 * Module scope, not defined inside ``EditorTab``: a component redefined per
 * render gets a fresh identity, and React would remount the input and drop
 * focus after every keystroke.
 */
const CategoryCell = ({ feature, options, disabled, onSave }) => {
    const current = feature.category || '';
    const [value, setValue] = useState(current);

    // Commit on blur / selection rather than per keystroke — each save is a
    // PUT, and firing one per character would hammer the API and race itself.
    const commit = (next) => {
        const clean = (next || '').trim();
        if (clean === current.trim()) return;
        onSave(feature, clean);
    };

    return (
        <Autocomplete
            freeSolo
            size="small"
            disabled={disabled}
            options={options}
            value={current}
            inputValue={value}
            onInputChange={(e, v) => setValue(v)}
            onChange={(e, v) => commit(v)}
            onBlur={() => commit(value)}
            sx={{ width: 175 }}
            renderInput={(params) => (
                <TextField
                    {...params}
                    variant="standard"
                    placeholder="Uncategorised"
                    onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                />
            )}
        />
    );
};

// ---------------------------------------------------------------------------

// Mirrors the backend validators in
// ``Backend/app/api/landing_page_config/validators.py``. Keep the two in sync
// so a form that looks valid here can't be rejected by the server for a rule
// the frontend didn't enforce.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{1,118}$/;
const SLUG_HELPER = 'Lowercase letters, digits, dashes and underscores. Must start with a letter or digit. 2–119 chars.';

const validateFeatureForm = (form) => {
    const errors = {};
    if (!form.slug.trim()) errors.slug = 'Slug is required.';
    else if (!SLUG_RE.test(form.slug.trim())) errors.slug = SLUG_HELPER;
    if (!form.title.trim()) errors.title = 'Title is required.';
    else if (form.title.trim().length > 200) errors.title = 'Title must be 200 characters or fewer.';
    if (form.starting_price && form.starting_price.length > 50) {
        errors.starting_price = 'Starting price must be 50 characters or fewer.';
    }
    if (form.timeline && form.timeline.length > 100) {
        errors.timeline = 'Timeline must be 100 characters or fewer.';
    }
    return errors;
};

// Mirror of the module dialog's parser — on 422 the RTK mutation surfaces
// ``error.data.errors`` (Marshmallow-shaped field → msgs). Reshape to
// ``{_global, fields: {field: string}}`` for inline display.
const parseBackendErrors = (rtkError) => {
    const out = { _global: '', fields: {} };
    if (!rtkError) return out;
    const envelope = rtkError.data || rtkError;
    const fields = envelope?.errors;
    if (fields && typeof fields === 'object') {
        Object.entries(fields).forEach(([k, v]) => {
            out.fields[k] = Array.isArray(v) ? v.join(' ') : String(v);
        });
    }
    if (envelope?.error && typeof envelope.error === 'string') {
        out._global = envelope.error;
    } else if (envelope?.message && typeof envelope.message === 'string') {
        out._global = envelope.message;
    }
    return out;
};

const FeatureCreateDialog = ({
    open, onClose, onCreate, isSaving, lastError, categoryOptions = [],
}) => {
    const [form, setForm] = useState({
        slug: '', title: '', category: '', starting_price: '', timeline: '',
    });
    const [touched, setTouched] = useState({});
    const setField = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
    const touch = (k) => () => setTouched((p) => ({ ...p, [k]: true }));

    const clientErrors = validateFeatureForm(form);
    const backendErrors = parseBackendErrors(lastError);
    const errorFor = (k) =>
        backendErrors.fields[k] || (touched[k] || lastError ? clientErrors[k] : null);
    const hasClientErrors = Object.keys(clientErrors).length > 0;

    const submit = () => {
        setTouched({ slug: true, title: true, starting_price: true, timeline: true });
        if (hasClientErrors) return;
        onCreate(form);
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Create feature</DialogTitle>
            <DialogContent dividers>
                {backendErrors._global && (
                    <Alert severity="error" sx={{ mb: 2 }}>{backendErrors._global}</Alert>
                )}
                <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Slug"
                            value={form.slug} onChange={setField('slug')}
                            onBlur={touch('slug')}
                            error={!!errorFor('slug')}
                            helperText={errorFor('slug') || SLUG_HELPER}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Title"
                            value={form.title} onChange={setField('title')}
                            onBlur={touch('title')}
                            error={!!errorFor('title')}
                            helperText={errorFor('title')}
                        />
                    </Grid>
                    {/* The nav group this feature lands in. Optional — an
                        uncategorised feature still shows, it just sits in the
                        module's flat list rather than under a heading. */}
                    <Grid item xs={12}>
                        <Autocomplete
                            freeSolo
                            size="small"
                            options={categoryOptions}
                            value={form.category}
                            onInputChange={(e, v) => setForm((p) => ({ ...p, category: v }))}
                            renderInput={(params) => (
                                <TextField
                                    {...params}
                                    label="Category (optional)"
                                    placeholder="e.g. Diagnostics"
                                    helperText="Groups this feature under a heading in the top-nav dropdown. Pick an existing one or type a new name."
                                />
                            )}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Starting price (optional)"
                            value={form.starting_price} onChange={setField('starting_price')}
                            onBlur={touch('starting_price')}
                            placeholder="Rs 299"
                            error={!!errorFor('starting_price')}
                            helperText={errorFor('starting_price')}
                        />
                    </Grid>
                    <Grid item xs={12} sm={6}>
                        <TextField
                            fullWidth size="small" label="Timeline (optional)"
                            value={form.timeline} onChange={setField('timeline')}
                            onBlur={touch('timeline')}
                            placeholder="7-10 working days"
                            error={!!errorFor('timeline')}
                            helperText={errorFor('timeline')}
                        />
                    </Grid>
                </Grid>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    variant="contained" onClick={submit}
                    disabled={isSaving || hasClientErrors}
                >
                    Create
                </Button>
            </DialogActions>
        </Dialog>
    );
};
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

const FaqEditor = ({ value = [], onChange, disabled }) => {
    const [q, setQ] = useState('');
    const [a, setA] = useState('');
    const addItem = () => {
        if (!q.trim() || !a.trim()) return;
        onChange([...(value || []), { question: q.trim(), answer: a.trim() }]);
        setQ(''); setA('');
    };
    const removeItem = (idx) => onChange(value.filter((_, i) => i !== idx));
    const move = (idx, dir) => {
        const target = idx + dir;
        if (target < 0 || target >= value.length) return;
        const next = [...value];
        const [item] = next.splice(idx, 1);
        next.splice(target, 0, item);
        onChange(next);
    };
    return (
        <Box>
            <Grid container spacing={1} sx={{ mb: 1 }}>
                <Grid item xs={12} sm={4}>
                    <TextField
                        fullWidth size="small" label="Question"
                        value={q} onChange={(e) => setQ(e.target.value)} disabled={disabled}
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                        fullWidth size="small" label="Answer"
                        value={a} onChange={(e) => setA(e.target.value)} disabled={disabled}
                    />
                </Grid>
                <Grid item xs={12} sm={2}>
                    <Button
                        fullWidth variant="outlined" startIcon={<AddIcon />}
                        onClick={addItem} disabled={disabled || !q.trim() || !a.trim()}
                    >
                        Add
                    </Button>
                </Grid>
            </Grid>
            <List dense>
                {(value || []).map((item, i) => (
                    <ListItem
                        key={i}
                        secondaryAction={
                            <Box>
                                <IconButton size="small" disabled={disabled || i === 0}
                                            onClick={() => move(i, -1)}>
                                    <ArrowUpwardIcon fontSize="inherit" />
                                </IconButton>
                                <IconButton size="small" disabled={disabled || i === value.length - 1}
                                            onClick={() => move(i, 1)}>
                                    <ArrowDownwardIcon fontSize="inherit" />
                                </IconButton>
                                <IconButton size="small" color="error" disabled={disabled}
                                            onClick={() => removeItem(i)}>
                                    <DeleteIcon fontSize="inherit" />
                                </IconButton>
                            </Box>
                        }
                    >
                        <ListItemText primary={item.question} secondary={item.answer} />
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

// ---------------------------------------------------------------------------

const EditorTab = ({ module, canEdit, patchModule }) => {
    const navigate = useNavigate();
    const location = useLocation();
    // Mode mirrored from useModuleConfigEditor's convention — derive
    // straight from the URL so the EditorTab doesn't need a new prop.
    const isPlatform = location.pathname.startsWith('/dashboard/platform/');
    const [createOpen, setCreateOpen] = useState(false);
    // Tenant features come from /api/landing/admin/modules/<id>/features
    // — features there are address-by-slug. Platform features live in a
    // schema-separate table; their delete uses the row id rather than
    // the slug, so we have to translate on delete.
    const tenantFeaturesQ = useListLandingFeaturesQuery(module?.id, {
        skip: !module?.id || isPlatform,
    });
    const platformFeaturesQ = useListPlatformLandingFeaturesQuery(module?.id, {
        skip: !module?.id || !isPlatform,
    });
    const features = (isPlatform ? platformFeaturesQ.data : tenantFeaturesQ.data) || [];
    const [createTenantFeature, createTenantState] = useCreateLandingFeatureMutation();
    const [createPlatformFeature, createPlatformState] = useCreatePlatformLandingFeatureMutation();
    const [deleteTenantFeature] = useDeleteLandingFeatureMutation();
    const [deletePlatformFeature] = useDeletePlatformLandingFeatureMutation();
    const [updateTenantFeature] = useUpdateLandingFeatureMutation();
    const [updatePlatformFeature] = useUpdatePlatformLandingFeatureMutation();

    // Featured-slider toggle for a feature/service (the third sliding bar on
    // the public landing). Tenant + platform take different keys.
    const handleToggleFeatureSlider = (f) => {
        const data = { show_in_slider: !f.show_in_slider };
        if (isPlatform) {
            updatePlatformFeature({ featureId: f.id, data });
        } else {
            updateTenantFeature({ moduleId: module.id, slug: f.slug, data });
        }
    };

    // Per-feature show/hide on the public landing (independent of the slider).
    const handleToggleFeatureVisible = (f) => {
        const data = { is_visible: !f.is_visible };
        if (isPlatform) {
            updatePlatformFeature({ featureId: f.id, data });
        } else {
            updateTenantFeature({ moduleId: module.id, slug: f.slug, data });
        }
    };

    // Which nav group the feature sits in. Edited straight from this table
    // rather than only inside the feature editor: sorting a module's features
    // into groups is a job you do across the whole list at once, and opening
    // and closing a page per feature to do it would be the slow way round.
    // An empty string clears it back to uncategorised.
    const handleSetFeatureCategory = (f, category) => {
        const data = { category: category || null };
        if (isPlatform) {
            updatePlatformFeature({ featureId: f.id, data });
        } else {
            updateTenantFeature({ moduleId: module.id, slug: f.slug, data });
        }
    };

    const categories = categorySummary(features);
    const categoryOptions = categories.map((c) => c.name);
    const uncategorisedCount = features.filter((f) => !(f.category || '').trim()).length;
    const createState = isPlatform ? createPlatformState : createTenantState;

    if (!module) return <Alert severity="info">Loading module…</Alert>;

    const set = (k, v) => patchModule({ [k]: v });
    const patchTranslations = (fieldKey, next) => {
        patchModule({ translations: { ...(module.translations || {}), ...next } });
    };

    const handleCreate = async (form) => {
        // An untouched category field is "no category", not a category whose
        // name is the empty string — send null so the column reads the same
        // whether the feature predates categories or just wasn't given one.
        const data = { ...form, category: (form.category || '').trim() || null };
        try {
            if (isPlatform) {
                await createPlatformFeature({ moduleId: module.id, data }).unwrap();
            } else {
                await createTenantFeature({ moduleId: module.id, data }).unwrap();
            }
            setCreateOpen(false);
        } catch {
            // Keep dialog open; ``createState.error`` surfaces the 422 details.
        }
    };
    const handleDelete = (slug) => {
        if (!window.confirm(`Delete feature "${slug}"?`)) return;
        if (isPlatform) {
            // Platform delete is keyed by row id, not slug — translate
            // here so the calling row's delete icon stays generic.
            const f = features.find((x) => x.slug === slug);
            if (f?.id) deletePlatformFeature(f.id);
        } else {
            deleteTenantFeature({ moduleId: module.id, slug });
        }
    };
    const featureEditorBase = isPlatform
        ? '/dashboard/platform/landing-config/modules'
        : '/dashboard/admin/tenant-landing/modules';
    const openFeature = (slug) =>
        navigate(`${featureEditorBase}/${module.id}/features/${slug}`);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* ──────────────── Module Configuration (table) ──────────────── */}
            <Card>
                <CardContent>
                    <Typography variant="h6" gutterBottom>Module Configuration</Typography>
                    <Typography color="text.secondary" sx={{ mb: 3 }}>
                        Edit the module's identity and ordering. Features and FAQ are below.
                    </Typography>

                    {/* Horizontal scroll on small screens — fixed columns sum
                        past a phone viewport, so keep header + rows on one
                        min-width track and let it scroll rather than overflow. */}
                    <Box sx={{ overflowX: 'auto' }}>
                    <Box sx={{ minWidth: 780 }}>
                    <Box sx={{
                        display: 'grid', gridTemplateColumns: GRID_COLS, gap: 1,
                        alignItems: 'center', bgcolor: 'primary.main', color: 'white',
                        p: 1.5, borderRadius: '4px 4px 0 0',
                    }}>
                        <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">S.No</Typography>
                        <Typography fontWeight="bold" fontSize="0.85rem">Field Name</Typography>
                        <Typography fontWeight="bold" fontSize="0.85rem">Value</Typography>
                        <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Display</Typography>
                        <Typography fontWeight="bold" textAlign="center" fontSize="0.85rem">Mandatory</Typography>
                    </Box>

                    {MODULE_FIELDS.map((field, index) => (
                        <Box
                            key={field.key}
                            sx={{
                                display: 'grid', gridTemplateColumns: GRID_COLS, gap: 1,
                                alignItems: 'center', p: 1, borderBottom: '1px solid',
                                borderLeft: '1px solid', borderRight: '1px solid',
                                borderColor: 'divider',
                                bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                                '&:hover': { bgcolor: '#e3f2fd' },
                            }}
                        >
                            <Typography textAlign="center" fontWeight={500}>
                                {String(index + 1).padStart(2, '0')}
                            </Typography>
                            <Typography fontWeight={500}>{field.label}</Typography>

                            <Box>
                                {field.type === 'text' && (
                                    <Box>
                                        <TextField
                                            size="small" fullWidth
                                            defaultValue={module[field.key] || ''}
                                            onBlur={(e) => set(field.key, e.target.value)}
                                            disabled={!canEdit || !!field.readonly}
                                            helperText={field.helperText}
                                        />
                                        {field.translatable && (
                                            <TranslationsEditor
                                                translations={module.translations || {}}
                                                translatableKeys={[field.key]}
                                                defaults={{ [field.key]: module[field.key] || '' }}
                                                onChange={(next) => patchTranslations(field.key, next)}
                                            />
                                        )}
                                    </Box>
                                )}
                                {field.type === 'textarea' && (
                                    <Box>
                                        <TextField
                                            size="small" fullWidth multiline rows={2}
                                            defaultValue={module[field.key] || ''}
                                            onBlur={(e) => set(field.key, e.target.value)}
                                            disabled={!canEdit}
                                        />
                                        {field.translatable && (
                                            <TranslationsEditor
                                                translations={module.translations || {}}
                                                translatableKeys={[field.key]}
                                                defaults={{ [field.key]: module[field.key] || '' }}
                                                onChange={(next) => patchTranslations(field.key, next)}
                                            />
                                        )}
                                    </Box>
                                )}
                                {field.type === 'number' && (
                                    <TextField
                                        type="number" size="small" sx={{ width: 120 }}
                                        defaultValue={module[field.key] ?? 0}
                                        onBlur={(e) => set(field.key, Number(e.target.value))}
                                        disabled={!canEdit}
                                    />
                                )}
                                {field.type === 'switch' && (
                                    <Switch
                                        checked={!!module[field.key]}
                                        onChange={(e) => set(field.key, e.target.checked)}
                                        disabled={!canEdit}
                                    />
                                )}
                                {field.type === 'logo' && (
                                    <LogoUploader
                                        currentUrl={module.logo_url || null}
                                        onChange={(assetId) => set('logo_asset_id', assetId)}
                                        disabled={!canEdit}
                                        label="Module logo"
                                    />
                                )}
                                {field.type === 'media' && field.itemsKey === 'videos' && (
                                    <VideosEditor
                                        value={module.vid_json || {}}
                                        onChange={(next) => set('vid_json', next)}
                                        disabled={!canEdit}
                                        isPlatform={isPlatform}
                                    />
                                )}
                                {field.type === 'media' && field.itemsKey === 'images' && (
                                    <ImagesEditor
                                        value={module.img_json || {}}
                                        onChange={(next) => set('img_json', next)}
                                        disabled={!canEdit}
                                        isPlatform={isPlatform}
                                    />
                                )}
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography variant="caption" color="text.disabled">Always Visible</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Typography variant="caption" color="text.disabled">N/A</Typography>
                            </Box>
                        </Box>
                    ))}
                    </Box>
                    </Box>
                </CardContent>
            </Card>

            {/* ──────────────── FAQ ──────────────── */}
            <Card>
                <CardContent>
                    <Typography variant="h6" gutterBottom>Module FAQ</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Shown at the bottom of the module page. Use up/down arrows to reorder.
                    </Typography>
                    <Divider sx={{ mb: 1 }} />
                    <FaqEditor
                        value={module.faq_json || []}
                        onChange={(next) => patchModule({ faq_json: next })}
                        disabled={!canEdit}
                    />
                </CardContent>
            </Card>

            {/* ──────────────── Features sub-table ──────────────── */}
            <Card>
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                        <Typography variant="h6">Features</Typography>
                        {canEdit && (
                            <Button
                                variant="contained" startIcon={<AddIcon />}
                                onClick={() => setCreateOpen(true)}
                            >
                                New feature
                            </Button>
                        )}
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        Click a row to open the feature editor — price, sections, translations.
                        Set a <strong>Category</strong> to group features under a heading in the
                        top-nav dropdown; features sharing a name land in the same group.
                    </Typography>

                    {/* The nav structure this module currently produces, in the
                        order visitors will see it. Categories are ordered by
                        their first feature's Order, so this doubles as a check
                        that the ordering came out how the admin meant it. */}
                    {(categories.length > 0 || features.length > 0) && (
                        <Stack
                            direction="row" spacing={1} alignItems="center"
                            flexWrap="wrap" useFlexGap
                            sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}
                        >
                            <Typography variant="caption" fontWeight={700} color="text.secondary">
                                Nav groups:
                            </Typography>
                            {categories.length === 0 ? (
                                <Typography variant="caption" color="text.disabled">
                                    None yet — the dropdown shows one flat list of{' '}
                                    {features.length} feature{features.length === 1 ? '' : 's'}.
                                </Typography>
                            ) : (
                                <>
                                    {categories.map((c, i) => (
                                        <Chip
                                            key={c.name}
                                            size="small"
                                            label={`${i + 1}. ${c.name} · ${c.count}`}
                                            color="primary"
                                            variant="outlined"
                                        />
                                    ))}
                                    {uncategorisedCount > 0 && (
                                        <Tooltip title="Features with no category are grouped last, under 'Other'.">
                                            <Chip
                                                size="small" variant="outlined"
                                                label={`Other · ${uncategorisedCount}`}
                                            />
                                        </Tooltip>
                                    )}
                                </>
                            )}
                            {/* The grouping is a site-wide switch, not a
                                property of this module — categories are stored
                                either way but only navigated when it's on.
                                Said here rather than read from the config: the
                                setting lives on the landing root, which this
                                editor doesn't load. */}
                            <Box sx={{ flexBasis: '100%' }} />
                            <Typography variant="caption" color="text.disabled">
                                Used only while <strong>Navbar Hierarchy</strong> is set to
                                3 levels, on the landing page config. On 2 levels these
                                categories stay saved but the dropdown lists every service flat.
                            </Typography>
                        </Stack>
                    )}

                    <Divider sx={{ mb: 1 }} />
                    <TableContainer>
                    <Table size="small">
                        <TableHead>
                            <TableRow>
                                <TableCell>Title</TableCell>
                                <TableCell>Slug</TableCell>
                                <TableCell width={190}>Category</TableCell>
                                <TableCell>Price</TableCell>
                                <TableCell>Order</TableCell>
                                <TableCell align="center" width={80}>Shown</TableCell>
                                <TableCell align="center" width={80}>Slider</TableCell>
                                <TableCell align="right" width={120}>Actions</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {features.length === 0 && (
                                <TableRow><TableCell colSpan={8}>No features yet.</TableCell></TableRow>
                            )}
                            {features.map((f) => (
                                <TableRow
                                    key={f.id} hover
                                    onClick={() => openFeature(f.slug)}
                                    sx={{ cursor: 'pointer' }}
                                >
                                    <TableCell>{f.title}</TableCell>
                                    <TableCell><code>{f.slug}</code></TableCell>
                                    {/* Stop propagation: the row click opens the
                                        feature editor, and typing in this cell
                                        must not navigate away mid-edit. */}
                                    <TableCell onClick={(e) => e.stopPropagation()}>
                                        <CategoryCell
                                            feature={f}
                                            options={categoryOptions}
                                            disabled={!canEdit}
                                            onSave={handleSetFeatureCategory}
                                        />
                                    </TableCell>
                                    <TableCell>{f.starting_price || '—'}</TableCell>
                                    <TableCell>{f.display_order}</TableCell>
                                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                        <Tooltip title="Show this feature on the public landing page">
                                            <Switch
                                                size="small" checked={!!f.is_visible}
                                                onChange={() => handleToggleFeatureVisible(f)}
                                                disabled={!canEdit}
                                            />
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                                        <Tooltip title="Show in the public 'featured slider' (third sliding bar)">
                                            <Switch
                                                size="small" checked={!!f.show_in_slider}
                                                onChange={() => handleToggleFeatureSlider(f)}
                                                disabled={!canEdit}
                                            />
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                                        <Tooltip title="Open feature editor">
                                            <IconButton onClick={() => openFeature(f.slug)}>
                                                <EditIcon />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Delete feature">
                                            <span>
                                                <IconButton color="error" disabled={!canEdit}
                                                            onClick={() => handleDelete(f.slug)}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    </TableContainer>
                </CardContent>
            </Card>

            {canEdit && (
                <FeatureCreateDialog
                    open={createOpen} onClose={() => setCreateOpen(false)}
                    onCreate={handleCreate} isSaving={createState.isLoading}
                    lastError={createState.error}
                    categoryOptions={categoryOptions}
                />
            )}
        </Box>
    );
};

export default EditorTab;
