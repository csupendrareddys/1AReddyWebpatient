/**
 * A signed-in staff member's view of themselves.
 * Base: /api/staff.
 *
 * Nothing here takes an id — every route resolves the staff row from the
 * session, so a staff member can only ever read their own profile and their
 * own effective grants.
 *
 * ``/me`` returns the UNION of the permissions across their roles, already
 * merged by the backend. Which role granted a given module isn't returned and
 * isn't shown: the staff member can't change their roles, so the only question
 * they can act on is what they hold in total. The provider's own
 * "what did I just give them?" view (``providerStaffEndpoints``) is where the
 * per-role breakdown belongs.
 */
import { apiSlice } from '../../../app/api/apiSlice';

const BASE = '/api/staff';

export const staffEndpoints = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getStaffMe: builder.query({
            query: () => ({ url: `${BASE}/me`, method: 'GET' }),
            transformResponse: (res) => res.data || {},
            providesTags: ['StaffMe'],
        }),
        // Deliberately invalidates nothing: a password change alters no field
        // ``/me`` returns, and a refetch here would only mask that.
        changeStaffPassword: builder.mutation({
            query: ({ currentPassword, newPassword }) => ({
                url: `${BASE}/me/password`,
                method: 'PUT',
                data: { current_password: currentPassword, new_password: newPassword },
            }),
        }),
    }),
});

export const {
    useGetStaffMeQuery,
    useChangeStaffPasswordMutation,
} = staffEndpoints;
