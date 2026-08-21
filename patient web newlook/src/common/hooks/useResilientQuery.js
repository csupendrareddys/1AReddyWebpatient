import { useEffect, useState } from 'react';

/**
 * Wrap an RTK-Query hook so a React-18 StrictMode subscription race can't leave
 * the component without data.
 *
 * The race: under StrictMode the mount→unmount→remount cycle can wedge an
 * RTK-Query subscription in ``isLoading: true`` with the resolved data never
 * delivered to the component even though the request 200s — a recurring issue
 * in this codebase (see ``useSettledOrTimeout``, ``PatientLayout``,
 * ``VitalsSection``). Pages that copy query data into local state, or simply
 * render a list from it, come up empty.
 *
 * The fix: keep the normal subscription (so tag invalidation still refetches
 * while the component is mounted), but ALSO prime from an imperative
 * ``refetch().unwrap()`` on mount whose promise resolves with the data directly,
 * bypassing the possibly-stuck selector. ``data`` falls back to the primed value
 * only while the subscription hasn't delivered (``??``), so a legitimate empty
 * result still wins.
 *
 * Usage: ``const { data = [], isLoading } = useResilientQuery(useGetXQuery, arg);``
 */
export default function useResilientQuery(useQueryHook, arg, options) {
    const result = useQueryHook(arg, options);
    const { data, refetch, isUninitialized } = result;
    // Start undefined (not null) so a consumer's ``= []`` default still applies
    // while nothing has resolved — ``data ?? primed`` must never yield null.
    const [primed, setPrimed] = useState(undefined);

    useEffect(() => {
        // Never prime a SKIPPED query — ``refetch()`` would force it to run and
        // defeat the skip. A skipped query stays ``isUninitialized``; a real one
        // is already active (loading or done) by the time this effect runs.
        if (isUninitialized || typeof refetch !== 'function') return undefined;
        let alive = true;
        refetch().unwrap()
            .then((r) => { if (alive) setPrimed(r); })
            .catch(() => {});
        return () => { alive = false; };
    }, [refetch, isUninitialized]);

    return { ...result, data: data ?? primed };
}
