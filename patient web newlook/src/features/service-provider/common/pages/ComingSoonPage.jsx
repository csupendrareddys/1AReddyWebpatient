/**
 * ComingSoonPage — parameterised placeholder for feature pages that
 * haven't been built yet.
 *
 * Used by clinic + hospital dashboards in Round 3+4 to populate
 * sidebar entries (Settings, Manage Doctors, Bills) so the dashboard
 * shell feels complete even before the real features land. Round 5+
 * replaces these stubs with the real pages.
 */
import {
    Alert, Box, Container, Stack, Typography,
} from '@mui/material';
import ConstructionIcon from '@mui/icons-material/Construction';

export default function ComingSoonPage({ title, subtitle }) {
    return (
        <Container maxWidth="md" sx={{ mt: 6, mb: 8 }}>
            <Stack alignItems="center" spacing={2} sx={{ textAlign: 'center' }}>
                <ConstructionIcon
                    sx={{ fontSize: 64, color: 'primary.main' }}
                />
                <Typography variant="h5" sx={{ fontWeight: 700 }}>
                    {title}
                </Typography>
                {subtitle && (
                    <Typography variant="body2" color="text.secondary"
                        sx={{ maxWidth: 480 }}
                    >
                        {subtitle}
                    </Typography>
                )}
                <Box sx={{ pt: 2, width: '100%' }}>
                    <Alert severity="info">
                        This area is coming in an upcoming release. We'll let
                        you know when it's ready.
                    </Alert>
                </Box>
            </Stack>
        </Container>
    );
}
