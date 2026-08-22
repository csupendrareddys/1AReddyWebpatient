/**
 * MuiIcon — render an ``@mui/icons-material`` icon from a name typed by
 * an admin (the ``icon_key`` columns on landing modules, plan types, …).
 *
 * The icons barrel exports ~2,000 components. Importing it statically
 * would defeat tree-shaking and drag every one of them into the main
 * bundle, so it's pulled in with a dynamic ``import()`` the first time
 * an icon actually needs resolving and cached at module scope after
 * that. Only admin screens that render a key pay the fetch; the public
 * landing keeps its per-icon deep imports.
 *
 * Name matching is forgiving because admins type these by hand — all of
 * ``LocalHospital`` / ``local_hospital`` / ``local-hospital`` /
 * ``LocalHospitalIcon`` / a pasted ``@mui/icons-material/LocalHospital``
 * resolve to the same component. An unknown name resolves to null; the
 * caller decides what to show instead (see ``IconKeyField``).
 */
import { useEffect, useState } from 'react';

let iconsModule = null;
let iconsPromise = null;

const loadIcons = () => {
    if (iconsModule) return Promise.resolve(iconsModule);
    if (!iconsPromise) {
        iconsPromise = import('@mui/icons-material')
            .then((mod) => {
                iconsModule = mod;
                return mod;
            })
            .catch((err) => {
                // Drop the rejected promise so a later render can retry
                // (a chunk fetch can fail on a flaky network / new deploy).
                iconsPromise = null;
                throw err;
            });
    }
    return iconsPromise;
};

/** ``local_hospital`` / ``local-hospital`` / ``LOCAL_HOSPITAL`` → ``LocalHospital``. */
const toPascalCase = (raw) =>
    raw
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((word) => {
            // An all-caps word is a separator-delimited token (LOCAL_HOSPITAL),
            // not already-cased camel text (localHospital) — lowercase its tail
            // so it doesn't come out as "LOCALHOSPITAL".
            const tail = word === word.toUpperCase() ? word.slice(1).toLowerCase() : word.slice(1);
            return word[0].toUpperCase() + tail;
        })
        .join('');

/** Resolve a typed name against the icons barrel. Returns null when unknown. */
const resolveIcon = (icons, rawName) => {
    // Strip a pasted import path ("@mui/icons-material/LocalHospital").
    const name = String(rawName || '').trim().replace(/^.*\//, '');
    if (!name) return null;
    const pascal = toPascalCase(name);
    const candidates = [name, pascal, pascal.replace(/Icon$/, '')];
    for (const candidate of candidates) {
        const Icon = candidate ? icons[candidate] : null;
        // Icons are createSvgIcon() results — memo/forwardRef objects, not
        // plain functions. Accept either, reject the barrel's stray non-
        // component exports (e.g. __esModule).
        if (Icon && (typeof Icon === 'function' || typeof Icon === 'object')) return Icon;
    }
    return null;
};

/**
 * Resolve ``name`` to an icon component.
 *
 * Returns ``{Icon, loading, resolved}``: ``loading`` is true only while
 * the barrel chunk is in flight, ``resolved`` distinguishes "no name
 * typed yet" from "typed a name that doesn't exist".
 */
export const useMuiIcon = (name) => {
    const key = String(name || '').trim();
    const [icons, setIcons] = useState(iconsModule);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (icons || !key) return undefined;
        let alive = true;
        loadIcons().then(
            (mod) => { if (alive) setIcons(mod); },
            () => { if (alive) setFailed(true); },
        );
        return () => { alive = false; };
    }, [icons, key]);

    if (!key) return { Icon: null, loading: false, resolved: false };
    if (!icons) return { Icon: null, loading: !failed, resolved: false };
    const Icon = resolveIcon(icons, key);
    return { Icon, loading: false, resolved: Boolean(Icon) };
};

/**
 * ``<MuiIcon name="LocalHospital" fontSize="small" />``
 *
 * Extra props pass through to the resolved SvgIcon. ``fallback`` renders
 * while the barrel loads and when the name doesn't match anything.
 */
const MuiIcon = ({ name, fallback = null, ...props }) => {
    const { Icon } = useMuiIcon(name);
    if (!Icon) return fallback;
    return <Icon {...props} />;
};

export default MuiIcon;
