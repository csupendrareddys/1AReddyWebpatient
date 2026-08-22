/**
 * useDiagnosisDashboard — Hook for the DiagnosisDashboard sub-feature
 * Auth, theme toggle, navigation, status checks
 */
import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { logoutUser } from '../../../auth/redux/authSlice';
import { toggleTheme } from '../../../auth/redux/themeSlice';

const useDiagnosisDashboard = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { user } = useSelector((state) => state.auth);
    const { isDarkMode } = useSelector((state) => state.theme);

    const isInactive = user?.status === 'inactive' || user?.status === 'pending';

    const handleLogout = useCallback(async () => {
        await dispatch(logoutUser());
        navigate('/auth/service-provider/login');
    }, [dispatch, navigate]);

    const handleToggleTheme = useCallback(() => {
        dispatch(toggleTheme());
    }, [dispatch]);

    const navigateTo = useCallback((path) => {
        navigate(path);
    }, [navigate]);

    return {
        user,
        isDarkMode,
        isInactive,
        handleLogout,
        handleToggleTheme,
        navigateTo,
    };
};

export default useDiagnosisDashboard;
