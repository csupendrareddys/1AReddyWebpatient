import { useCallback } from 'react';
import {
    useGetAccountStatusQuery,
    useGetFieldStatusesQuery,
    useUpdatePublishStatusMutation,
    useGetPublishStatusByTypeQuery,
} from '../../../admin/api/fieldApprovalEndpoints';

const useAccountStatus = (entityType, entityId, { skip = false } = {}) => {
    const {
        data: accountStatus,
        isLoading: isLoadingStatus,
        refetch: refetchStatus,
    } = useGetAccountStatusQuery(
        { entityType, entityId },
        { skip: skip || !entityId }
    );

    const {
        data: fieldStatuses,
        isLoading: isLoadingFields,
    } = useGetFieldStatusesQuery(
        { entityType, entityId },
        { skip: skip || !entityId }
    );

    const {
        data: publishStatusByTypeData,
    } = useGetPublishStatusByTypeQuery(
        { entityType, entityId },
        { skip: skip || !entityId }
    );

    const [updatePublishStatus, { isLoading: isUpdatingPublish }] = useUpdatePublishStatusMutation();

    const handleUpdatePublishStatus = useCallback(async (newStatus) => {
        if (!entityId) return;
        try {
            await updatePublishStatus({
                entityType,
                entityId,
                publishStatus: newStatus,
            }).unwrap();
            return { success: true };
        } catch (err) {
            return { success: false, error: err?.data?.error || 'Failed to update publish status' };
        }
    }, [entityType, entityId, updatePublishStatus]);

    return {
        accountStatus,
        fieldStatuses,
        isLoading: isLoadingStatus || isLoadingFields,
        isUpdatingPublish,
        handleUpdatePublishStatus,
        refetchStatus,
        // Derived data
        publishStatus: accountStatus?.publish_status || 'inactive',
        publishStatusByType: publishStatusByTypeData?.publish_status_by_type || {},
        profileCompletion: accountStatus?.profile_completion || null,
        pendingCount: fieldStatuses?.pending_count || accountStatus?.pending_count || 0,
    };
};

export default useAccountStatus;
