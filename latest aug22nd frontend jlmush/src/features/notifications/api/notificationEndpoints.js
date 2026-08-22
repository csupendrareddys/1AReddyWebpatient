/**
 * In-app notification feed (RTK Query).
 *
 * The socket only *hints* (NotificationToaster / SocketManager invalidate
 * the 'Notifications' tag on ``notification:new``); this REST surface is
 * the source of truth the bell renders from. A modest poll keeps the
 * badge honest when the socket is down — same fallback convention as the
 * chat layer.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const URL = '/api/v1/notifications';

export const notificationEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getNotifications: builder.query({
            query: () => ({ url: URL, method: 'GET' }),
            transformResponse: (res) => res?.data
                || { notifications: [], unread_count: 0 },
            providesTags: [{ type: 'Notifications', id: 'LIST' }],
        }),
        markNotificationRead: builder.mutation({
            query: (id) => ({ url: `${URL}/${id}/read`, method: 'POST' }),
            invalidatesTags: [{ type: 'Notifications', id: 'LIST' }],
        }),
        markAllNotificationsRead: builder.mutation({
            query: () => ({ url: `${URL}/read-all`, method: 'POST' }),
            invalidatesTags: [{ type: 'Notifications', id: 'LIST' }],
        }),
    }),
    overrideExisting: false,
});

export const {
    useGetNotificationsQuery,
    useLazyGetNotificationsQuery,
    useMarkNotificationReadMutation,
    useMarkAllNotificationsReadMutation,
} = notificationEndpoints;
