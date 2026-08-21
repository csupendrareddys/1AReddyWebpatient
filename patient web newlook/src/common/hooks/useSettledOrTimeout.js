import { useEffect, useState } from 'react';

/**
 * Returns `true` as soon as `settled` turns true, or after `ms` elapses —
 * whichever comes first.
 *
 * Use it to wait on a condition that *should* flip quickly but, in a rare
 * failure mode, might never flip — so the wait can never become an infinite
 * hang. The motivating case: a layout that gates the whole dashboard on an
 * RTK-Query `isLoading` flag. Under React-18 StrictMode the query's
 * subscription can race on remount and pin `isLoading` true forever even
 * though the HTTP request returned 200, freezing the app on a spinner. Capping
 * the wait lets the shell render regardless, while the common (fast) path still
 * shows the spinner only for the moment the request is genuinely in flight.
 *
 * @param {boolean} settled  the condition to wait for (e.g. `!isLoading`)
 * @param {number}  ms       max time to wait before giving up (default 2000)
 * @returns {boolean} settled || timed-out
 */
export default function useSettledOrTimeout(settled, ms = 2000) {
    const [timedOut, setTimedOut] = useState(false);
    useEffect(() => {
        if (settled) return undefined;
        const t = setTimeout(() => setTimedOut(true), ms);
        return () => clearTimeout(t);
    }, [settled, ms]);
    return settled || timedOut;
}
