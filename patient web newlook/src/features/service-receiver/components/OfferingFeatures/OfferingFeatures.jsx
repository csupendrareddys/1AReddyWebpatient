/**
 * OfferingFeatures — the landing-page feature content (benefits, how it works,
 * and a few essential details) for a booking offering, shown on the patient
 * booking surfaces (Health Plans, Services, consultation).
 *
 * The offering is connected to its features through the Feature-Product Linking
 * store: pass whatever ids the surface has — offering key, product id, and the
 * doctor / team — and the backend resolves the linked landing features.
 */
import {
    Box, Paper, Typography, Stack, Divider, List, ListItem, ListItemIcon, ListItemText,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PlaylistAddCheckIcon from '@mui/icons-material/PlaylistAddCheck';

import { useGetOfferingFeaturesQuery } from '../../api/scopedBookingApi';

function TitleDescList({ items, numbered }) {
    return (
        <Stack spacing={1.25}>
            {items.map((it, i) => (
                <Stack key={i} direction="row" spacing={1.25} alignItems="flex-start">
                    {numbered ? (
                        <Box sx={{
                            flexShrink: 0, width: 22, height: 22, borderRadius: '50%',
                            bgcolor: 'primary.main', color: 'primary.contrastText',
                            fontSize: 12, fontWeight: 700, display: 'flex',
                            alignItems: 'center', justifyContent: 'center', mt: 0.25,
                        }}>{i + 1}</Box>
                    ) : (
                        <CheckCircleIcon color="success" fontSize="small" sx={{ mt: 0.25 }} />
                    )}
                    <Box>
                        <Typography variant="body2" fontWeight={600}>
                            {typeof it === 'string' ? it : it.title}
                        </Typography>
                        {it && typeof it === 'object' && it.desc && (
                            <Typography variant="caption" color="text.secondary">{it.desc}</Typography>
                        )}
                    </Box>
                </Stack>
            ))}
        </Stack>
    );
}

function FeatureBlock({ feature }) {
    const benefits = feature.benefits || [];
    const how = feature.how_it_works || [];
    const included = feature.whats_included || [];
    return (
        <Box>
            {feature.title && (
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                    {feature.title}
                </Typography>
            )}
            {feature.what_is && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {feature.what_is}
                </Typography>
            )}

            <Stack spacing={2}>
                {benefits.length > 0 && (
                    <Box>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
                            <AutoAwesomeIcon fontSize="small" color="primary" />
                            <Typography variant="subtitle2" fontWeight={700}>Benefits</Typography>
                        </Stack>
                        <List dense disablePadding>
                            {benefits.map((b, i) => {
                                // A benefit is either a plain string or an object
                                // ({title, notes} / {title, desc}). Rendering the
                                // object straight into `primary` crashes React
                                // (error #31), so pull out the text fields.
                                const primary = typeof b === 'string' ? b : (b?.title || '');
                                const secondary = b && typeof b === 'object'
                                    ? (b.notes || b.desc || null) : null;
                                return (
                                    <ListItem key={i} disableGutters sx={{ py: 0.25, alignItems: 'flex-start' }}>
                                        <ListItemIcon sx={{ minWidth: 30, mt: 0.25 }}>
                                            <CheckCircleIcon color="success" fontSize="small" />
                                        </ListItemIcon>
                                        <ListItemText
                                            primaryTypographyProps={{ variant: 'body2' }}
                                            secondaryTypographyProps={{ variant: 'caption' }}
                                            primary={primary}
                                            secondary={secondary}
                                        />
                                    </ListItem>
                                );
                            })}
                        </List>
                    </Box>
                )}

                {how.length > 0 && (
                    <Box>
                        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                            How it works
                        </Typography>
                        <TitleDescList items={how} numbered />
                    </Box>
                )}

                {included.length > 0 && (
                    <Box>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
                            <PlaylistAddCheckIcon fontSize="small" color="primary" />
                            <Typography variant="subtitle2" fontWeight={700}>What&apos;s included</Typography>
                        </Stack>
                        <TitleDescList items={included} />
                    </Box>
                )}
            </Stack>
        </Box>
    );
}

export default function OfferingFeatures({
    offering, productId, doctorId, teamId, variant = 'paper', title = 'About this offering',
}) {
    const params = {
        offering: offering || undefined,
        product_id: productId || undefined,
        doctor_id: doctorId || undefined,
        team_id: teamId || undefined,
    };
    const hasKey = params.offering || params.product_id || params.doctor_id || params.team_id;
    const { data: features = [] } = useGetOfferingFeaturesQuery(params, { skip: !hasKey });

    if (!features.length) return null;

    const body = (
        <Stack spacing={2.5} divider={<Divider flexItem />}>
            {features.map((f) => <FeatureBlock key={f.slug} feature={f} />)}
        </Stack>
    );

    if (variant === 'plain') {
        return (
            <Box>
                {title && <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>{title}</Typography>}
                {body}
            </Box>
        );
    }
    return (
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            {title && <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>{title}</Typography>}
            {body}
        </Paper>
    );
}
