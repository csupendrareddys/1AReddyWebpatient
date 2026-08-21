/**
 * Category (new look) — port of the mobile MVP's ``app/category/[key].tsx``:
 * one booking category's options, in whichever of the four views is selected.
 *
 * The category DEFINITIONS (name, tagline, icon) are config; what's IN the
 * category comes from ASSUMED endpoint #11 (api/assumedEndpoints.js), so no
 * price appears that the backend never quoted. While that endpoint doesn't
 * exist, the page says so and the "book the real way" row keeps a live path
 * into the flows that work today.
 *
 * Picking an option opens a detail dialog whose Continue lands in the real
 * booking surface for its kind — appointments into the booking form, services
 * into the marketplace, group services into health plans.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
    Alert, Box, Button, ButtonBase, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, IconButton, Typography,
} from '@mui/material';
import NLBadge from '../../components/NLBadge';
import NLIcon from '../../components/NLIcon';
import NLItemViews from '../../components/NLItemViews';
import NLViewSwitcher from '../../components/NLViewSwitcher';
import NLEmptyState from '../../components/NLEmptyState';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import { useGetNLProductCategoriesQuery } from '../../api/assumedEndpoints';
import { categoryByKey, KIND_LABEL, KIND_TONE } from '../../data/categories';
import { SAMPLE_CATEGORY_ITEMS } from '../../data/sampleCatalogue';
import { isMissingEndpoint } from '../../api/assumedEndpoints';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import { colors, radius, tint, typography } from '../../theme/tokens';
import { inr } from '../../utils/format';

/** Where each product kind can genuinely be bought today. */
const KIND_TARGET = {
    appointment: 'newlook/book',
    service: 'marketplace',
    group_service: 'health-plans',
};

const Category = () => {
    const { key } = useParams();
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const go = (p) => navigate(`${basePath}/${p}`);

    const category = categoryByKey(key);
    const [mode, setMode] = useState('list');
    const [detail, setDetail] = useState(null);

    const { data: catalogues = [], isLoading, error } = useGetNLProductCategoriesQuery();
    const live = (catalogues.find((c) => c.key === key)?.items) || [];
    // Fall back to the mobile app's own catalogue ONLY when the real endpoint
    // is genuinely absent — never to paper over a real failure — and say so on
    // screen whenever it happens.
    const isSample = !live.length && isMissingEndpoint(error);
    const items = isSample ? (SAMPLE_CATEGORY_ITEMS[key] || []) : live;

    if (!category) {
        return (
            <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
                <NLEmptyState icon="alert-circle-outline" title="Category not found" />
            </Box>
        );
    }

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 1.5 }}>{category.name}</Typography>

            {/* Hero — the category's own tint and tagline, as on mobile. */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.25 }}>
                <Box
                    sx={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        bgcolor: tint(category.tint, 0.1),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <NLIcon name={category.icon} size={22} color={category.tint} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={typography.body}>{category.tagline}</Typography>
                    <Typography sx={typography.caption}>
                        {items.length} {items.length === 1 ? 'option' : 'options'} available
                    </Typography>
                </Box>
            </Box>

            {isSample ? (
                <Alert severity="warning" sx={{ mb: 2 }}>
                    <strong>Sample data.</strong> These {items.length} options come from the
                    patient mobile MVP, not your backend —{' '}
                    <code>GET /api/patient/product-categories</code> doesn&apos;t exist yet.
                    They&apos;re here so every booking type can be clicked through; the prices
                    are the mobile app&apos;s, not real quotes. Booking still hands off to the
                    live flows.
                </Alert>
            ) : (
                <NLAssumedNotice error={error} endpoint="GET /api/patient/product-categories">
                    The button below books this kind of care through the flows that already work.
                </NLAssumedNotice>
            )}

            {/* The live path into this category, whatever the catalogue says. */}
            <ButtonBase
                onClick={() => go(category.realTarget)}
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    width: '100%',
                    textAlign: 'left',
                    mb: 2.25,
                    p: '13px',
                    borderRadius: `${radius.md}px`,
                    border: `1.5px dashed ${category.tint}`,
                    color: category.tint,
                }}
            >
                <NLIcon name={category.icon} size={17} color={category.tint} />
                <Typography sx={{ fontSize: 13, fontWeight: 700, flex: 1, color: category.tint }}>
                    {category.realLabel} now
                </Typography>
                <NLIcon name="chevron-forward" size={15} color={category.tint} />
            </ButtonBase>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : items.length ? (
                <>
                    <NLViewSwitcher
                        mode={mode}
                        onChange={setMode}
                        hint={mode === 'slide' ? 'Swipe · auto every 18s' : `${items.length} options`}
                    />
                    <NLItemViews
                        mode={mode}
                        intervalSec={18}
                        tableTypeLabel="Kind"
                        items={items.map((item) => ({
                            id: item.id,
                            title: item.name,
                            subtitle: item.description,
                            meta: item.meta,
                            badge: KIND_LABEL[item.kind] || item.kind,
                            tag: isSample ? 'Sample' : undefined,
                            tagTone: 'warning',
                            price: item.price,
                            icon: category.icon,
                            tint: category.tint,
                        }))}
                        onPress={(id) => setDetail(items.find((x) => x.id === id) || null)}
                    />
                </>
            ) : !error ? (
                <NLEmptyState
                    icon={category.icon}
                    title="Nothing listed yet"
                    subtitle="Options appear here once this category's catalogue is published."
                />
            ) : null}

            {/* Option detail — Continue lands in the real flow for its kind. */}
            <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="xs" fullWidth>
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography sx={{ ...typography.h3, flex: 1 }}>{detail?.name || ''}</Typography>
                    <IconButton size="small" onClick={() => setDetail(null)} aria-label="Close">
                        <NLIcon name="close" size={20} color={colors.textSecondary} />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers>
                    {detail ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <NLBadge
                                    label={KIND_LABEL[detail.kind] || detail.kind}
                                    tone={KIND_TONE[detail.kind] || 'neutral'}
                                />
                                {isSample ? <NLBadge label="Sample" tone="warning" /> : null}
                                {detail.meta ? (
                                    <Typography sx={typography.caption}>{detail.meta}</Typography>
                                ) : null}
                            </Box>
                            <Typography sx={{ fontSize: 21, fontWeight: 800, color: category.tint }}>
                                {detail.price === 0 ? 'Free' : inr(detail.price)}
                            </Typography>
                            <Typography sx={{ ...typography.body, mt: 1.5 }}>
                                {detail.description}
                            </Typography>
                        </>
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDetail(null)}>Cancel</Button>
                    <Button
                        variant="contained"
                        onClick={() => {
                            if (!detail) return;
                            // An appointment needs a doctor + slot, so it goes to
                            // the consultation flow via doctor search; everything
                            // else settles through the shared checkout.
                            if (detail.kind === 'appointment') {
                                go(KIND_TARGET.appointment);
                                return;
                            }
                            const q = new URLSearchParams({
                                kind: detail.kind === 'group_service' ? 'group_offering' : 'service',
                                name: detail.name,
                                price: String(detail.price ?? 0),
                                provider: category.name,
                                meta: detail.meta || '',
                                ...(isSample ? { sample: '1' } : {}),
                            });
                            go(`newlook/book/checkout?${q.toString()}`);
                        }}
                    >
                        Continue booking
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default Category;
