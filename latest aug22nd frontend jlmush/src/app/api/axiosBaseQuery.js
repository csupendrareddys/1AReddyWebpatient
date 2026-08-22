import axiosInstance from '../../api/axiosConfig';

/**
 * Custom RTK Query base query using axios.
 *
 * Wraps the existing axiosInstance to preserve auth interceptors, token
 * refresh, etc. Every backend endpoint follows the standard envelope from
 * `Backend/app/common/responses.py`:
 *
 *   { success: bool, message?: string, data?: any, error?: string, errors?: object, code?: string }
 *
 * This base query transparently unwraps the ``data`` field on success so
 * every endpoint's ``query`` / ``transformResponse`` can consume the real
 * payload directly (no more `response.data.data` double-access).
 * On failure, the full envelope is passed through under ``error.data`` so
 * callers can branch on ``error.data.code`` or ``error.data.errors``.
 *
 * @param {Object} args
 * @param {string} args.baseUrl - Optional base URL prefix
 */
const axiosBaseQuery =
    ({ baseUrl } = { baseUrl: '' }) =>
    async ({ url, method = 'GET', data, params, headers }) => {
        try {
            const result = await axiosInstance({
                url: baseUrl + url,
                method,
                data,
                params,
                headers,
            });

            const body = result?.data;
            // If the backend sent the standard envelope and reports a
            // business-level failure (HTTP 2xx + success:false), route it
            // through RTK Query's error path so components handle it
            // uniformly with HTTP errors. The envelope (error/errors/code)
            // is preserved under ``error.data``.
            if (body && typeof body === 'object' && body.success === false) {
                return {
                    error: {
                        status: result.status,
                        data: body,
                    },
                };
            }
            // Default: pass the full envelope to endpoint ``transformResponse``
            // hooks. Each hook is responsible for extracting the payload it
            // needs (most already use ``response?.data || response``).
            return { data: body };
        } catch (axiosError) {
            const err = axiosError;
            return {
                error: {
                    status: err.response?.status,
                    data: err.response?.data || err.message,
                },
            };
        }
    };

export default axiosBaseQuery;
