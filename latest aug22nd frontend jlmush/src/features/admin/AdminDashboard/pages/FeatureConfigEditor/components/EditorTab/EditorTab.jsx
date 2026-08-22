/**
 * Feature Editor tab — table-style row-per-section editor.
 *
 * Each section of the public feature page (What is it, Eligibility, Who Should
 * Join, What's Included, Benefits, Disadvantages, Expected Outcome, How It
 * Works, Documents, Pricing, Rating, Book Now) lives on its own row. Row order here mirrors the
 * order the sections appear on the public page. The ``Display`` column toggles
 * the section on/off via
 * ``sections_enabled_json[key]`` — identical UX to PageConfigEditor's field
 * visibility control.
 *
 * Top-level meta (title, slug, description) sits in "Always Visible" rows
 * above the toggleable section rows.
 */
import { useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
    Box, Card, CardContent, Typography, TextField, Switch, Button, Chip,
    IconButton, List, ListItem, ListItemText, Grid, Alert, Autocomplete,
} from '@mui/material';
import { useGetAdminProductsQuery } from '../../../../../api/marketplaceEndpoints';
import { useListLandingFeaturesQuery } from '../../../../../api/landingPageConfigEndpoints';
import { useListPlatformLandingFeaturesQuery } from '../../../../../api/platformLandingEndpoints';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { TranslationsEditor } from '../../../../../../../common/i18n';
import LogoUploader from '../../../../components/LogoUploader/LogoUploader';
import { VideosEditor, ImagesEditor } from '../../../../../components/MediaListEditor/MediaListEditor';
import CareTeamEditor from '../CareTeamEditor/CareTeamEditor';
import ProductLinkingEditor from '../ProductLinkingEditor/ProductLinkingEditor';

const GRID_COLS = '50px 220px 1fr 150px 130px';

