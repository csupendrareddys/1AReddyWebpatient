import { useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
    setActiveTab,
    clearSnackbar,
} from '../redux/doctorProfilePersonalDetailsSlice';
import PREVIEW_SAMPLE_DATA from '../constants/previewSampleData';

const useProfileUI = (previewMode = false) => {
    const dispatch = useDispatch();

    const ui = useSelector((state) => state.doctorProfileUi || {});
    const { loading: dataLoading } = useSelector((state) => state.doctor || {});

    const {
        activeTab = 0,
        loading: uiLoading = false,
        error: uiError = null,
        snackbar = { open: false, message: '', severity: 'info' },
    } = previewMode ? { activeTab: 0, loading: false, error: null, snackbar: { open: false, message: '', severity: 'info' } } : ui;

    const loading = previewMode ? false : (dataLoading || uiLoading);
    const error = previewMode ? null : uiError;

    const handleTabChange = useCallback((event, newValue) => {
        dispatch(setActiveTab(newValue));
    }, [dispatch]);

    const handleCloseSnackbar = useCallback(() => {
        dispatch(clearSnackbar());
    }, [dispatch]);

    return {
        activeTab,
        loading,
        error,
        snackbar,
        handleTabChange,
        handleCloseSnackbar,
    };
};

export default useProfileUI;
