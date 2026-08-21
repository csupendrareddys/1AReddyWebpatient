/**
 * usePendingApprovals — Hook for the PendingApprovals sub-feature
 * Currently a skeleton — will be expanded when the feature is implemented
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const usePendingApprovals = () => {
    const navigate = useNavigate();

    const navigateBack = useCallback(() => {
        navigate('/dashboard/admin');
    }, [navigate]);

    return {
        navigateBack,
    };
};

export default usePendingApprovals;
