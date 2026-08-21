/**
 * Extract a human-readable error message from any shape our API layer throws.
 *
 * Handles, in order:
 *   - RTK `rejectWithValue(string)` payloads — `.unwrap()` throws the raw
 *     string, which has no `.message`, so the old `err.message` reads always
 *     fell back to a generic label and hid the backend's real reason.
 *   - Axios errors — the backend envelope is `{ success, error, message }`;
 *     we surface `message` then `error`.
 *   - RTK-Query errors — `{ data: { message | error } }`.
 *   - Plain `Error` objects — `.message`.
 *
 * Use everywhere an operation can fail so the user sees WHY (e.g.
 * "Qualification does not meet requirement") instead of a silent
 * "Operation failed".
 */
export const extractApiError = (err, fallback = 'Something went wrong. Please try again.') => {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    // Axios error with a backend envelope
    const respData = err.response?.data;
    if (respData) {
        if (typeof respData === 'string') return respData;
        if (respData.message) return respData.message;
        if (respData.error) return respData.error;
    }
    // RTK-Query error ({ data: {...} }) or already-unwrapped envelope
    const data = err.data;
    if (data) {
        if (typeof data === 'string') return data;
        if (data.message) return data.message;
        if (data.error) return data.error;
    }
    if (err.message) return err.message;
    if (err.error) return err.error;
    return fallback;
};

export default extractApiError;