// ---------------------------------------------------------------------------
// Field defs. ``sectionKey`` (when present) names the on/off toggle stored on
// ``sections_enabled_json``. ``translatable`` surfaces the TranslationsEditor.
// ---------------------------------------------------------------------------
const FEATURE_FIELDS = [
    { key: 'title',          label: 'Title',         type: 'text',     translatable: true },
    { key: 'slug',           label: 'Slug',          type: 'text',     readonly: true, helperText: 'Slug is immutable after creation.' },
    { key: 'logo',           label: 'Logo',          type: 'logo' },
    { key: 'description',    label: 'Description',   type: 'textarea', translatable: true },
    // Middle level of the public nav: module → category → feature. Features
    // naming the same category share a heading in the top-nav dropdown.
    //
    // Deliberately NOT translatable, unlike Title and Description. A category
    // is a grouping KEY, not display copy — the nav groups features by the
    // string it resolves to, so two features in one category translated even
    // slightly differently would split into two headings in that language
    // while looking identical in English.
    { key: 'category',       label: 'Nav Category',  type: 'category',
      helperText: 'Groups this feature under a heading in the top-nav dropdown. Leave blank to list it flat.' },
    // Popular flag — drives whether this feature surfaces in the landing
    // page's up-front services grid vs. the "More" overflow. Not a
    // hide/show section toggle, so Display = "Always Visible".
    { key: 'is_popular',     label: 'Popular (show up-front on landing)', type: 'switch' },
    { key: 'show_in_slider', label: 'Show in featured slider (third sliding bar)', type: 'switch' },

    // Toggleable sections — ``sectionKey`` maps into sections_enabled_json.
    { key: 'what_is',        label: 'What is it?',           type: 'textarea', translatable: true,  sectionKey: 'what_is' },
    { key: 'requirements',   label: 'Requirements',          type: 'list_string', sectionKey: 'eligibility', placeholder: 'e.g. Single-person owner' },

    // Audience + results. Both render as cards on the public page, so each
    // entry is a {title, desc} pair — same value shape (and same editor) as
    // ``process``, just with audience/outcome wording.
    {
        key: 'who_should_join', label: 'Who Should Join the Program',
        type: 'pair_list', sectionKey: 'who_should_join',
        hint: 'One card per audience.',
        titleLabel: 'Who they are', descLabel: 'Why it fits them',
        titlePlaceholder: 'e.g. First-time founders',
        descPlaceholder: 'e.g. Testing an idea without company overhead',
    },

    {
        key: 'whats_included', label: "What's Included",
        type: 'pair_list', sectionKey: 'whats_included',
        hint: 'One line per thing the price covers.',
        titleLabel: 'What they get', descLabel: 'Detail (optional)',
        titlePlaceholder: 'e.g. Dedicated expert',
        descPlaceholder: 'e.g. One point of contact from start to delivery',
    },

    { key: 'benefits',       label: 'Benefits',              type: 'list_string', sectionKey: 'benefits',    placeholder: 'e.g. Minimal compliance' },
    { key: 'disadvantages',  label: 'Disadvantages',         type: 'list_string', sectionKey: 'disadvantages', placeholder: 'e.g. Unlimited liability' },

    {
        key: 'expected_outcomes', label: 'Expected Outcome',
        type: 'pair_list', sectionKey: 'expected_outcomes',
        hint: 'One card per result the customer walks away with.',
        titleLabel: 'Outcome', descLabel: 'What it means for them',
        titlePlaceholder: 'e.g. Certificate in hand',
        descPlaceholder: 'e.g. Delivered digitally the day it is issued',
    },

    { key: 'process',        label: 'How It Works (steps)',  type: 'pair_list', sectionKey: 'how_it_works',
      titleLabel: 'Step title', descLabel: 'Description' },
    { key: 'documents',      label: 'Documents Required',    type: 'list_string', sectionKey: 'documents',   placeholder: 'e.g. PAN Card' },
    { key: 'starting_price', label: 'Starting Price',        type: 'text',     sectionKey: 'pricing', placeholder: 'Rs 299' },
    { key: 'timeline',       label: 'Timeline',              type: 'text',     sectionKey: 'pricing', placeholder: '7-10 working days' },
    { key: 'rating',         label: 'Rating Label',          type: 'text',     sectionKey: 'rating',  placeholder: '4.8/5' },
    { key: 'book_cta_label', label: 'Book CTA Label',        type: 'text',     translatable: true, sectionKey: 'book_now', placeholder: 'Book Now' },
    { key: 'product_id',     label: 'Linked booking product', type: 'product', sectionKey: 'book_now', helperText: 'Book Now redirects here. Leave empty for none.' },

    // Doctors with a per-doctor switch for each field the public card may
    // reveal. Both stacks have this: the tenant editor picks from the
    // tenant's doctors, the apex editor from the default tenant's.
    { key: 'care_team',      label: 'Meet your care team',   type: 'care_team', sectionKey: 'care_team' },

    // Back-office product/provider linking — offering → product → teams/doctors.
    // Deliberately SEPARATE from the care team above: this never renders on the
    // public page, it's routing/config data. No sectionKey (not a page section).
    { key: 'product_links_json', label: 'Product & provider linking', type: 'product_links',
      hint: 'Link offerings/products to the teams or doctors that deliver them. Back-office only — not shown on the public page.' },

    // Accordion at the bottom of the service page. Same ``faq_json`` shape
    // ([{question, answer}]) and editor as the module-level FAQ.
    { key: 'faq_json',       label: 'FAQ',                   type: 'faq',      sectionKey: 'faq' },

    // Image / video galleries — same editor + persistence shape as the module
    // galleries (stored under the feature's ``img_json`` / ``vid_json``).
    { key: 'vid_json',       label: 'Video Gallery',         type: 'media',    itemsKey: 'videos' },
    { key: 'img_json',       label: 'Image Gallery',         type: 'media',    itemsKey: 'images' },
];

// ---------------------------------------------------------------------------
// Small value-column editors
// ---------------------------------------------------------------------------

