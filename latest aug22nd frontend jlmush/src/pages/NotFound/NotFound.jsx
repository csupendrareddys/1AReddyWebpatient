import { Box, Container, Typography, Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import HomeIcon from '@mui/icons-material/Home';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const NotFound = () => {
    const navigate = useNavigate();
    return (
        <Container maxWidth="sm" sx={{ py: 10, textAlign: 'center' }}>
            <Typography
                variant="h1"
                sx={{ fontSize: { xs: '5rem', sm: '7rem' }, fontWeight: 700, color: 'primary.main', lineHeight: 1 }}
            >
                404
            </Typography>
            <Typography variant="h5" sx={{ mt: 2, fontWeight: 600 }}>
                Page Not Found
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1.5, mb: 4 }}>
                The page you're looking for doesn't exist or has been moved.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
                <Button
                    variant="outlined" size="large" startIcon={<ArrowBackIcon />}
                    onClick={() => navigate(-1)}
                >
                    Go Back
                </Button>
                <Button
                    variant="contained" size="large" startIcon={<HomeIcon />}
                    onClick={() => navigate('/')}
                >
                    Home
                </Button>
            </Stack>
            <Box sx={{ mt: 6, color: 'text.disabled' }}>
                <Typography variant="caption">
                    If you reached this page from a link inside the app, please report it.
                </Typography>
            </Box>
        </Container>
    );
};

export default NotFound;
