import { Outlet, useLocation } from 'react-router-dom';
import { Box, Container, Paper, IconButton, Tooltip } from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { toggleTheme, DARK_MODE_ENABLED } from '../../../features/auth/redux/themeSlice';
import { useLoginPageConfig } from '../../../features/auth/hooks/useLoginPageConfig';
import { AuthLanguageProvider } from '../../contexts/AuthLanguageContext';
import { LanguageSelector, useLanguage } from '../../i18n';

// Map route segments to page config types
const getPageTypeFromPath = (pathname) => {
    if (pathname.includes('admin')) return 'admin_login';
    if (pathname.includes('service-provider')) return 'doctor_login';
    return 'patient_login';
};

const AuthLayout = () => {
    const dispatch = useDispatch();
    const { isDarkMode } = useSelector((state) => state.theme);
    const location = useLocation();
    const pageType = getPageTypeFromPath(location.pathname);

    const { lang, setLang } = useLanguage();
    const { config, availableLanguages } = useLoginPageConfig(pageType, lang);

    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: config?.background_color || 'background.default',
                py: 4,
            }}
        >
            {/* Top-right controls: Language + Theme */}
            <Box sx={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 1 }}>
                <LanguageSelector
                    value={lang}
                    onChange={setLang}
                    availableLanguages={availableLanguages}
                />

                {DARK_MODE_ENABLED && (
                    <Tooltip title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
                        <IconButton onClick={() => dispatch(toggleTheme())} color="primary">
                            {isDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
                        </IconButton>
                    </Tooltip>
                )}
            </Box>

            <Container maxWidth="sm">
                <Paper
                    elevation={6}
                    sx={{
                        p: 4,
                        borderRadius: 3,
                        bgcolor: config?.card_background_color || 'background.paper',
                    }}
                >
                    <AuthLanguageProvider value={lang}>
                        <Outlet />
                    </AuthLanguageProvider>
                </Paper>
            </Container>
        </Box>
    );
};

export default AuthLayout;