const ListStringValue = ({ values = [], onChange, placeholder, disabled }) => {
    const [draft, setDraft] = useState('');
    const add = () => {
        if (!draft.trim()) return;
        onChange([...(values || []), draft.trim()]);
        setDraft('');
    };
    return (
        <Box>
            <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                <TextField
                    size="small" fullWidth placeholder={placeholder}
                    value={draft} onChange={(e) => setDraft(e.target.value)}
                    disabled={disabled}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
                />
                <Button size="small" variant="outlined" onClick={add} disabled={disabled}>Add</Button>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {(values || []).map((v, i) => (
                    <Chip
                        key={`${v}-${i}`} size="small" label={v}
                        onDelete={disabled ? undefined : () => onChange(values.filter((_, idx) => idx !== i))}
                    />
                ))}
            </Box>
        </Box>
    );
};

// Ordered list of ``{title, desc}`` pairs. Shared by every section that
// renders as cards on the public page — How It Works, Who Should Join,
// What's Included and Expected Outcome — with each caller supplying its own
// column wording.
const PairListValue = ({
    values = [], onChange, disabled,
    titleLabel = 'Title', descLabel = 'Description',
    titlePlaceholder, descPlaceholder,
}) => {
    const [step, setStep] = useState({ title: '', desc: '' });
    const add = () => {
        if (!step.title.trim()) return;
        onChange([...(values || []), { ...step }]);
        setStep({ title: '', desc: '' });
    };
    const move = (i, dir) => {
        const t = i + dir;
        if (t < 0 || t >= values.length) return;
        const next = [...values];
        const [item] = next.splice(i, 1);
        next.splice(t, 0, item);
        onChange(next);
    };
    return (
        <Box>
            <Grid container spacing={1} sx={{ mb: 1 }}>
                <Grid item xs={12} sm={4}>
                    <TextField
                        size="small" fullWidth label={titleLabel}
                        placeholder={titlePlaceholder}
                        value={step.title} disabled={disabled}
                        onChange={(e) => setStep((p) => ({ ...p, title: e.target.value }))}
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                        size="small" fullWidth label={descLabel}
                        placeholder={descPlaceholder}
                        value={step.desc} disabled={disabled}
                        onChange={(e) => setStep((p) => ({ ...p, desc: e.target.value }))}
                    />
                </Grid>
                <Grid item xs={12} sm={2}>
                    <Button
                        fullWidth size="small" variant="outlined" startIcon={<AddIcon />}
                        onClick={add} disabled={disabled || !step.title.trim()}
                    >
                        Add
                    </Button>
                </Grid>
            </Grid>
            <List dense disablePadding>
                {(values || []).map((s, i) => (
                    <ListItem
                        key={i} sx={{ py: 0 }}
                        secondaryAction={
                            <Box>
                                <IconButton size="small" disabled={disabled || i === 0}
                                            onClick={() => move(i, -1)}>
                                    <ArrowUpwardIcon fontSize="inherit" />
                                </IconButton>
                                <IconButton size="small" disabled={disabled || i === values.length - 1}
                                            onClick={() => move(i, 1)}>
                                    <ArrowDownwardIcon fontSize="inherit" />
                                </IconButton>
                                <IconButton size="small" color="error" disabled={disabled}
                                            onClick={() => onChange(values.filter((_, idx) => idx !== i))}>
                                    <DeleteIcon fontSize="inherit" />
                                </IconButton>
                            </Box>
                        }
                    >
                        <ListItemText primary={s.title} secondary={s.desc} />
                    </ListItem>
                ))}
            </List>
        </Box>
    );
};

