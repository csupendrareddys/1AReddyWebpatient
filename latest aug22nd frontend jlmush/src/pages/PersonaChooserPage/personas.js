/**
 * The persona choices behind the navbar's Login / Register dropdowns
 * (:file:`PublicLandingLayout.jsx`) and the ``/login`` + ``/register`` tile
 * pickers (:file:`PersonaChooserPage.jsx`).
 *
 * Four surfaces offer the same choices and must land on the same routes, so
 * this lives here rather than being duplicated per surface.
 *
 * Both modes are driven by the backend's vertical types
 * (``/api/v1/public/vertical-types`` via :file:`useVerticalTypes.js`) — there is
 * no hardcoded persona list any more, so publishing a vertical is what makes
 * it appear on all four. ``is_receiver`` is the fork in both modes:
 *
 *   * **Register** → ``/join_receiver?vertical=`` for receivers (they buy a
 *     plan without joining the network), ``/join?vertical=`` for providers.
 *   * **Login** → the receiver auth tree for receivers, the shared Service
 *     Provider login for everyone else, which sorts them by role after
 *     sign-in.
 *
 * So login mode legitimately points several tiles at one route — every
 * provider vertical shares a door. That's not a bug to dedupe: the tiles
 * answer "which are you", and the answer routes them.
 */
import useVerticalTypes, { registerRouteFor } from '../../common/hooks/useVerticalTypes';

const SERVICE_RECEIVER_LOGIN = '/auth/service-receiver/login';
const SERVICE_PROVIDER_LOGIN = '/auth/service-provider/login';

const loginRouteFor = (vt) => (vt.is_receiver ? SERVICE_RECEIVER_LOGIN : SERVICE_PROVIDER_LOGIN);

/** Per-mode copy. Routes come from ``useChooserItems``, not from here. */
export const CHOOSER_MODES = {
    login: {
        navLabel: 'Login',
        chooserRoute: '/login',
        overline: 'Sign in',
        blurb: "Pick the option that fits you and we'll take you to the right sign-in.",
        menuLabel: (name) => `${name} Login`,
        errorText: 'Unable to load the sign-in options. Please refresh.',
        emptyText: "Sign-in isn't open yet — check back soon.",
        route: (vt) => loginRouteFor(vt),
    },
    register: {
        navLabel: 'Register',
        chooserRoute: '/register',
        overline: 'Register',
        blurb: "Pick the option that fits you and we'll take you to the right registration.",
        menuLabel: (name) => `${name} Registration`,
        errorText: 'Unable to load the registration options. Please refresh.',
        emptyText: "Registration isn't open yet — check back soon.",
        route: (vt) => registerRouteFor(vt),
    },
};

/** ``Doctor`` → ``I AM A DOCTOR``; ``Optician`` → ``I AM AN OPTICIAN``. */
const tileLabelFor = (name) =>
    `I AM A${/^[aeiou]/i.test(name) ? 'N' : ''} ${name.toUpperCase()}`;

/**
 * The choices for a mode, as ``{key, menuLabel, tileLabel, sub, iconKey,
 * isReceiver, route}``, plus ``isLoading`` / ``error``.
 *
 * The list arrives already ordered by the admin-set ``sort_order`` — the
 * backend (:file:`public/routes.py`) sorts ``vertical-plan-types`` by
 * ``sort_order`` then ``name``, and ``useVerticalTypes`` preserves that order —
 * so the Login / Register dropdowns and tiles all follow the operator's order.
 *
 * ``iconKey`` is the admin-typed vertical icon — render it with
 * :file:`ChooserItemIcon.jsx`, which handles a key that resolves to nothing.
 *
 * ``isReceiver`` carries the vertical's ``is_receiver`` flag through so the
 * menu surfaces can drop a separator between the receiver block and the
 * providers — see :func:`receiverDividerKey`.
 */
export const useChooserItems = (mode) => {
    const { verticalTypes, isLoading, error } = useVerticalTypes();
    const cfg = CHOOSER_MODES[mode] || CHOOSER_MODES.login;

    const mapped = verticalTypes.map((vt) => ({
        key: vt.code,
        menuLabel: cfg.menuLabel(vt.name),
        tileLabel: tileLabelFor(vt.name),
        sub: vt.description || '',
        iconKey: vt.icon_key,
        isReceiver: !!vt.is_receiver,
        route: cfg.route(vt),
    }));

    // Receiver (patient) verticals are pinned to the top, then a separator,
    // then the providers — see :func:`receiverDividerKey`. Both partitions
    // keep the backend's ``sort_order`` (this is a stable split), so the
    // operator still controls the order *within* each block.
    const items = [
        ...mapped.filter((i) => i.isReceiver),
        ...mapped.filter((i) => !i.isReceiver),
    ];

    return { items, isLoading, error };
};

/**
 * Key of the first item that opens a new audience block — i.e. the first place
 * where ``is_receiver`` flips from the previous item — or ``null``.
 *
 * The list is ordered by ``sort_order``, which keeps the receiver (patient)
 * verticals and the provider verticals in two contiguous blocks; a single
 * separator sits at the boundary between them. Detecting the flip in *either*
 * direction means the divider lands correctly whichever block the operator
 * ordered first — after the receivers when receivers lead, before them when
 * providers lead. Render a divider *before* the item whose key this returns.
 * Returns ``null`` when there's no boundary (all one audience, or an empty
 * list), so the caller renders no separator.
 */
export const receiverDividerKey = (items = []) => {
    for (let i = 1; i < items.length; i += 1) {
        if (items[i - 1].isReceiver !== items[i].isReceiver) return items[i].key;
    }
    return null;
};
