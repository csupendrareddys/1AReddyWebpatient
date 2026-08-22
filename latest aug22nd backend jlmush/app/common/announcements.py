"""Announcements — a seller broadcasting to its subscriber tenants.

One free-form message, fanned to the SUPER_ADMINs of every target tenant
as a bell notification (``notify_tenant_admins``, so the same
persist-first + socket + device-push rail as billing bells). WHO may be
targeted is the calling route's authority decision — the vendor reaches
its direct tenants, an apex its children — this module only owns the
payload contract and the delivery loop, so both consoles stay identical.
"""
import uuid

# Matches the Notification.title column; body is Text but the composer
# should not be a blog editor.
TITLE_MAX = 200
BODY_MAX = 2000
TARGETS_MAX = 200


def validate_announcement_payload(data):
    """(errors, title, body, audience, raw_ids) for a composer payload.

    ``errors`` is a field->message dict, empty when the payload is clean.
    ``raw_ids`` is only meaningful for audience='selected' and is NOT yet
    authority-checked — the route intersects it with the tenants it is
    allowed to address.
    """
    errors = {}
    title = (data.get('title') or '').strip()
    if not title:
        errors['title'] = 'Title is required.'
    elif len(title) > TITLE_MAX:
        errors['title'] = f'Max {TITLE_MAX} characters.'
    body = (data.get('body') or '').strip()
    if len(body) > BODY_MAX:
        errors['body'] = f'Max {BODY_MAX} characters.'
    audience = data.get('audience') or 'all'
    if audience not in ('all', 'selected'):
        errors['audience'] = "Must be 'all' or 'selected'."
    raw_ids = data.get('tenant_ids') or []
    if audience == 'selected':
        if not isinstance(raw_ids, list) or not raw_ids:
            errors['tenant_ids'] = 'Pick at least one tenant.'
        elif len(raw_ids) > TARGETS_MAX:
            errors['tenant_ids'] = (
                f'Max {TARGETS_MAX} tenants per announcement.')
    return errors, title, (body or None), audience, raw_ids


def split_targets(allowed_ids, audience, raw_ids):
    """(target_ids, skipped) — intersect the request with the caller's
    authority set. Malformed and foreign ids both just land in
    ``skipped``: the composer reports them, nothing 500s, nothing leaks
    (a foreign id is indistinguishable from a nonexistent one).
    """
    allowed = {str(t) for t in allowed_ids}
    if audience == 'all':
        return sorted(allowed), []
    wanted = set()
    skipped = []
    for raw in raw_ids:
        try:
            wanted.add(str(uuid.UUID(str(raw))))
        except (ValueError, AttributeError, TypeError):
            skipped.append(str(raw))
    skipped += sorted(wanted - allowed)
    return sorted(wanted & allowed), skipped


def send_announcement(target_tenant_ids, *, title, body=None):
    """Deliver to every target tenant; (tenants_reached, admins_notified).

    Per-tenant failures are already swallowed inside the notify layer —
    a tenant with zero admins simply counts nothing.
    """
    from app.common.notify import notify_tenant_admins

    tenants_reached = 0
    admins_notified = 0
    for tid in target_tenant_ids:
        made = notify_tenant_admins(
            str(tid), type='announcement', title=title, body=body,
            data={'kind': 'announcement'})
        if made:
            tenants_reached += 1
            admins_notified += made
    return tenants_reached, admins_notified