// Question/answer pairs for the service page's FAQ accordion. Mirrors the
// module editor's FaqEditor — same value shape, same reorder affordances.
const FaqValue = ({ values = [], onChange, disabled }) => {
    const [draft, setDraft] = useState({ question: '', answer: '' });
    const add = () => {
        if (!draft.question.trim() || !draft.answer.trim()) return;
        onChange([...(values || []), {
            question: draft.question.trim(),
            answer: draft.answer.trim(),
        }]);
        setDraft({ question: '', answer: '' });
    };
    const move = (i, dir) => {
        const t = i + dir;
        if (t < 0 || t >= values.length) return;
        const next = [...values];
        const [item] = next.splice(i, 1);
        next.splice(t, 0, item);
        onChange(next);
    };
    return (
        <Box>
            <Grid container spacing={1} sx={{ mb: 1 }}>
                <Grid item xs={12} sm={4}>
                    <TextField
                        size="small" fullWidth label="Question"
                        value={draft.question} disabled={disabled}
                        onChange={(e) => setDraft((p) => ({ ...p, question: e.target.value }))}
                    />
                </Grid>
                <Grid item xs={12} sm={6}>
                    <TextField
                        size="small" fullWidth label="Answer" multiline maxRows={4}
                        value={draft.answer} disabled={disabled}
                        onChange={(e) => setDraft((p) => ({ ...p, answer: e.target.value }))}
                    />
                </Grid>
                <Grid item xs={12} sm={2}>
                    <Button
                        fullWidth size="small" variant="outlined" startIcon={<AddIcon />}
                        onClick={add}
                        disabled={disabled || !draft.question.trim() || !draft.answer.trim()}
                    >
                        Add
                    </Button>
                </Grid>
            </Grid>
            <List dense disablePadding>
                {(values || []).map((item, i) => (
                    <ListItem
                        key={i} sx={{ py: 0 }}
                        secondaryAction={
                            <Box>
                                <IconButton size="small" disabled={disabled || i === 0}
                                            onClick={() => move(i, -1)}>
                                    <ArrowUpwardIcon fontSize="inherit" />
                                </IconButton>
                                <IconButton size="small" disabled={disabled || i === values.length - 1}
                                            onClick={() => move(i, 1)}>
                                    <ArrowDownwardIcon fontSize="inherit" />
                                </IconButton>
                                <IconButton size="small" color="error" disabled={disabled}
                                            onClick={() => onChange(values.filter((_, idx) => idx !== i))}>
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
// Main tab
// ---------------------------------------------------------------------------

const EditorTab = ({ feature, canEdit, patchFeature }) => {
    // Same URL-prefix scope detection as the module editor — picks the tenant
    // vs platform upload route inside the gallery editors.
    const location = useLocation();
    const isPlatform = location.pathname.startsWith('/dashboard/platform/');
    // Products the feature's "Book Now" can link to (admin service catalog).
    const { data: products = [] } = useGetAdminProductsQuery();

    // Sibling features, purely so the Nav Category field can offer the
    // categories already in use on this module. Categories are matched by
    // exact string, so a picker beats free typing: "Diagnostics" and
    // "diagnostics" would otherwise become two headings in the dropdown.
    const { moduleId } = useParams();
    const tenantSiblingsQ = useListLandingFeaturesQuery(moduleId, {
        skip: !moduleId || isPlatform,
    });
    const platformSiblingsQ = useListPlatformLandingFeaturesQuery(moduleId, {
        skip: !moduleId || !isPlatform,
    });
    const siblings = (isPlatform ? platformSiblingsQ.data : tenantSiblingsQ.data) || [];
    const categoryOptions = [...new Set(
        siblings.map((f) => (f.category || '').trim()).filter(Boolean),
    )];

    if (!feature) return <Alert severity="info">Loading feature…</Alert>;

    const sections = feature.sections_enabled_json || {};
    const sectionShown = (key) => sections[key] !== false;
    const toggleSection = (key, value) => {
        patchFeature({ sections_enabled_json: { ...sections, [key]: value } });
    };

    const set = (k, v) => patchFeature({ [k]: v });
    const patchTranslations = (fieldKey, next) => {
        patchFeature({ translations: { ...(feature.translations || {}), ...next } });
    };

    const renderValue = (field) => {
        switch (field.type) {
            case 'text':
                return (
                    <Box>
                        <TextField
                            size="small" fullWidth placeholder={field.placeholder}
                            defaultValue={feature[field.key] || ''}
                            onBlur={(e) => set(field.key, e.target.value)}
                            disabled={!canEdit || !!field.readonly}
                            helperText={field.helperText}
                        />
                        {field.translatable && (
                            <TranslationsEditor
                                translations={feature.translations || {}}
                                translatableKeys={[field.key]}
                                defaults={{ [field.key]: feature[field.key] || '' }}
                                onChange={(next) => patchTranslations(field.key, next)}
                            />
                        )}
                    </Box>
                );
            case 'textarea':
                return (
                    <Box>
                        <TextField
                            size="small" fullWidth multiline rows={2}
                            defaultValue={feature[field.key] || ''}
                            onBlur={(e) => set(field.key, e.target.value)}
                            disabled={!canEdit}
                        />
                        {field.translatable && (
                            <TranslationsEditor
                                translations={feature.translations || {}}
                                translatableKeys={[field.key]}
                                defaults={{ [field.key]: feature[field.key] || '' }}
                                onChange={(next) => patchTranslations(field.key, next)}
                            />
                        )}
                    </Box>
                );
            case 'list_string':
                return (
                    <ListStringValue
                        values={feature[field.key]}
                        onChange={(values) => set(field.key, values)}
                        placeholder={field.placeholder} disabled={!canEdit}
                    />
                );
            case 'pair_list':
                return (
                    <PairListValue
                        values={feature[field.key]}
                        onChange={(values) => set(field.key, values)}
                        disabled={!canEdit}
                        titleLabel={field.titleLabel}
                        descLabel={field.descLabel}
                        titlePlaceholder={field.titlePlaceholder}
                        descPlaceholder={field.descPlaceholder}
                    />
                );
            case 'faq':
                return (
                    <FaqValue
                        values={feature[field.key]}
                        onChange={(values) => set(field.key, values)}
                        disabled={!canEdit}
                    />
                );
            case 'category':
                return (
                    <Autocomplete
                        freeSolo
                        size="small"
                        options={categoryOptions}
                        value={feature.category || ''}
                        disabled={!canEdit}
                        // Commit on selection or blur, not per keystroke: the
                        // parent debounces nothing and every patch is a PUT.
                        onChange={(_, v) => set('category', (v || '').trim() || null)}
                        onBlur={(e) => {
                            const next = (e.target.value || '').trim() || null;
                            if (next !== (feature.category || null)) set('category', next);
                        }}
                        renderInput={(params) => (
                            <TextField
                                {...params}
                                placeholder="Uncategorised"
                                helperText={field.helperText}
                            />
                        )}
                    />
                );
            case 'product': {
                const selected = products.find((p) => String(p.id) === String(feature.product_id)) || null;
                return (
                    <Autocomplete
                        size="small"
                        options={products}
                        getOptionLabel={(o) => (o?.name ? `${o.name} (₹${o.min_price}–${o.max_price})` : '')}
                        value={selected}
                        onChange={(_, v) => set('product_id', v ? v.id : null)}
                        disabled={!canEdit}
                        isOptionEqualToValue={(o, v) => String(o.id) === String(v?.id)}
                        renderInput={(params) => (
                            <TextField {...params} placeholder="Select a product…" helperText={field.helperText} />
                        )}
                    />
                );
            }
            case 'care_team': {
                // When the feature is linked to a product, scope the care-team
                // doctor picker to that product's providers (service listing
                // doctors, or a group's team members) instead of every doctor.
                const linked = products.find((p) => String(p.id) === String(feature.product_id)) || null;
                const linkedOffering = linked ? (linked.is_group_service ? 'group' : 'service') : null;
                return (
                    <CareTeamEditor
                        values={feature[field.key]}
                        onChange={(values) => set(field.key, values)}
                        disabled={!canEdit}
                        isPlatform={isPlatform}
                        productId={linked ? linked.id : null}
                        offering={linkedOffering}
                    />
                );
            }
            case 'product_links':
                // Self-contained: reads/writes the shared FeatureProductLink
                // store (same rows as the Feature-Product Linking page), not the
                // per-feature field. It saves itself, so it isn't part of the
                // feature's Save Draft.
                return <ProductLinkingEditor disabled={!canEdit} />;
            case 'switch':
                return (
                    <Switch
                        checked={!!feature[field.key]}
                        onChange={(e) => set(field.key, e.target.checked)}
                        disabled={!canEdit}
                    />
                );
            case 'logo':
                return (
                    <LogoUploader
                        currentUrl={feature.logo_url || null}
                        onChange={(assetId) => set('logo_asset_id', assetId)}
                        disabled={!canEdit}
                        label="Service logo"
                    />
                );
            case 'media':
                return field.itemsKey === 'videos' ? (
                    <VideosEditor
                        value={feature.vid_json || {}}
                        onChange={(next) => set('vid_json', next)}
                        disabled={!canEdit}
                        isPlatform={isPlatform}
                    />
                ) : (
                    <ImagesEditor
                        value={feature.img_json || {}}
                        onChange={(next) => set('img_json', next)}
                        disabled={!canEdit}
                        isPlatform={isPlatform}
                    />
                );
            default:
                return null;
        }
    };

    return (
        <Card>
            <CardContent>
                <Typography variant="h6" gutterBottom>Feature Configuration</Typography>
                <Typography color="text.secondary" sx={{ mb: 3 }}>
                    The page layout is fixed. Toggle sections on/off in the Display column;
                    translations live inline with each text field.
                </Typography>

                {/* Horizontal scroll on small screens — fixed columns sum
                    past a phone viewport, so keep header + rows on one
                    min-width track and let it scroll rather than overflow. */}
                <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 780 }}>
                {/* Header */}
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

                {FEATURE_FIELDS
                    .map((field, index) => {
                    const hasToggle = !!field.sectionKey;
                    const shown = hasToggle ? sectionShown(field.sectionKey) : true;
                    return (
                        <Box
                            key={field.key}
                            sx={{
                                display: 'grid', gridTemplateColumns: GRID_COLS, gap: 1,
                                alignItems: 'flex-start', p: 1, borderBottom: '1px solid',
                                borderLeft: '1px solid', borderRight: '1px solid',
                                borderColor: 'divider',
                                bgcolor: index % 2 === 0 ? '#fafafa' : 'white',
                                opacity: hasToggle && !shown ? 0.5 : 1,
                                '&:hover': { bgcolor: '#e3f2fd' },
                            }}
                        >
                            <Typography textAlign="center" fontWeight={500} sx={{ pt: 1 }}>
                                {String(index + 1).padStart(2, '0')}
                            </Typography>
                            <Box sx={{ pt: 1 }}>
                                <Typography fontWeight={500}>{field.label}</Typography>
                                {field.hint && (
                                    <Typography variant="caption" color="text.secondary">
                                        {field.hint}
                                    </Typography>
                                )}
                            </Box>

                            <Box>{renderValue(field)}</Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, pt: 1 }}>
                                {hasToggle ? (
                                    <>
                                        <Typography variant="caption" color={!shown ? 'error.main' : 'text.disabled'}>Hide</Typography>
                                        <Switch
                                            size="small" checked={shown}
                                            onChange={(e) => toggleSection(field.sectionKey, e.target.checked)}
                                            disabled={!canEdit}
                                            color="success"
                                        />
                                        <Typography variant="caption" color={shown ? 'success.main' : 'text.disabled'}>Show</Typography>
                                    </>
                                ) : (
                                    <Typography variant="caption" color="text.disabled">Always Visible</Typography>
                                )}
                            </Box>

                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', pt: 1 }}>
                                <Typography variant="caption" color="text.disabled">N/A</Typography>
                            </Box>
                        </Box>
                    );
                })}
                </Box>
                </Box>
            </CardContent>
        </Card>
    );
};

export default EditorTab;
