/**
 * Discover (new look) — port of the mobile MVP's ``app/discover.tsx``: every
 * recommendation shelf on one page.
 *
 * Runs on ASSUMED endpoint #8 (api/assumedEndpoints.js). There is no
 * recommendation service in the backend, so until it ships this page falls
 * back to the real marketplace catalogue as a single shelf — clearly labelled
 * as the catalogue, never dressed up as personalisation.
 */
import { useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Typography } from '@mui/material';
import NLSectionHeader from '../../components/NLSectionHeader';
import NLTwoRowSlider from '../../components/NLTwoRowSlider';
import NLEmptyState from '../../components/NLEmptyState';
import NLAssumedNotice from '../../components/NLAssumedNotice';
import { useGetNLRecommendationsQuery, isMissingEndpoint } from '../../api/assumedEndpoints';
import { useBrowseMarketplaceQuery } from '../../../api/scopedBookingApi';
import { usePatientScope } from '../../../ProfileSetting/context/PatientScopeContext';
import usePermissions from '../../../../../common/hooks/usePermissions';
import { colors, typography } from '../../theme/tokens';
import { inr } from '../../utils/format';

/** Where a recommended item's kind leads — the same map the mobile app used. */
const KIND_ICON = {
    appointment: 'videocam-outline',
    service: 'storefront-outline',
    group_offering: 'heart-circle-outline',
    recovery_plan: 'thermometer-outline',
};
const ROUTE_HINT = {
    marketplace: 'marketplace',
    'health-plans': 'health-plans',
    recovery: 'newlook/recovery-plans',
    doctor: 'find-doctors',
};

const Discover = () => {
    const navigate = useNavigate();
    const { basePath } = usePatientScope();
    const { hasFeature } = usePermissions();
    const go = (p) => navigate(`${basePath}/${p}`);

    const { data: shelves = [], isLoading, error } = useGetNLRecommendationsQuery();
    // Fallback while the recommendation service doesn't exist: the real
    // catalogue, shown as what it is.
    const { data: products = [] } = useBrowseMarketplaceQuery(undefined, {
        skip: !isMissingEndpoint(error) || !hasFeature('clinic.marketplace'),
    });

    const toCard = (it) => ({
        id: String(it.id),
        title: it.name,
        subtitle: it.provider,
        meta: it.price != null ? `${it.price === 0 ? 'Free' : inr(it.price)}${it.meta ? ` · ${it.meta}` : ''}` : it.meta,
        badge: it.reason,
        icon: KIND_ICON[it.kind] || 'sparkles-outline',
        tint: colors.primary,
    });

    return (
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
            <Typography sx={{ ...typography.h1, mb: 0.5 }}>Discover</Typography>
            <Typography sx={{ ...typography.bodyMuted, mb: 2.5 }}>
                Every recommendation in one place.
            </Typography>

            <NLAssumedNotice error={error} endpoint="GET /api/patient/recommendations">
                Meanwhile the shelf below shows the real services catalogue.
            </NLAssumedNotice>

            {isLoading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                    <CircularProgress />
                </Box>
            ) : shelves.length ? (
                shelves.map((sh) => (
                    <Box key={sh.key} sx={{ mb: 3 }}>
                        <NLSectionHeader title={sh.title} subtitle={sh.subtitle} />
                        <NLTwoRowSlider
                            items={(sh.items || []).map(toCard)}
                            intervalSec={20}
                            onPress={(id) => {
                                const it = (sh.items || []).find((x) => String(x.id) === id);
                                go(ROUTE_HINT[it?.route_hint] || 'marketplace');
                            }}
                        />
                    </Box>
                ))
            ) : isMissingEndpoint(error) && products.length ? (
                <Box sx={{ mb: 3 }}>
                    <NLSectionHeader
                        title="Services you can book"
                        subtitle="The live catalogue — from the providers on your network"
                        actionLabel="Browse all"
                        onAction={() => go('marketplace')}
                    />
                    <NLTwoRowSlider
                        items={products.slice(0, 16).map((p) => ({
                            id: String(p.id),
                            title: p.product_name || 'Service',
                            subtitle: p.doctor_name ? `Dr. ${p.doctor_name}` : 'Provider',
                            meta: p.doctor_price != null ? inr(p.doctor_price) : undefined,
                            badge: p.offering_type === 'group' ? 'Group service' : 'Service',
                            icon: 'storefront-outline',
                            tint: colors.secondary,
                        }))}
                        intervalSec={20}
                        onPress={() => go('marketplace')}
                    />
                </Box>
            ) : (
                <NLEmptyState
                    icon="sparkles-outline"
                    title="Nothing to recommend yet"
                    subtitle="Recommendations appear here as you use the platform."
                />
            )}
        </Box>
    );
};

export default Discover;
